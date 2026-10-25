import asyncio
import contextlib
import hashlib
import ipaddress
import json
import secrets
import time
from dataclasses import dataclass, field as dataclass_field
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from . import auth, database
from .livebox import LiveboxError, local_url
from .nat import conflict, entries, field, network, normalize
from .tplink import AX58

sessions = {}
locks = {}
write_lock = asyncio.Lock()


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class RouterLogin(Strict):
    url: str = 'http://192.168.0.1'
    password: SecretStr = Field(min_length=1, max_length=128)
    force: bool = False
    reconnect: bool = False

    @field_validator('url')
    @classmethod
    def validate_url(cls, value):
        return local_url(value)


class Rule(Strict):
    name: str = Field(min_length=1, max_length=24, pattern=r'^[A-Za-z0-9 _.-]+$')
    target: Literal['livebox', 'tplink']
    destination: str
    external: int = Field(ge=1, le=65535)
    internal: int = Field(ge=1, le=65535)
    protocol: Literal['TCP', 'UDP', 'ALL'] = 'TCP'

    @field_validator('destination')
    @classmethod
    def validate_ip(cls, value):
        local_url(value)
        return str(ipaddress.IPv4Address(value))


class Plan(Strict):
    action: Literal['create', 'update', 'delete']
    rule: Rule | None = None
    operation: str | None = Field(default=None, pattern=r'^[a-f0-9]{12}$')


class Confirmation(Strict):
    token: str = Field(max_length=128)


class NativePlan(Strict):
    action: Literal['create', 'update', 'delete']
    rule: Rule | None = None
    id: str | None = Field(default=None, max_length=128)


@dataclass
class RouterSession:
    box: AX58
    expires: float = dataclass_field(default_factory=lambda: time.time() + 8 * 3600)
    password: str | None = None
    last_login: float = 0
    cached: dict = dataclass_field(default_factory=dict)
    updated: float = 0
    history: list = dataclass_field(default_factory=list)
    task: asyncio.Task | None = None
    lock: asyncio.Lock = dataclass_field(default_factory=asyncio.Lock)


def save_operation(operation, value):
    with database.connect() as db:
        db.execute('CREATE TABLE IF NOT EXISTS nat_operations (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
        db.execute('INSERT OR REPLACE INTO nat_operations VALUES(?,?)', (operation, json.dumps(value)))


def operations():
    with database.connect() as db:
        db.execute('CREATE TABLE IF NOT EXISTS nat_operations (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
        return [json.loads(row[0]) for row in db.execute('SELECT value FROM nat_operations ORDER BY rowid DESC LIMIT 200')]


def audit(message):
    database.record(message, 'Livebox OS · audit réseau')


def fingerprint(rules):
    fields = ('id', 'description', 'externalPort', 'internalPort', 'destinationIPAddress', 'protocol', 'enabled')
    return hashlib.sha256(json.dumps([{k: r.get(k) for k in fields} for r in rules], sort_keys=True).encode()).hexdigest()


def matches(actual, desired):
    return all(str(actual.get(k)) == str(desired.get(k)) for k in ('description', 'externalPort', 'internalPort', 'destinationIPAddress', 'protocol')) and actual.get('enabled') is True


async def cleanup():
    for key, session in list(sessions.items()):
        if key not in auth.sessions or session.expires < time.time() or auth.sessions[key].expires < time.time():
            await disconnect(key)
    for key in list(locks):
        if key not in auth.sessions and not locks[key].locked():
            locks.pop(key, None)


async def disconnect(key):
    session = sessions.pop(key, None)
    if session:
        session.password = None
        if session.task:
            session.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await session.task
        await session.box.close()


async def refresh(session):
    async with session.lock:
        if session.cached and time.time() - session.updated < 10:
            return session.cached
        if not session.box.stok and session.password and time.time() - session.last_login > 60:
            session.last_login = time.time()
            try:
                await session.box.login(session.password)
                audit('Reconnexion TP-Link contrôlée réussie (lecture).')
            except LiveboxError:
                session.password = None
                audit('Reconnexion TP-Link interrompue : nouvelle authentification requise.')
        previous = session.cached
        results = await asyncio.gather(*(session.box.read(section) for section in AX58.READS))
        session.cached = dict(zip(AX58.READS, results))
        session.updated = time.time()
        status = session.cached['status']
        session.history.append({'time': session.updated, 'available': status['available'], 'data': status['data']})
        session.history = session.history[-120:]
        if previous and previous['status']['available'] != status['available']:
            audit('Communication TP-Link rétablie.' if status['available'] else 'Communication TP-Link interrompue.')
        old = clients(previous.get('status', {}).get('data'))
        new = clients(status['data'])
        if previous and status['available']:
            for ip in {d['ip'] for d in old} ^ {d['ip'] for d in new}:
                audit(f'Appareil TP-Link {ip} : présence observée modifiée.')
        return session.cached


async def collector(session):
    while True:
        try:
            await refresh(session)
        except Exception:
            audit('Collecte TP-Link interrompue ; prochain essai dans 30 secondes.')
        await asyncio.sleep(30)


def clients(data):
    result = []
    if not isinstance(data, dict):
        return result
    for key, connection in [('access_devices_wired', 'Ethernet'), ('access_devices_wireless_host', 'Wi-Fi'), ('access_devices_wireless_guest', 'Wi-Fi invité')]:
        values = data.get(key, [])
        if not isinstance(values, (dict, list)):
            continue
        for _, item in entries(values):
            item = item.get('value', item)
            ip = field(item, 'ipaddr', 'ip')
            if ip:
                result.append({'ip': ip, 'name': field(item, 'hostname', 'name', default=ip), 'mac': field(item, 'macaddr', 'mac'), 'connection': connection, 'router': 'tplink'})
    return result


def lb_clients(data):
    result = []
    if isinstance(data, (list, dict)):
        for _, item in entries(data):
            ip = field(item, 'IPAddress')
            if ip:
                result.append({'ip': ip, 'name': field(item, 'Name', default=ip), 'mac': field(item, 'PhysAddress'),
                               'active': field(item, 'Active'), 'connection': field(item, 'Layer2Interface'), 'router': 'livebox'})
    return result


def create_router(authorized):
    router = APIRouter(prefix='/api/network', tags=['Livebox OS 3.0'])

    def key(request):
        return request.cookies.get(auth.COOKIE)

    def tp(request):
        session = sessions.get(key(request))
        if not session or session.expires < time.time():
            raise HTTPException(409, 'Connectez le TP-Link dans l’application Archer AX58.')
        return session

    def lb(request):
        return authorized(request).box

    async def inventory(request):
        value = {'tplink': None, 'livebox': None, 'devices': [], 'link_verified': False}
        t = sessions.get(key(request))
        if t:
            reads = await refresh(t)
            status = reads['status'].get('data') or {}
            net = reads['network'].get('data') or {}
            value['tplink'] = {'url': t.box.url, 'compatible': t.box.compatible, 'identity': t.box.identity,
                               'wan': field(status, 'wan_ipv4_ipaddr'), 'lan': field(status, 'lan_ipv4_ipaddr'),
                               'mask': field(net, 'lan_ipv4_netmask', default=field(status, 'lan_ipv4_netmask')), 'reads': reads}
            value['devices'].extend(clients(status))
        try:
            box = lb(request)
            lan, devices, wan = await asyncio.gather(box.read('NMC', 'getLANIP', data=True),
                                                    box.read('Devices', 'get', {'expression': 'physical and !self and !voice'}), box.read('NMC', 'getWANStatus', data=True))
            data = lan.get('data') or {}
            value['livebox'] = {'url': box.url, 'lan': field(data, 'Address', 'IPAddress'), 'mask': field(data, 'Netmask', 'SubnetMask'), 'lan_result': lan, 'wan': wan}
            value['devices'].extend(lb_clients(devices.get('data')))
            if value['tplink']:
                try:
                    subnet = network(value['livebox']['lan'], value['livebox']['mask'])
                    value['link_verified'] = ipaddress.IPv4Address(value['tplink']['wan']) in subnet
                except (ValueError, TypeError):
                    pass
        except HTTPException:
            pass
        value['updated'] = time.time()
        return value

    async def read_rules(request, name):
        if name == 'tplink':
            result = await tp(request).box.read('ports')
        else:
            result = await lb(request).read('Firewall', 'getPortForwarding')
            if result['available']:
                result['data'] = normalize(result['data'])
        if not result['available']:
            raise ValueError(result.get('message', 'Lecture NAT impossible.'))
        return result['data']

    @router.post('/tplink/login')
    async def login(body: RouterLogin, request: Request):
        auth.throttle(request)
        box = AX58(body.url)
        try:
            await box.login(body.password.get_secret_value(), body.force)
        except (LiveboxError, ValueError, KeyError, TypeError) as error:
            await box.close()
            raise HTTPException(502, str(error) if isinstance(error, LiveboxError) else 'Échange d’authentification TP-Link incompatible.')
        await disconnect(key(request))
        session = RouterSession(box=box, password=body.password.get_secret_value() if body.reconnect else None, last_login=time.time())
        sessions[key(request)] = session
        session.task = asyncio.create_task(collector(session))
        audit('Connexion Archer AX58 établie. ' + ('Firmware compatible confirmé.' if box.compatible else 'Écritures bloquées : firmware non confirmé.'))
        return {'connected': True, 'compatible': box.compatible, 'identity': box.identity}

    @router.post('/tplink/logout')
    async def logout(request: Request):
        await disconnect(key(request))
        return {'connected': False}

    @router.get('/tplink')
    async def state(request: Request):
        session = sessions.get(key(request))
        if not session:
            return {'connected': False}
        return {'connected': bool(session.box.stok), 'url': session.box.url, 'identity': session.box.identity,
                'compatible': session.box.compatible, 'reads': await refresh(session), 'history': session.history,
                'updated': session.updated, 'expires': session.expires, 'reconnect': session.password is not None}

    @router.get('/topology')
    async def topology(request: Request):
        return await inventory(request)

    @router.get('/checks')
    async def checks(request: Request):
        result = {'public_reachability': 'Non testée depuis une source extérieure.', 'client_firewall': 'Non disponible : aucun agent installé sur l’appareil cible.',
                  'tplink_firewall': 'Non disponible : signature de lecture du pare-feu non vérifiée sur ce firmware. Aucune protection n’est désactivée.'}
        try:
            box = lb(request)
            wan = await box.read('NMC', 'getWANStatus', data=True)
            result['wan'] = wan
            try:
                response = await box.request('Firewall', 'getFirewallLevel')
                value = response.get('data', response.get('status'))
                result['livebox_firewall'] = {'available': not isinstance(value, bool) and value is not None, 'data': value if not isinstance(value, bool) else None}
            except LiveboxError as error:
                result['livebox_firewall'] = {'available': False, 'data': None, 'message': str(error)}
            address = field(wan.get('data') or {}, 'IPAddress', 'IPv4Address', 'ExternalIPAddress')
            if address:
                try:
                    ip = ipaddress.IPv4Address(address)
                    result['operator_address'] = {'address': str(ip), 'globally_routable': ip.is_global,
                                                  'message': 'Adresse WAN non globale : un NAT opérateur ou un autre routeur peut empêcher les connexions entrantes.' if not ip.is_global else 'Adresse globale déclarée ; cela ne prouve pas l’ouverture d’un port.'}
                except ValueError:
                    pass
        except HTTPException:
            result['livebox_firewall'] = {'available': False, 'data': None, 'message': 'Livebox non connectée.'}
        return result

    @router.get('/nat')
    async def nat_state(request: Request):
        rules = {}
        for name in ('livebox', 'tplink'):
            try:
                rules[name] = {'available': True, 'data': await read_rules(request, name)}
            except (HTTPException, ValueError) as error:
                rules[name] = {'available': False, 'data': None, 'message': str(error.detail) if isinstance(error, HTTPException) else str(error)}
        observed = operations()
        for operation in observed:
            available = all(rules[r['router']]['available'] for r in operation['rules'])
            present = available and all(any(matches(actual, desired) for actual in rules[desired['router']]['data']) for desired in operation['rules'])
            related = available and any(any(actual['id'] == desired['id'] or actual['description'] == desired['description'] for actual in rules[desired['router']]['data']) for desired in operation['rules'])
            operation['observed_status'] = ('present' if present else 'changed' if related else 'absent') if available else 'not_readable'
        return {'rules': rules, 'operations': observed, 'public_reachability': 'Non testée. NAT, pare-feu des routeurs, pare-feu de l’appareil et réseau opérateur doivent autoriser le trafic.'}

    @router.post('/tplink/nat/prepare')
    async def native_prepare(body: NativePlan, request: Request):
        try:
            box = tp(request).box
            box.require_writes()
            rules = await read_rules(request, 'tplink')
            old = next((r for r in rules if r['id'] == body.id), None)
            if body.action != 'create' and not old:
                raise ValueError('Règle TP-Link introuvable.')
            if old and str(old['description']).startswith('LBO3_'):
                raise ValueError('Règle coordonnée : utilisez NAT avancé pour modifier les deux routeurs ensemble.')
            desired = None
            if body.action != 'delete':
                rule = body.rule
                if not rule or rule.target != 'tplink' or rule.name.startswith('LBO3_'):
                    raise ValueError('Paramètres TP-Link invalides ou nom réservé.')
                info = await inventory(request)
                target = info['tplink']
                subnet = network(target['lan'], target['mask'])
                ip = ipaddress.IPv4Address(rule.destination)
                if ip not in subnet or ip in (subnet.network_address, subnet.broadcast_address, ipaddress.IPv4Address(target['lan'])):
                    raise ValueError('Destination hors du LAN TP-Link.')
                conflict([r for r in rules if not old or r['id'] != old['id']], rule.external, rule.protocol)
                desired = {'id': body.id, 'description': rule.name, 'destinationIPAddress': rule.destination, 'externalPort': str(rule.external), 'internalPort': str(rule.internal), 'protocol': rule.protocol, 'enabled': True, 'router': 'tplink'}
            token = secrets.token_urlsafe(24)
            pending = auth.current(request).pending
            if len(pending) >= 10:
                raise ValueError('Trop de confirmations en attente.')
            pending[token] = {'native_plan': {'action': body.action, 'old': old, 'rule': desired, 'before': fingerprint(rules), 'binding': id(box)}, 'expires': time.time() + 120}
            asyncio.get_running_loop().call_later(120, pending.pop, token, None)
            return {'token': token, 'old': old, 'rule': desired, 'action': body.action, 'warning': 'Modification du TP-Link uniquement. Aucune règle Livebox n’est créée. La disponibilité publique du service n’est pas testée.'}
        except (ValueError, LiveboxError, TypeError) as error:
            raise HTTPException(409, str(error))

    @router.post('/tplink/nat/confirm')
    async def native_confirm(body: Confirmation, request: Request):
        async with write_lock:
            pending = auth.current(request).pending.pop(body.token, None)
            if not pending or pending['expires'] < time.time() or 'native_plan' not in pending:
                raise HTTPException(409, 'Confirmation expirée ou déjà utilisée.')
            plan = pending['native_plan']
            try:
                box = tp(request).box
                rules = await read_rules(request, 'tplink')
                if id(box) != plan['binding'] or fingerprint(rules) != plan['before']:
                    raise ValueError('Session ou règles modifiées depuis la préparation. Aucun changement appliqué.')
            except (ValueError, LiveboxError) as error:
                raise HTTPException(409, str(error))
            audit(f"NAT TP-Link : {plan['action']} confirmé.")
            try:
                if plan['action'] == 'create':
                    await box.add(plan['rule'])
                elif plan['action'] == 'update':
                    await box.update(plan['old'], plan['rule'])
                else:
                    await box.delete(plan['old'], next(i for i, r in enumerate(rules) if r['id'] == plan['old']['id']))
                after = await read_rules(request, 'tplink')
                verified = not any(r['id'] == plan['old']['id'] for r in after) if plan['action'] == 'delete' else sum(matches(r, plan['rule']) for r in after) == 1
                if not verified:
                    raise ValueError('Résultat non confirmé par relecture. Vérifiez les règles avant de recommencer.')
                tp(request).updated = 0
                audit('NAT TP-Link : résultat vérifié par relecture. Accessibilité publique non testée.')
                return {'status': 'verified', 'rules': after}
            except (ValueError, LiveboxError) as error:
                audit('NAT TP-Link : résultat incertain, contrôle manuel nécessaire ; aucune règle existante supprimée automatiquement.')
                return {'status': 'unknown', 'message': str(error)}

    @router.post('/nat/prepare')
    async def prepare(body: Plan, request: Request):
        async with locks.setdefault(key(request), asyncio.Lock()):
            try:
                old = next((op for op in operations() if op['id'] == body.operation), None)
                if body.action != 'create' and (not old or old['status'] not in ('verified', 'partial', 'unknown', 'applying')):
                    raise ValueError('Opération gérée introuvable ou déjà supprimée.')
                if body.action == 'create' and not body.rule or body.action == 'update' and not body.rule:
                    raise ValueError('Règle manquante.')
                operation = body.operation if body.action != 'create' else secrets.token_hex(6)
                desired = []
                inventory_data = await inventory(request)
                if body.action != 'delete':
                    rule = body.rule
                    target = inventory_data.get(rule.target)
                    if not target:
                        raise ValueError('Routeur cible non connecté.')
                    subnet = network(target['lan'], target['mask'])
                    destination = ipaddress.IPv4Address(rule.destination)
                    if destination not in subnet or destination in (subnet.network_address, subnet.broadcast_address, ipaddress.IPv4Address(target['lan'])):
                        raise ValueError('La destination doit être un appareil du LAN cible.')
                    if not any(d['ip'] == rule.destination and d['router'] == rule.target and d.get('active') is not False for d in inventory_data['devices']):
                        raise ValueError('Appareil absent des observations actuelles du routeur cible.')
                    marker = 'LBO3_' + operation
                    common = {'description': marker, 'protocol': rule.protocol, 'enabled': True, 'id': marker, 'origin': 'webui'}
                    if rule.target == 'tplink':
                        tp(request).box.require_writes()
                        if not inventory_data['link_verified']:
                            raise ValueError('Le WAN TP-Link n’est pas confirmé dans le LAN Livebox ; double NAT bloqué.')
                        if inventory_data['tplink']['wan'] == inventory_data['livebox']['lan']:
                            raise ValueError('WAN TP-Link invalide.')
                        desired.append(common | {'router': 'livebox', 'externalPort': str(rule.external), 'internalPort': str(rule.external), 'destinationIPAddress': inventory_data['tplink']['wan']})
                    desired.append(common | {'router': rule.target, 'externalPort': str(rule.external), 'internalPort': str(rule.internal), 'destinationIPAddress': rule.destination})
                current, old_rules = {}, []
                names = {r['router'] for r in desired + (old['rules'] if old else [])}
                if old and {r['router'] for r in old['rules']} != {r['router'] for r in desired} and body.action == 'update':
                    raise ValueError('Conservez le routeur cible ; supprimez puis recréez pour changer le chemin réseau.')
                for name in names:
                    current[name] = await read_rules(request, name)
                    if name == 'tplink':
                        tp(request).box.require_writes()
                    for previous in old['rules'] if old else []:
                        if previous['router'] == name:
                            found = [r for r in current[name] if matches(r, previous)]
                            if not found and body.action == 'delete' and not any(r['id'] == previous['id'] or r['description'] == previous['description'] for r in current[name]):
                                continue
                            if len(found) != 1:
                                raise ValueError('Règle gérée absente ou modifiée hors de Livebox OS : opération bloquée.')
                            old_rules.append(found[0])
                    for rule in [r for r in desired if r['router'] == name]:
                        conflict([r for r in current[name] if not any(r['id'] == p['id'] and r['router'] == p['router'] for p in old_rules)], int(rule['externalPort']), rule['protocol'])
                plan = {'id': operation, 'action': body.action, 'name': body.rule.name if body.rule else old['name'], 'rules': desired,
                        'old_rules': old_rules, 'before': {name: fingerprint(rules) for name, rules in current.items()}, 'created': old.get('created', time.time()) if old else time.time(),
                        'bindings': {'livebox': id(lb(request)), 'tplink': id(tp(request).box) if 'tplink' in names else None}, 'inventory': inventory_data if body.action != 'delete' else None}
                token = secrets.token_urlsafe(24)
                pending = auth.current(request).pending
                if len(pending) > 10:
                    raise ValueError('Trop de confirmations en attente.')
                pending[token] = {'network_plan': plan, 'expires': time.time() + 120}
                asyncio.get_running_loop().call_later(120, pending.pop, token, None)
                return {'token': token, 'plan': {k: v for k, v in plan.items() if k not in ('bindings', 'inventory', 'before')},
                        'warning': 'Cette opération modifie les routeurs et peut exposer le service. Aucun test d’accessibilité publique ne sera déduit de la présence des règles. En cas d’échec de création, seules les nouvelles règles identifiées seront retirées.'}
            except (ValueError, TypeError, LiveboxError) as error:
                raise HTTPException(409, str(error))

    async def write(request, rule, action, old=None):
        if rule['router'] == 'tplink':
            box = tp(request).box
            if action == 'create':
                await box.add(rule)
            elif action == 'update':
                await box.update(old, rule)
            else:
                current = await read_rules(request, 'tplink')
                index = next((i for i, r in enumerate(current) if r['id'] == rule['id'] and matches(r, rule)), None)
                if index is None:
                    raise ValueError('Règle TP-Link absente ou modifiée avant suppression : arrêt sans retrait.')
                await box.delete(rule, index)
            return
        box = lb(request)
        if action == 'delete':
            identifier = rule['id'] if rule['id'].startswith('webui_') else 'webui_' + rule['id']
            await box.request('Firewall', 'deletePortForwarding', {'id': identifier, 'origin': 'webui', 'destinationIPAddress': rule['destinationIPAddress']})
        else:
            await box.request('Firewall', 'setPortForwarding', {'id': (old or rule)['id'].removeprefix('webui_'), 'origin': 'webui', 'description': rule['description'],
                              'externalPort': int(rule['externalPort']), 'internalPort': int(rule['internalPort']), 'destinationIPAddress': rule['destinationIPAddress'],
                              'protocol': {'TCP': '6', 'UDP': '17', 'ALL': '6,17'}[rule['protocol']], 'enable': True, 'persistent': True, 'sourceInterface': 'data', 'destinationMACAddress': ''})
        await box.request('Firewall', 'commit')

    @router.post('/nat/confirm')
    async def confirm(body: Confirmation, request: Request):
        async with write_lock:
            pending = auth.current(request).pending.pop(body.token, None)
            if not pending or pending['expires'] < time.time() or 'network_plan' not in pending:
                raise HTTPException(409, 'Confirmation expirée ou déjà utilisée.')
            plan = pending['network_plan']
            action = plan['action']
            try:
                if id(lb(request)) != plan['bindings']['livebox'] or (plan['bindings']['tplink'] and id(tp(request).box) != plan['bindings']['tplink']):
                    raise ValueError('Session routeur modifiée : préparez à nouveau.')
                for name, digest in plan['before'].items():
                    if fingerprint(await read_rules(request, name)) != digest:
                        raise ValueError('Les règles ont changé depuis la préparation. Aucun changement appliqué.')
                if action != 'delete':
                    current = await inventory(request)
                    for name in ('livebox', 'tplink'):
                        if plan['inventory'].get(name) and any(current.get(name, {}).get(k) != plan['inventory'][name].get(k) for k in ('lan', 'wan', 'mask') if k != 'wan' or name == 'tplink'):
                            raise ValueError('La topologie a changé. Préparez à nouveau.')
                value = {k: v for k, v in plan.items() if k not in ('bindings', 'inventory', 'before')}
                value.update(status='applying', updated=time.time())
                save_operation(plan['id'], value)
                audit(f"NAT {plan['id']} : {action} confirmé, début de l’opération.")
            except (ValueError, LiveboxError) as error:
                raise HTTPException(409, str(error))
            try:
                for rule in plan['old_rules'] if action == 'delete' else plan['rules']:
                    old = next((r for r in plan['old_rules'] if r['router'] == rule['router']), None)
                    await write(request, rule, action, old)
                verified = []
                for name in plan['before']:
                    rules = await read_rules(request, name)
                    for desired in [r for r in (plan['old_rules'] if action == 'delete' else plan['rules']) if r['router'] == name]:
                        found = [r for r in rules if matches(r, desired)]
                        if action == 'delete':
                            if found:
                                raise ValueError('Suppression non confirmée par relecture.')
                        elif len(found) != 1:
                            raise ValueError('Règle absente ou ambiguë après modification.')
                        else:
                            verified.append(found[0])
                value['rules'] = [next(r for r in verified if r['router'] == desired['router']) for desired in plan['rules']] if action != 'delete' else plan['old_rules']
                value['status'] = 'deleted' if action == 'delete' else 'verified'
            except (LiveboxError, ValueError, HTTPException, StopIteration) as error:
                value['error'] = str(error.detail) if isinstance(error, HTTPException) else str(error)
                value['status'] = 'partial'
                # Never roll back an existing rule. Re-read before removing a newly owned rule.
                if action == 'create':
                    uncertain = False
                    for desired in plan['rules']:
                        try:
                            for actual in await read_rules(request, desired['router']):
                                if matches(actual, desired) and actual['description'] == 'LBO3_' + plan['id']:
                                    await write(request, actual, 'delete')
                            if any(matches(r, desired) for r in await read_rules(request, desired['router'])):
                                uncertain = True
                        except (LiveboxError, ValueError, HTTPException):
                            uncertain = True
                    value['status'] = 'unknown' if uncertain else 'rolled_back'
            value['updated'] = time.time()
            if key(request) in sessions:
                sessions[key(request)].updated = 0
            save_operation(plan['id'], value)
            audit(f"NAT {plan['id']} : {value['status']}. Accessibilité publique non testée.")
            return value

    return router
