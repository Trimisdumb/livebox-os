import asyncio
import ipaddress
import logging
import time
from urllib.parse import urlsplit

import httpx


logger = logging.getLogger('orange.livebox')
SENSITIVE_FIELDS = ('password', 'passwd', 'passphrase', 'presharedkey', 'privatekey', 'secretkey', 'contextid', 'ubusrpcsession', 'secret', 'authorization', 'stok', 'sysauth', 'pskkey', 'wepkey', 'wpakey', 'token')


class LiveboxError(Exception):
    def __init__(self, message, code='SERVICE_UNAVAILABLE'):
        super().__init__(message)
        self.code = code


def redact(value):
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, dict):
        return {key: ('••••••••' if any(word in key.lower().replace('_', '').replace('-', '') for word in SENSITIVE_FIELDS) else redact(item)) for key, item in value.items()}
    return value


def local_url(value: str) -> str:
    parsed = urlsplit(value if '://' in value else f'http://{value}')
    try:
        ip = ipaddress.IPv4Address(parsed.hostname or '')
        port = parsed.port
    except ValueError:
        raise ValueError('Utilisez une adresse IPv4 privée, par exemple 192.168.1.1.')
    private = any(ip in ipaddress.ip_network(n) for n in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))
    if not private or parsed.scheme not in ('http', 'https') or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/') or port not in (None, 80, 443):
        raise ValueError('Seules les Livebox du réseau privé sur HTTP/HTTPS sont autorisées.')
    return f'{parsed.scheme}://{ip}' + (f':{port}' if port else '')


class Livebox:
    def __init__(self, url: str, transport=None):
        self.url = local_url(url)
        self.client = httpx.AsyncClient(base_url=self.url, timeout=8, follow_redirects=False, trust_env=False, transport=transport)
        self.lock = asyncio.Semaphore(4)
        self.auth_valid = True
        self.headers = {'Content-Type': 'application/x-sah-ws-4-call+json; charset=UTF-8'}

    async def request(self, service, method, parameters=None, login=False):
        headers = self.headers | ({'Authorization': 'X-Sah-Login'} if login else {})
        payload = {'service': service if login else f'sysbus.{service}', 'method': method, 'parameters': parameters if parameters is not None else {}}
        started = time.monotonic()
        timeout = 60 if method == 'getDoraCyclesDetails' else 35 if method in ('setWLANConfig', 'setIPv4') else 25 if method == 'getMIBs' else 8
        try:
            async with asyncio.timeout(timeout + 7):
                async with self.lock:
                    response = await self.client.post('/ws', json=payload, headers=headers, timeout=timeout)
            logger.info('sysbus service=%s method=%s http=%s ms=%d', service, method, response.status_code, (time.monotonic() - started) * 1000)
            if response.status_code == 401:
                self.auth_valid = False
                raise LiveboxError('La session Livebox a expiré. Reconnectez votre Livebox.', 'LIVEBOX_SESSION_EXPIRED')
            if response.status_code == 403:
                raise LiveboxError('Non disponible : la Livebox refuse l’accès à ce service.', 'LIVEBOX_SERVICE_REFUSED')
            response.raise_for_status()
            result = response.json()
            if isinstance(result, dict):
                result = result.get('result', result)
        except (httpx.TimeoutException, TimeoutError):
            logger.warning('sysbus service=%s method=%s code=TIMEOUT', service, method)
            raise LiveboxError('Délai dépassé : la Livebox n’a pas répondu. Vérifiez sa connexion.', 'LIVEBOX_TIMEOUT')
        except httpx.HTTPStatusError as error:
            raise LiveboxError(f'Non disponible : le service Livebox a retourné HTTP {error.response.status_code}.', 'LIVEBOX_HTTP_ERROR')
        except httpx.HTTPError:
            logger.warning('sysbus service=%s method=%s code=NETWORK', service, method)
            raise LiveboxError('Communication Livebox impossible : vérifiez l’adresse et le réseau du serveur.', 'LIVEBOX_NETWORK')
        except (ValueError, AttributeError):
            raise LiveboxError('Réponse Livebox illisible.', 'LIVEBOX_BAD_RESPONSE')
        if not isinstance(result, dict) or result.get('errors') or result.get('error') or result.get('status') is False or (not login and 'status' not in result):
            raise LiveboxError('Non disponible : service refusé, session expirée ou firmware incompatible.')
        return result

    async def check_session(self):
        try:
            await self.request('Time', 'getTime')
        except LiveboxError as error:
            if error.code in ('SERVICE_UNAVAILABLE', 'LIVEBOX_SERVICE_REFUSED'):
                self.auth_valid = False

    async def login(self, username, password):
        result = await self.request('sah.Device.Information', 'createContext', {'applicationName': 'so_sdkut', 'username': username, 'password': password}, login=True)
        context = result.get('data', {}).get('contextID')
        if not context:
            raise LiveboxError('Authentification refusée. Vérifiez les identifiants administrateur.')
        self.headers.update({'Authorization': f'X-Sah {context}', 'X-Context': context})
        check = await self.request('Time', 'getTime')
        if check.get('status') is not True:
            raise LiveboxError('La Livebox a refusé la session.')

    async def read(self, service, method, parameters=None, data=False):
        try:
            result = await self.request(service, method, parameters)
            value = result.get('data' if data else 'status')
            if not isinstance(value, (dict, list)):
                raise LiveboxError('Non disponible : réponse sans données.')
            return {'available': True, 'data': redact(value)}
        except LiveboxError as error:
            return {'available': False, 'data': None, 'message': str(error), 'code': error.code}

    async def close(self):
        try:
            if 'X-Context' in self.headers:
                await self.request('sah.Device.Information', 'releaseContext', {'applicationName': 'so_sdkut'})
        except LiveboxError:
            pass
        finally:
            await self.client.aclose()
