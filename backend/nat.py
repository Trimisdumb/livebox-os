"""Canonical NAT data, shared by the two connectors and the coordinator."""
import ipaddress
import re


def field(item, *names, default=None):
    values = {re.sub(r'[^a-z0-9]', '', str(k).lower()): v for k, v in item.items()}
    return next((values[re.sub(r'[^a-z0-9]', '', n.lower())] for n in names if re.sub(r'[^a-z0-9]', '', n.lower()) in values), default)


def entries(data):
    if isinstance(data, list):
        return [(str(i), v) for i, v in enumerate(data) if isinstance(v, dict)]
    if isinstance(data, dict):
        if field(data, 'ExternalPort') is not None:
            return [(str(field(data, 'id', 'key', default='')), data)]
        return [(k, v) for k, v in data.items() if isinstance(v, dict)]
    raise ValueError('Format de règles NAT inconnu.')


def normalize(data, router='livebox'):
    result = []
    for key, item in entries(data):
        raw = item.get('value', item)
        protocol = str(field(raw, 'Protocol', default='')).upper()
        protocol = {'6': 'TCP', '17': 'UDP', '6,17': 'ALL', 'TCP/UDP': 'ALL'}.get(protocol, protocol)
        enable = field(raw, 'Enable', 'enabled')
        status = field(raw, 'Status')
        enabled = str(enable if enable is not None else status).lower() in ('true', '1', 'on', 'enabled') if enable is not None or status is not None else None
        result.append({
            'id': str(field(item, 'Id', 'key', default=field(raw, 'Id', 'key', default=key))),
            'origin': field(raw, 'Origin'), 'description': field(raw, 'Description', 'name'),
            'externalPort': str(field(raw, 'ExternalPort', default='')),
            'internalPort': str(field(raw, 'InternalPort', default='')),
            'destinationIPAddress': field(raw, 'DestinationIPAddress', 'ipaddr'),
            'protocol': protocol, 'enabled': enabled, 'status': status,
            'router': router, 'raw': raw,
        })
    return result


def normalize_section(data, section):
    aliases = {
        'devices': {'Name': ('Name', 'HostName'), 'IPAddress': ('IPAddress',), 'PhysAddress': ('PhysAddress', 'MACAddress'), 'Active': ('Active',), 'Layer2Interface': ('Layer2Interface',), 'DeviceType': ('DeviceType',)},
        'calls': {'remoteNumber': ('remoteNumber', 'number', 'peerNumber'), 'callType': ('callType', 'type', 'direction'), 'startTime': ('startTime', 'date', 'time'), 'duration': ('duration',)},
    }
    if section not in aliases or not isinstance(data, (dict, list)):
        return data
    result = []
    for key, item in entries(data):
        row = {'id': key, **item}
        for name, sources in aliases[section].items():
            value = field(item, *sources)
            if value is not None:
                row[name] = value
        result.append(row)
    return result


def port_range(value):
    parts = re.split(r'[-:]', str(value))
    if not 1 <= len(parts) <= 2 or not all(p.isdigit() for p in parts):
        raise ValueError('Plage de ports non interprétable : modification bloquée.')
    start, end = int(parts[0]), int(parts[-1])
    if not 1 <= start <= end <= 65535:
        raise ValueError('Plage de ports invalide.')
    return start, end


def conflict(rules, port, protocol):
    for rule in rules:
        if rule['enabled'] is False:
            continue
        start, end = port_range(rule['externalPort'])
        existing = rule['protocol']
        if existing not in ('TCP', 'UDP', 'ALL'):
            raise ValueError('Protocole existant inconnu : vérification manuelle nécessaire.')
        if start <= port <= end and (existing == 'ALL' or protocol == 'ALL' or existing == protocol):
            raise ValueError(f"Conflit avec la règle {rule['description'] or rule['id']} ({existing} {start}-{end}).")


def network(address, mask):
    ip = ipaddress.IPv4Address(address)
    net = ipaddress.IPv4Network(f'{ip}/{mask}', strict=False)
    if net.prefixlen < 8 or not ip.is_private or ip in (net.network_address, net.broadcast_address):
        raise ValueError('Adresse ou masque LAN invalide.')
    return net
