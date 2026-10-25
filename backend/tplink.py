"""AX58 v1 20250812: protocol observed on the owner's router, never generic fallback."""
import asyncio
import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from urllib.parse import quote, urlencode

import httpx
from cryptography.hazmat.primitives import hashes, padding
from cryptography.hazmat.primitives.asymmetric import padding as rsa_padding, rsa
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from .livebox import LiveboxError, local_url, redact
from .nat import normalize


class TPLinkError(LiveboxError):
    pass


class AX58:
    READS = {
        'status': ('admin/status?form=all', 'read'),
        'network': ('admin/network?form=status_ipv4', 'read'),
        'wan': ('admin/network?form=wan_ipv4_status', 'read'),
        'firmware': ('admin/firmware?form=upgrade', 'read'),
        'wifi2': ('admin/wireless?form=wireless_2g', 'read'),
        'wifi5': ('admin/wireless?form=wireless_5g', 'read'),
        'leases': ('admin/dhcps?form=client', 'load'),
        'ports': ('admin/nat?form=vs', 'load'),
    }

    def __init__(self, url, transport=None):
        self.url = local_url(url)
        self.client = httpx.AsyncClient(base_url=self.url, timeout=20, follow_redirects=False, trust_env=False, transport=transport,
                                       headers={'Referer': self.url + '/webpages/index.html', 'Origin': self.url})
        self.lock = asyncio.Semaphore(2)
        self.stok = ''
        self.key = secrets.token_hex(8).encode()
        self.iv = secrets.token_hex(8).encode()
        self.seq = 0
        self.sign_key = None
        self.hash = ''
        self.compatible = False
        self.identity = {}

    def aes(self, data, decrypt=False):
        cipher = Cipher(algorithms.AES(self.key), modes.CBC(self.iv))
        if decrypt:
            worker = cipher.decryptor()
            decoded = worker.update(base64.b64decode(data, validate=True)) + worker.finalize()
            unpad = padding.PKCS7(128).unpadder()
            return (unpad.update(decoded) + unpad.finalize()).decode()
        pad = padding.PKCS7(128).padder()
        padded = pad.update(data.encode()) + pad.finalize()
        worker = cipher.encryptor()
        return base64.b64encode(worker.update(padded) + worker.finalize()).decode()

    def encrypt(self, parameters, login=False):
        plain = urlencode({k: str(v).lower() if isinstance(v, bool) else v for k, v in parameters.items()}, quote_via=quote)
        data = self.aes(plain)
        digest = self.hash if login else hashlib.sha256(data.encode()).hexdigest()
        aes_key = f'k={self.key.decode()}&i={self.iv.decode()}'
        message = f'h={digest}&s={self.seq + len(data)}'
        if login:
            message = aes_key + '&' + message
        chunks = [message[i:i + 53].encode() for i in range(0, len(message), 53)]
        signature = ''.join(self.sign_key.encrypt(chunk, rsa_padding.OAEP(mgf=rsa_padding.MGF1(hashes.SHA1()), algorithm=hashes.SHA1(), label=None)).hex()
                            if login else hmac.new(aes_key.encode(), chunk, hashlib.sha256).hexdigest() for chunk in chunks)
        return {'sign': signature, 'data': data}

    async def request(self, path, parameters=None, public=False, login=False):
        async with self.lock:
            try:
                response = await self.client.post(f'/cgi-bin/luci/;stok={self.stok}/{path.lstrip("/")}',
                                                  data=(parameters or {'operation': 'read'}) if public else self.encrypt(parameters or {'operation': 'read'}, login))
                if response.status_code in (401, 403):
                    self.stok = ''
                    raise TPLinkError('Session TP-Link expirée. Reconnectez le routeur.', 'TPLINK_SESSION_EXPIRED')
                response.raise_for_status()
                result = response.json()
                if not isinstance(result, dict):
                    raise ValueError('Invalid response')
                if not public and isinstance(result.get('data'), str):
                    result = json.loads(self.aes(result['data'], decrypt=True))
                if not isinstance(result, dict):
                    raise ValueError('Invalid response')
                if result.get('success') is not True:
                    code = str(result.get('errorCode', result.get('errorcode', result.get('error', 'REFUSED'))))
                    if code == 'timeout':
                        self.stok = ''
                    safe_code = code if re.fullmatch(r'[0-9]{1,12}', code) or code in ('timeout', 'permission denied', 'multiple login', 'auto upgrading') else 'REFUSED'
                    raise TPLinkError(f'Requête TP-Link refusée ({safe_code}). Aucun nouvel essai de modification automatique.', 'TPLINK_REFUSED')
                return result
            except (httpx.TimeoutException, TimeoutError):
                raise TPLinkError('Délai TP-Link dépassé. Vérifiez l’état avant toute nouvelle modification.', 'TPLINK_TIMEOUT')
            except httpx.HTTPError:
                raise TPLinkError('Communication TP-Link impossible. Vérifiez le réseau et l’adresse.', 'TPLINK_NETWORK')
            except (ValueError, KeyError, TypeError):
                raise TPLinkError('Réponse TP-Link incompatible ou indéchiffrable.', 'TPLINK_BAD_RESPONSE')

    async def login(self, password, force=False):
        config = (await self.request('device_config?form=config', public=True))['data']
        certs = config.get('certification', [])
        if 'SG CLS L1 STAGE2' not in certs:
            raise TPLinkError('Ce protocole exige la signature SG CLS L1 STAGE2 observée sur votre firmware. Connexion arrêtée.', 'TPLINK_UNSUPPORTED')
        keys = (await self.request('login?form=keys', public=True))['data']['password']
        auth = (await self.request('login?form=auth', public=True))['data']
        self.seq = int(auth['seq'])
        self.sign_key = rsa.RSAPublicNumbers(int(auth['key'][1], 16), int(auth['key'][0], 16)).public_key()
        password_key = rsa.RSAPublicNumbers(int(keys[1], 16), int(keys[0], 16)).public_key()
        self.hash = hashlib.sha256(('admin' + password).encode()).hexdigest()
        encrypted_password = password_key.encrypt(password.encode(), rsa_padding.PKCS1v15()).hex()
        result = await self.request('login?form=login', {'operation': 'login', 'password': encrypted_password, 'confirm': force}, login=True)
        self.stok = result.get('data', {}).get('stok', '')
        if not re.fullmatch(r'[A-Za-z0-9_-]{8,128}', self.stok):
            raise TPLinkError('Connexion non confirmée par le TP-Link.', 'TPLINK_LOGIN_FAILED')
        self.identity = (await self.request(self.READS['firmware'][0]))['data']
        # Identity is checked after authentication; the shared UI's AX53 label is not hardware identification.
        identity = ' '.join(str(v) for v in self.identity.values())
        self.compatible = bool(re.search(r'\bAX58\b', identity, re.I) and re.search(r'(?:v|ver[: .]*|hardware[^0-9]*)1\.0\b', identity, re.I)
                               and re.search(r'\b1\.5\.2\b', identity) and '20250812' in identity and '38324(4555)' in identity.replace(' ', ''))
        self.identity = redact(self.identity)

    async def read(self, section):
        if not self.stok:
            return {'available': False, 'data': None, 'message': 'Session TP-Link expirée. Reconnectez le routeur.', 'code': 'TPLINK_SESSION_EXPIRED'}
        path, operation = self.READS[section]
        try:
            result = await self.request(path, {'operation': operation})
            data = normalize(result.get('data'), 'tplink') if section == 'ports' else result.get('data')
            return {'available': True, 'data': redact(data)}
        except LiveboxError as error:
            return {'available': False, 'data': None, 'message': str(error), 'code': error.code}
        except (ValueError, TypeError):
            return {'available': False, 'data': None, 'message': 'Format de données TP-Link non reconnu pour ce service.', 'code': 'TPLINK_BAD_RESPONSE'}

    async def add(self, rule):
        self.require_writes()
        value = {'name': rule['description'], 'external_port': str(rule['externalPort']), 'internal_port': str(rule['internalPort']),
                 'ipaddr': rule['destinationIPAddress'], 'protocol': rule['protocol'], 'enable': 'on'}
        return await self.request('admin/nat?form=vs', {'operation': 'insert', 'new': json.dumps(value, separators=(',', ':')), 'index': 0})

    async def delete(self, rule, index):
        self.require_writes()
        return await self.request('admin/nat?form=vs', {'operation': 'remove', 'key': rule['id'], 'index': index})

    async def update(self, old, new):
        self.require_writes()
        value = old['raw'] | {'name': new['description'], 'external_port': str(new['externalPort']), 'internal_port': str(new['internalPort']),
                              'ipaddr': new['destinationIPAddress'], 'protocol': new['protocol'], 'enable': 'on'}
        return await self.request('admin/nat?form=vs', {'operation': 'update', 'key': old['id'], 'new': json.dumps(value), 'old': json.dumps(old['raw'])})

    def require_writes(self):
        if not self.compatible:
            raise TPLinkError('Écriture bloquée : identité AX58 V1 / firmware 1.5.2 20250812 rel.38324 non confirmée.', 'TPLINK_UNSUPPORTED')

    async def close(self):
        self.stok = ''
        self.hash = ''
        await self.client.aclose()
