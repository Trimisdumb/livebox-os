import asyncio
import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import auth, connectors, control, database, main
from backend.livebox import redact


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(database, 'DATA', tmp_path)
    monkeypatch.setattr(auth, 'DATA', tmp_path)
    auth.sessions.clear()
    auth.sessions['control-admin'] = auth.AdminSession(csrf='control-csrf')
    control.pending.clear()
    with TestClient(main.app, headers={'Origin': 'http://testserver', 'X-CSRF-Token': 'control-csrf'}) as test:
        test.cookies.set(auth.COOKIE, 'control-admin')
        yield test


def add(client, **changes):
    payload = dict(name='Test equipment', host='192.168.2.1', connector='livebox', authorized=True)
    return client.post('/api/control/resources', json=payload | changes)


class Box:
    def __init__(self):
        self.closed = False
        self.guest = False
        self.writes = []

    async def request(self, service, method, params=None):
        if method == 'set':
            self.writes.append((service, method, params))
            self.guest = params['Enable']
            return {'status': True}
        if service == 'NMC.Guest':
            return {'status': {'Enable': self.guest}}
        if service == 'DeviceInfo':
            return {'status': {'ProductClass': 'Test device', 'UpTime': 90}}
        if service == 'NMC':
            return {'status': True, 'data': {'ConnectionState': 'Connected'}}
        return {'status': []}

    async def close(self):
        self.closed = True


def connect(client, monkeypatch, box=None):
    box = box or Box()
    async def factory(resource, password):
        assert password == 'test-only-password'
        return box
    monkeypatch.setattr(control, 'connect_router', factory)
    key = add(client).json()['id']
    response = client.post(f'/api/control/resources/{key}/connect', json={'password': 'test-only-password'})
    assert response.status_code == 200
    return key, box


@pytest.mark.parametrize('host', ['127.0.0.1', '169.254.169.254', '8.8.8.8', '0.0.0.0', '224.0.0.1', 'http://192.168.2.1/ws', 'http://user:pass@192.168.2.1', 'http://192.168.2.1:8000', 'http://192.168.2.1?secret=abc'])
def test_reject_unauthorized_destinations(client, host):
    assert add(client, host=host).status_code == 422
    assert client.get('/api/control/resources').json() == []


def test_requires_explicit_target_authorization_and_no_credentials_in_profile(client):
    assert add(client, authorized=False).status_code == 422
    assert add(client, password='test-secret').status_code == 422
    assert add(client, connector='asus').status_code == 422
    assert add(client, kind='server', connector='ssh', username='root').status_code == 422
    resource = add(client).json()
    assert resource['id'] and 'password' not in resource
    assert client.put('/api/control/resources/' + resource['id'], json={'name': 'Renamed', 'interval': 90}).status_code == 200
    assert client.get('/api/control/resources').json()[0]['name'] == 'Renamed'


def test_authentication_and_csrf_apply_to_all_control_routes(client):
    client.headers.pop('X-CSRF-Token')
    assert add(client).status_code == 403
    client.cookies.clear()
    assert client.get('/api/control/catalog').status_code == 401
    assert client.get('/api/control/resources').status_code == 401


def test_session_owner_isolation_close_and_secret_not_persisted(client, monkeypatch):
    key, box = connect(client, monkeypatch)
    assert 'test-only-password' not in (database.DATA / 'incidents.sqlite').read_bytes().decode('latin1')
    assert client.get(f'/api/control/resources/{key}/read/info').json()['available']
    auth.sessions['another-admin'] = auth.AdminSession(csrf='another-csrf')
    client.cookies.set(auth.COOKIE, 'another-admin')
    assert client.get(f'/api/control/resources/{key}/read/info').status_code == 409
    client.cookies.set(auth.COOKIE, 'control-admin')
    assert client.post('/api/auth/logout', json={}).status_code == 200
    assert box.closed and not control.sessions


def test_confirmation_bound_to_owner_single_use_and_recheck(client, monkeypatch):
    key, box = connect(client, monkeypatch)
    endpoint = f'/api/control/resources/{key}/actions'
    prepared = client.post(endpoint + '/prepare', json={'action': 'guest', 'enabled': True}).json()
    assert box.writes == []
    assert client.post(endpoint + '/confirm', json={'token': prepared['token'], 'phrase': 'wrong name'}).status_code == 422
    assert box.writes == []
    prepared = client.post(endpoint + '/prepare', json={'action': 'guest', 'enabled': True}).json()
    response = client.post(endpoint + '/confirm', json={'token': prepared['token'], 'phrase': 'Test equipment'})
    assert response.json()['status'] == 'verified'
    assert len(box.writes) == 1
    assert client.post(endpoint + '/confirm', json={'token': prepared['token'], 'phrase': 'Test equipment'}).status_code == 409
    prepared = client.post(endpoint + '/prepare', json={'action': 'guest', 'enabled': False}).json()
    box.guest = False
    assert client.post(endpoint + '/confirm', json={'token': prepared['token'], 'phrase': 'Test equipment'}).status_code == 409
    assert len(box.writes) == 1


def test_expired_confirmations_and_unknown_services(client, monkeypatch):
    key, box = connect(client, monkeypatch)
    endpoint = f'/api/control/resources/{key}'
    prepared = client.post(endpoint + '/actions/prepare', json={'action': 'reboot'}).json()
    control.pending[prepared['token']]['expires'] = time.time() - 1
    assert client.post(endpoint + '/actions/confirm', json={'token': prepared['token'], 'phrase': 'Test equipment'}).status_code == 409
    assert client.get(endpoint + '/read/execute-shell').json()['available'] is False
    assert client.post(endpoint + '/actions/prepare', json={'action': 'factory_reset'}).status_code == 422
    assert box.writes == []


def test_rules_history_notes_and_real_transition_notifications(client, monkeypatch):
    key, _ = connect(client, monkeypatch)
    response = client.post('/api/control/rules', json={'name': 'Availability', 'resource': key, 'event': 'unavailable'})
    rule = response.json()
    assert response.status_code == 201
    before = {'reachable': True, 'devices': [], 'public_ip': None}
    after = before | {'reachable': False}
    control.notify_changes(control.get_resource(key), None, after)
    assert client.get('/api/control/notifications').json() == []
    control.notify_changes(control.get_resource(key), before, after)
    item = client.get('/api/control/notifications').json()[0]
    assert 'inaccessible' in item['message']
    assert client.post(f'/api/control/notifications/{item["id"]}/acknowledge', json={}).status_code == 200
    assert client.post(f'/api/control/rules/{rule["id"]}/test', json={}).json()['tested']
    sample = client.get(f'/api/control/history/{key}').json()['samples'][0]
    assert 'devices' not in sample and 'public_ip' not in sample
    assert client.get(f'/api/control/history/{key}?hours=169').status_code == 422
    assert 'reachable' in client.get(f'/api/control/history/{key}?format=csv').text
    assert client.put('/api/control/notes/192.168.2.3', json={'alias': 'Test alias', 'favorite': True}).status_code == 200
    assert client.get('/api/control/notes').json()[0]['favorite'] is True


def test_openwrt_protocol_is_fixed_and_errors_do_not_expose_credentials():
    seen = []
    def respond(request):
        payload = json.loads(request.content)
        seen.append(payload)
        assert request.url.path == '/ubus'
        if payload['params'][2] == 'login':
            return httpx.Response(200, json={'result': [0, {'ubus_rpc_session': 'a' * 32}]})
        if payload['params'][2] == 'board':
            return httpx.Response(200, json={'result': [0, {'model': 'Test board'}]})
        return httpx.Response(200, json={'result': [6]})
    async def check():
        box = connectors.OpenWrt('http://192.168.2.1', transport=httpx.MockTransport(respond))
        await box.login('monitor', 'test-only-password')
        result = await box.read('info')
        assert result['data']['model'] == 'Test board'
        assert (await box.read('network'))['available'] is False
        await box.close()
        assert box.token == ''
    asyncio.run(check())
    assert seen[0]['params'][0] == '0' * 32
    assert seen[1]['params'][0] == 'a' * 32


@pytest.mark.parametrize('payload', [b'[]', b'{"result":[6]}', b'not json', b'x' * (2 * 1024 * 1024 + 1)], ids=['array', 'denied', 'bad-json', 'oversized'])
def test_openwrt_malformed_and_oversized_responses_fail_closed(payload):
    async def check():
        box = connectors.OpenWrt('http://192.168.2.1', transport=httpx.MockTransport(lambda request: httpx.Response(200, content=payload)))
        result = await box.read('info')
        assert result['available'] is False and result['data'] is None
        await box.close()
    asyncio.run(check())


def test_dns_result_is_pinned_and_public_resolution_rejected(monkeypatch):
    monkeypatch.setattr(socket := connectors.socket, 'getaddrinfo', lambda *args: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('192.168.2.1', 0))])
    assert asyncio.run(connectors.resolve_url('http://router.example')) == 'http://192.168.2.1'
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *args: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('169.254.169.254', 0))])
    with pytest.raises(ValueError):
        asyncio.run(connectors.resolve_url('router.example'))


def test_ssh_host_verification_fixed_commands_and_key_directory(monkeypatch, tmp_path):
    monkeypatch.setenv('LIVEBOX_OS_SSH_DIR', str(tmp_path))
    (tmp_path / 'monitor').write_text('test-file-not-a-key')
    (tmp_path / 'known_hosts').write_text('test-file-not-a-host-key')
    seen = []
    async def run(arguments, timeout=15):
        seen.extend(arguments)
        return 0, 'test-output'
    monkeypatch.setattr(connectors, 'run_bounded', run)
    resource = dict(host='192.168.2.10', username='monitor', port=22, key_name='monitor')
    assert asyncio.run(connectors.ssh_read(resource, 'system'))['available']
    assert 'StrictHostKeyChecking=yes' in seen and 'IdentityAgent=none' in seen
    assert seen[-1] == connectors.SSH_COMMANDS['system']
    assert not asyncio.run(connectors.ssh_read(resource, 'rm -rf /'))['available']
    assert not asyncio.run(connectors.ssh_read(resource | {'key_name': '../outside'}, 'system'))['available']
    assert all('private-key' not in command and 'wg show all dump' not in command for command in connectors.SSH_COMMANDS.values())


@pytest.mark.parametrize('output,expected', [
    ('4 packets transmitted, 3 received, 25% packet loss\nrtt min/avg/max/mdev = 1.00/2.50/4.00/0.5 ms', {'latency_ms': 2.5, 'packet_loss_percent': 25.0}),
    ('Packets: Sent = 4, Received = 4, Lost = 0 (0% loss)\nAverage = 3ms', {'latency_ms': 3.0, 'packet_loss_percent': 0.0}),
    ('perdus = 2 (perte 50%)\nMoyenne = 4 ms', {'latency_ms': 4.0, 'packet_loss_percent': 50.0}),
    ('4 packets transmitted, 0 received, 100% packet loss', {'latency_ms': None, 'packet_loss_percent': 100.0}),
    ('unrecognized output', {'latency_ms': None, 'packet_loss_percent': None}),
])
def test_ping_metrics_are_parsed_or_explicitly_missing(output, expected):
    assert control.ping_metrics(output) == expected


def test_monitoring_cache_and_optional_measurements(client, monkeypatch):
    key = add(client, measure_ping=True).json()['id']
    measured = []
    async def ping(host):
        measured.append(host)
        return {'latency_ms': 12.5, 'packet_loss_percent': 25.0}
    monkeypatch.setattr(control, 'ping_measurement', ping)
    connection = control.Connection(control.get_resource(key), Box())
    async def check():
        first = await control.refresh(connection)
        second = await control.refresh(connection)
        assert first == second
        assert first['summary']['latency_ms'] == 12.5
    asyncio.run(check())
    assert len(measured) == 1
    sample = client.get(f'/api/control/history/{key}').json()['samples'][0]
    assert sample['latency_ms'] == 12.5 and sample['packet_loss_percent'] == 25
    assert '192.168' not in json.dumps(sample)


def test_nested_private_key_redaction():
    result = redact({'vpn': [{'private_key': 'test-material', 'pre-shared-key': 'test-material'}], 'ubus_rpc_session': 'test-material', 'public_key': 'public-test'})
    assert 'test-material' not in json.dumps(result)
    assert result['public_key'] == 'public-test'


def test_router_login_throttle_prevents_repeated_password_attempts(client, monkeypatch):
    key = add(client).json()['id']
    calls = []
    async def refused(resource, password):
        calls.append(True)
        raise connectors.LiveboxError('Test refusal')
    monkeypatch.setattr(control, 'connect_router', refused)
    for _ in range(3):
        assert client.post(f'/api/control/resources/{key}/connect', json={'password': 'test-only-password'}).status_code == 502
    assert client.post(f'/api/control/resources/{key}/connect', json={'password': 'test-only-password'}).status_code == 429
    assert len(calls) == 3


def test_profile_removal_closes_only_its_sessions_and_preserves_observations(client, monkeypatch):
    key, box = connect(client, monkeypatch)
    other = add(client, name='Other test').json()['id']
    response = client.delete(f'/api/control/resources/{key}')
    assert response.status_code == 200 and box.closed
    assert [r['id'] for r in client.get('/api/control/resources').json()] == [other]
    with control.db_open() as db:
        assert db.execute('SELECT COUNT(*) FROM control_samples WHERE resource=?', (key,)).fetchone()[0] == 1
