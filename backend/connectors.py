import asyncio
import ipaddress
import json
import os
import re
import socket
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from .livebox import Livebox, LiveboxError, redact
from .tplink import AX58
from . import auth


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
    'system': "printf 'CPU\\n'; head -n 1 /proc/stat; sleep 1; head -n 1 /proc/stat; printf 'OS\\n'; cat /etc/os-release; printf 'UPTIME\\n'; cat /proc/uptime; printf 'LOAD\\n'; cat /proc/loadavg; printf 'MEMORY\\n'; cat /proc/meminfo; printf 'DISK\\n'; df -Pk -x tmpfs -x devtmpfs; printf 'NETWORK\\n'; head -n 64 /proc/net/dev",
    'services': 'systemctl list-units --type=service --state=running --no-pager --no-legend',
    'docker': "docker ps --format '{{json .}}'",
    'wireguard': 'wg show all transfer; wg show all latest-handshakes',
    'tailscale': 'tailscale status --json',
    'openvpn': 'systemctl list-units --all --type=service --no-pager --no-legend "openvpn*"',
}
ssh_limit = asyncio.Semaphore(2)


async def run_bounded(arguments, timeout=15, capture_stderr=False):
    process = await asyncio.create_subprocess_exec(*arguments, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE if capture_stderr else asyncio.subprocess.DEVNULL, stdin=asyncio.subprocess.DEVNULL)
    async def read(stream, limit):
        output = bytearray()
        while chunk := await stream.read(4096):
            output.extend(chunk)
            if len(output) > limit:
                raise ValueError('Réponse trop volumineuse.')
        return output.decode('utf-8', errors='replace')
    try:
        async def collect():
            streams = [read(process.stdout, 128 * 1024)]
            if capture_stderr:
                streams.append(read(process.stderr, 16 * 1024))
            values = await asyncio.gather(*streams)
            await process.wait()
            return process.returncode, values[-1] if capture_stderr and process.returncode else values[0]
        return await asyncio.wait_for(collect(), timeout)
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()


def ssh_directory():
    return Path(os.environ.get('LIVEBOX_OS_SSH_DIR') or auth.DATA / 'ssh').resolve()


def ssh_alias(resource):
    return resource['host'] if os.environ.get('LIVEBOX_OS_SSH_DIR') else 'livebox-os-' + resource['id']


def linux_system(output):
    blocks = re.split(r'(?m)^(CPU|OS|UPTIME|LOAD|MEMORY|DISK|NETWORK)\r?\n', output)
    sections = dict(zip(blocks[1::2], blocks[2::2]))
    cpu = [list(map(int, line.split()[1:9])) for line in sections.get('CPU', '').splitlines() if re.fullmatch(r'cpu(?:\s+\d+){4,}', line)]
    usage = None
    if len(cpu) == 2 and all(b >= a for a, b in zip(*cpu)):
        total = sum(cpu[1]) - sum(cpu[0])
        idle = sum(cpu[1][3:5]) - sum(cpu[0][3:5])
        if total > 0: usage = round(100 * (total - idle) / total, 1)
    memory = {k: int(v) * 1024 for k, v in re.findall(r'(?m)^(MemTotal|MemAvailable):\s+(\d+)\s+kB', sections.get('MEMORY', ''))}
    total, available = memory.get('MemTotal'), memory.get('MemAvailable')
    uptime = re.match(r'([0-9.]+)', sections.get('UPTIME', ''))
    operating_system = re.search(r'(?m)^PRETTY_NAME=(.+)$', sections.get('OS', ''))
    disks = []
    for line in sections.get('DISK', '').splitlines():
        row = re.fullmatch(r'(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)', line)
        if row:
            fs, size, used, free, percent, mount = row.groups()
            disks.append({'filesystem': fs, 'mount': mount, 'total_bytes': int(size)*1024, 'used_bytes': int(used)*1024, 'available_bytes': int(free)*1024, 'used_percent': int(percent)})
    interfaces = []
    for line in sections.get('NETWORK', '').splitlines():
        if ':' not in line: continue
        name, values = line.split(':', 1)
        fields = values.split()
        if len(fields) >= 16 and all(v.isdigit() for v in fields):
            interfaces.append({'name': name.strip(), 'received_bytes': int(fields[0]), 'sent_bytes': int(fields[8])})
    return {'cpu_percent': usage, 'uptime_seconds': float(uptime.group(1)) if uptime else None,
            'os': operating_system.group(1).strip('"\'') if operating_system else None,
            'memory': {'total_bytes': total, 'available_bytes': available, 'used_bytes': total-available if total is not None and available is not None and total >= available else None},
            'disks': disks, 'interfaces': interfaces, 'measured_at': time.time()}


async def ssh_read(resource, section):
    if section not in SSH_COMMANDS:
        return unavailable()
    root = ssh_directory()
    key = (root / resource['key_name']).resolve()
    if key.parent != root or not key.is_file() or not (root / 'known_hosts').is_file():
        return unavailable('Clé dédiée ou fichier known_hosts vérifié absent du dossier SSH autorisé.')
    try:
        ip = await resolve_host(resource['host'])
        args = ['ssh', '-F', 'none', '-T', '-a', '-x', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=1', '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no', '-o', f'UserKnownHostsFile="{(root / "known_hosts").as_posix()}"', '-o', 'GlobalKnownHostsFile=none', '-o', f'HostKeyAlias={ssh_alias(resource)}', '-i', str(key), '-p', str(resource['port']), '-l', resource['username'], ip, SSH_COMMANDS[section]]
        async with ssh_limit:
            code, output = await run_bounded(args, capture_stderr=True)
        if code != 0:
            reason = output.lower()
            if 'host key verification failed' in reason or 'identification has changed' in reason:
                return unavailable('Identité SSH absente ou différente. Vérifiez l’empreinte du serveur dans la configuration SSH ; aucune clé inconnue n’est acceptée automatiquement.')
            if 'permission denied' in reason or 'load key' in reason or 'bad permissions' in reason:
                return unavailable('Authentification SSH refusée. Vérifiez le compte, sa clé publique dans authorized_keys et les permissions de la clé privée (600).')
            if 'connection refused' in reason:
                return unavailable('Connexion refusée : vérifiez le port SSH et que le service sshd écoute sur ce serveur.')
            if 'timed out' in reason or 'no route to host' in reason:
                return unavailable('Serveur SSH injoignable : vérifiez l’adresse, le VPN et le pare-feu depuis le backend.')
            return unavailable('Commande SSH indisponible ou non autorisée pour ce compte. Consultez les permissions du service demandé.')
        if section == 'system':
            output = linux_system(output)
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
