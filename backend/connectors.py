import asyncio
import ipaddress
import json
import os
import re
import socket
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from .livebox import Livebox, LiveboxError, redact
from .tplink import AX58


CATALOG = [
    {'id': 'livebox', 'manufacturer': 'Orange', 'model': 'Livebox 5', 'method': 'Sysbus', 'status': 'tested-v3'},
    {'id': 'tplink', 'manufacturer': 'TP-Link', 'model': 'Archer AX58 V1', 'method': 'TP-Link AES/RSA', 'status': 'tested-v3', 'note': 'Firmware 1.5.2, 20250812 rel.38324(4555) ; autres modèles non validés.'},
    {'id': 'openwrt', 'manufacturer': 'OpenWrt', 'model': 'rpcd / uhttpd', 'method': 'ubus JSON-RPC', 'status': 'protocol-tested', 'note': 'Lecture seule ; endpoint /ubus et ACL rpcd nécessaires. Non validé sur matériel.'},
] + [{'id': name.lower().replace('.', ''), 'manufacturer': name, 'model': None, 'method': None, 'status': 'unavailable', 'note': 'Non disponible : aucun connecteur validé. Un firmware OpenWrt peut utiliser le connecteur OpenWrt.'} for name in ('ASUS', 'Netgear', 'D-Link', 'GL.iNet', 'MikroTik', 'Ubiquiti', 'FRITZ!Box')]

LB_READS = {
    'info': ('DeviceInfo', 'get', {}),
    'wan': ('NMC', 'getWANStatus', {}),
    'lan': ('NMC', 'getLANIP', {}),
    'devices': ('Devices', 'get', {'expression': 'physical and !self and !voice'}),
    'wifi': ('NMC.Wifi', 'get', {}),
    'guest': ('NMC.Guest', 'get', {}),
    'schedule': ('Scheduler', 'getCompleteSchedules', {'type': 'WLAN'}),
    'firewall': ('Firewall', 'getFirewallLevel', {}),
    'firewall6': ('Firewall', 'getFirewallIPv6Level', {}),
    'ping': ('Firewall', 'getRespondToPing', {'sourceInterface': 'data'}),
    'dmz': ('Firewall', 'getDMZ', {}),
    'ports': ('Firewall', 'getPortForwarding', {}),
    'dhcp': ('DHCPv4.Server', 'getDHCPServerPool', {}),
    'dyndns': ('DynDNS', 'getHosts', {}),
    'reboots': ('NMC.Reboot.Reboot', 'get', {}),
    'calls': ('VoiceService.VoiceApplication', 'getCallList', [{'line': '1'}]),
}


def allowed_ip(value):
    address = ipaddress.ip_address(value)
    ranges = os.environ.get('LIVEBOX_OS_ALLOWED_NETWORKS', '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16').split(',')
    if address.version != 4 or address.is_loopback or address.is_link_local or address.is_multicast or address.is_unspecified:
        raise ValueError('Destination interdite.')
    if not any(address in ipaddress.ip_network(net.strip()) for net in ranges if net.strip()):
        raise ValueError('Destination hors des réseaux autorisés par le serveur.')
    return str(address)


async def resolve_host(host):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{0,252}', host):
        raise ValueError('Adresse IPv4 ou nom DNS invalide.')
    try:
        return allowed_ip(host)
    except ValueError:
        if re.fullmatch(r'[0-9.]+', host):
            raise
    addresses = await asyncio.wait_for(asyncio.to_thread(socket.getaddrinfo, host, None, socket.AF_INET, socket.SOCK_STREAM), 5)
    values = sorted({allowed_ip(entry[4][0]) for entry in addresses})
    if not values:
        raise ValueError('Aucune adresse IPv4 autorisée.')
    return values[0]


async def resolve_url(value):
    parsed = urlsplit(value if '://' in value else 'http://' + value)
    if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment or parsed.port not in (None, 80, 443):
        raise ValueError('Utilisez une adresse HTTP(S) sans chemin ni identifiant, sur le port 80 ou 443.')
    ip = await resolve_host(parsed.hostname or '')
    # Pin DNS once so redirects and a second resolution cannot reach another network.
    return f'{parsed.scheme}://{ip}'


def unavailable(message='Non disponible : service refusé ou non pris en charge.'):
    return {'available': False, 'data': None, 'message': message}


async def livebox_read(box, section):
    service, method, params = LB_READS[section]
    try:
        result = await box.request(service, method, params)
        value = result.get('data', result.get('status'))
        if value is None or isinstance(value, bool):
            return unavailable('Non disponible : l’API n’a pas retourné de données exploitables.')
        return {'available': True, 'data': redact(value)}
    except LiveboxError as error:
        return unavailable(str(error))


class OpenWrt:
    READS = {'info': ('system', 'board'), 'system': ('system', 'info'), 'network': ('network.interface', 'dump')}

    def __init__(self, url, transport=None):
        self.url = url
        self.token = '0' * 32
        self.client = httpx.AsyncClient(base_url=url, timeout=8, follow_redirects=False, trust_env=False, transport=transport)

    async def call(self, object_name, method, params=None):
        try:
            async with asyncio.timeout(20):
                async with self.client.stream('POST', '/ubus', json={'jsonrpc': '2.0', 'id': 1, 'method': 'call', 'params': [self.token, object_name, method, params or {}]}) as response:
                    response.raise_for_status()
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        content.extend(chunk)
                        if len(content) > 2 * 1024 * 1024:
                            raise LiveboxError('Réponse OpenWrt trop volumineuse ; lecture interrompue.')
            payload = json.loads(content)
            result = payload.get('result') if isinstance(payload, dict) else None
            if not isinstance(result, list) or len(result) < 2 or result[0] != 0 or not isinstance(result[1], dict):
                raise LiveboxError('Non disponible : droits rpcd insuffisants ou service absent.')
            return result[1]
        except (httpx.HTTPError, ValueError, TimeoutError):
            raise LiveboxError('Communication OpenWrt impossible. Vérifiez /ubus, TLS et les ACL rpcd.')

    async def login(self, username, password):
        result = await self.call('session', 'login', {'username': username, 'password': password, 'timeout': 3600})
        token = result.get('ubus_rpc_session', '')
        if not re.fullmatch('[a-f0-9]{32}', token):
            raise LiveboxError('Session OpenWrt refusée.')
        self.token = token

    async def read(self, section):
        try:
            result = await self.call(*self.READS[section])
            return {'available': True, 'data': redact(result)}
        except LiveboxError as error:
            return unavailable(str(error))

    async def close(self):
        try:
            if self.token != '0' * 32:
                await self.call('session', 'destroy')
        except LiveboxError:
            pass
        finally:
            self.token = ''
            await self.client.aclose()


SSH_COMMANDS = {
    'system': "printf 'UPTIME\\n'; cat /proc/uptime; printf 'LOAD\\n'; cat /proc/loadavg; printf 'MEMORY\\n'; head -n 5 /proc/meminfo; printf 'DISK\\n'; df -Pk /; printf 'NETWORK\\n'; head -n 32 /proc/net/dev",
    'services': 'systemctl list-units --type=service --state=running --no-pager --no-legend',
    'docker': "docker ps --format '{{json .}}'",
    'wireguard': 'wg show all transfer; wg show all latest-handshakes',
    'tailscale': 'tailscale status --json',
    'openvpn': 'systemctl list-units --all --type=service --no-pager --no-legend "openvpn*"',
}
ssh_limit = asyncio.Semaphore(2)


async def run_bounded(arguments, timeout=15):
    process = await asyncio.create_subprocess_exec(*arguments, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, stdin=asyncio.subprocess.DEVNULL)
    async def read():
        output = bytearray()
        while chunk := await process.stdout.read(4096):
            output.extend(chunk)
            if len(output) > 128 * 1024:
                raise ValueError('Réponse trop volumineuse.')
        await process.wait()
        return output.decode('utf-8', errors='replace')
    try:
        output = await asyncio.wait_for(read(), timeout)
        return process.returncode, output
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()


async def ssh_read(resource, section):
    if section not in SSH_COMMANDS:
        return unavailable()
    directory = os.environ.get('LIVEBOX_OS_SSH_DIR')
    if not directory:
        return unavailable('Non disponible : LIVEBOX_OS_SSH_DIR non configuré côté backend.')
    root = Path(directory).resolve()
    key = (root / resource['key_name']).resolve()
    if key.parent != root or not key.is_file() or not (root / 'known_hosts').is_file():
        return unavailable('Clé dédiée ou fichier known_hosts vérifié absent du dossier SSH autorisé.')
    try:
        ip = await resolve_host(resource['host'])
        args = ['ssh', '-F', 'none', '-T', '-a', '-x', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=1', '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no', '-o', f'UserKnownHostsFile={root / "known_hosts"}', '-o', 'GlobalKnownHostsFile=none', '-o', f'HostKeyAlias={resource["host"]}', '-i', str(key), '-p', str(resource['port']), '-l', resource['username'], ip, SSH_COMMANDS[section]]
        async with ssh_limit:
            code, output = await run_bounded(args)
        if code != 0:
            return unavailable('Lecture SSH refusée : vérifiez la clé, known_hosts et les permissions du compte dédié.')
        if section == 'tailscale':
            data = json.loads(output)
            output = {'BackendState': data.get('BackendState'), 'TailscaleIPs': data.get('TailscaleIPs'), 'peers': len(data.get('Peer') or {})}
        return {'available': True, 'data': output}
    except (OSError, TimeoutError, ValueError):
        return unavailable('Lecture SSH impossible ou délai dépassé. Aucun mot de passe ne sera demandé.')


async def connect_router(resource, password):
    url = await resolve_url(resource['host'])
    box = {'livebox': Livebox, 'tplink': AX58, 'openwrt': OpenWrt}[resource['connector']](url)
    try:
        if resource['connector'] == 'tplink':
            await box.login(password)
        else:
            await box.login(resource['username'], password)
        return box
    except BaseException:
        await box.close()
        raise
