import asyncio
import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import main
from backend import auth, database, operations
from backend.livebox import Livebox, LiveboxError, local_url, redact


@pytest.mark.parametrize('address', ['http://127.0.0.1', 'http://169.254.169.254', 'http://8.8.8.8', 'http://example.com', 'http://192.168.1.1:8080', 'http://user:pass@192.168.1.1', 'http://192.168.1.1/ws', 'ftp://192.168.1.1', 'http://[::1]', 'http://192.168.1.1?target=evil'])
def test_reject_non_router_targets(address):
    with pytest.raises(ValueError):
        local_url(address)


def test_allow_private_ipv4():
    assert local_url('192.168.1.1') == 'http://192.168.1.1'
    assert local_url('https://10.0.0.1/') == 'https://10.0.0.1'


@pytest.fixture
def setup_client(monkeypatch, tmp_path):
    calls = []

    def router(request):
        body = json.loads(request.content)
        calls.append((body, dict(request.headers)))
        service, method = body['service'], body['method']
        if method == 'createContext':
            assert request.headers['Authorization'] == 'X-Sah-Login'
            return httpx.Response(200, json={'data': {'contextID': 'test-context'}}, headers={'set-cookie': 'sid=test-cookie; Path=/'})
        assert request.headers['X-Context'] == 'test-context'
        assert 'sid=test-cookie' in request.headers.get('Cookie', '')
        if service == 'sysbus.DeviceInfo':
            payload = {'status': {'ProductClass': 'Livebox Fibre', 'SoftwareVersion': 'test-only', 'UpTime': 90}}
        elif method == 'getWANStatus':
            payload = {'status': True, 'data': {'ConnectionState': 'Connected', 'LinkType': 'gpon'}}
        elif service == 'sysbus.HomeLan.Interface':
            payload = {'status': {'gpon0': {'FriendlyName': 'WAN_GPON'}}}
        elif method == 'getNetDevStats':
            payload = {'status': {'RxBytes': 1000, 'TxBytes': 2000}}
        elif method == 'getMIBs':
            payload = {'status': {
                'wlanvap': {'wl0': {'SSID': 'Test-only', 'Security': {'KeyPassPhrase': 'existing-secret'}}, 'wl1': {'SSID': 'Test-only'}},
                'base': {'wl0': {'Enable': True, 'LLIntf': {'wifi0': True}}, 'wl1': {'Enable': True, 'LLIntf': {'wifi1': True}}},
                'wlanradio': {'wifi0': {'OperatingFrequencyBand': '2.4GHz', 'Channel': 1, 'AutoChannelEnable': True, 'PossibleChannels': '1,6,11'}, 'wifi1': {'OperatingFrequencyBand': '5GHz', 'Channel': 36, 'AutoChannelEnable': True, 'PossibleChannels': '36,40,44,48'}}
            }}
        elif service == 'sysbus.Devices':
            payload = {'status': []}
        elif method == 'getPortForwarding':
            payload = {'status': {}}
        elif method == 'getCallList':
            payload = {'errors': [{'description': 'unsupported'}]}
        else:
            payload = {'status': True}
        return httpx.Response(200, json={'result': payload})

    monkeypatch.setattr(main, 'Livebox', lambda url: Livebox(url, transport=httpx.MockTransport(router)))
    monkeypatch.setattr(main, 'DATA', tmp_path)
    monkeypatch.setattr(auth, 'DATA', tmp_path)
    monkeypatch.setattr(database, 'DATA', tmp_path)
    monkeypatch.setattr(operations, 'DATA', tmp_path)
    auth.sessions.clear()
    auth.sessions['test-admin'] = auth.AdminSession(csrf='test-csrf')
    main.attempts.clear()
    with TestClient(main.app, headers={'Origin': 'http://testserver', 'X-CSRF-Token': 'test-csrf'}) as client:
        client.cookies.set(auth.COOKIE, 'test-admin')
        yield client, calls, tmp_path


def sign_in(client):
    response = client.post('/api/login', json={'name': 'Test', 'url': '192.168.1.1', 'username': 'admin', 'password': 'test-password-only'})
    assert response.status_code == 200
    return response


def test_livebox_cookie_respects_explicit_https_proxy_setting(setup_client, monkeypatch):
    client, _, _ = setup_client
    monkeypatch.setenv('ORANGE_COOKIE_SECURE', '1')
    response = sign_in(client)
    assert 'secure' in response.headers['set-cookie'].lower()


def test_login_cookie_and_real_protocol(setup_client):
    client, calls, _ = setup_client
    response = sign_in(client)
    cookie = response.headers['set-cookie'].lower()
    assert 'httponly' in cookie and 'samesite=strict' in cookie
    assert 'test-context' not in response.text and 'test-password-only' not in response.text
    status = client.get('/api/status').json()
    assert status['info']['data']['ProductClass'] == 'Livebox Fibre'
    assert status['interface'] == 'gpon0'
    assert any(body['service'] == 'sysbus.NeMo.Intf.gpon0' for body, _ in calls)
    assert client.get('/api/read/devices').json()['data'] == []
    assert client.get('/api/read/calls').json()['available'] is False
    assert client.get('/api/read/arbitrary').status_code == 404
    assert client.post('/api/logout', json={}).status_code == 200
    assert client.get('/api/status').status_code == 401
    policy = client.get('/api/health').headers['content-security-policy']
    assert 'ws://testserver' in policy and 'wss://testserver' in policy
    assert 'connect-src *' not in policy


def test_origin_and_host_protection(setup_client):
    client, _, _ = setup_client
    assert client.post('/api/login', json={}, headers={'Origin': 'https://evil.example'}).status_code == 403
    assert client.get('/api/health', headers={'Host': 'evil.example'}).status_code == 400
    assert client.get('/api/status').status_code == 401


def test_profiles_never_accept_credentials(setup_client):
    client, _, directory = setup_client
    value = {'name': 'Maison', 'url': 'http://192.168.1.1', 'username': 'admin'}
    assert client.post('/api/profiles', json=value | {'password': 'do-not-store'}).status_code == 422
    assert client.post('/api/profiles', json=value).status_code == 200
    saved = (directory / 'profiles.json').read_text(encoding='utf-8')
    assert 'password' not in saved and 'context' not in saved
    assert client.get('/api/profiles').json() == [value]
    assert client.put('/api/profiles/Maison', json=value | {'name': 'Bureau'}).status_code == 200
    assert client.get('/api/profiles').json()[0]['name'] == 'Bureau'
    assert client.delete('/api/profiles/Bureau').json() == []


def test_confirmation_is_session_bound_and_one_use(setup_client):
    client, calls, _ = setup_client
    sign_in(client)
    response = client.post('/api/changes/prepare', json={'kind': 'wifi', 'values': {'enabled': False}})
    assert response.status_code == 200
    token = response.json()['token']
    assert not any(body['method'] == 'set' for body, _ in calls)
    original_cookie = client.cookies.get(main.COOKIE)
    client.cookies.clear()
    assert client.post('/api/changes/confirm', json={'token': token}).status_code == 401
    client.cookies.set(main.COOKIE, original_cookie)
    client.cookies.set(auth.COOKIE, 'test-admin')
    assert client.post('/api/changes/confirm', json={'token': token}).status_code == 200
    assert client.post('/api/changes/confirm', json={'token': token}).status_code == 409
    write = next(body for body, _ in calls if body['method'] == 'setProfiles')
    assert write['parameters']['profiles'] == [{'profile': 'WiFi', 'enable': False}]


def test_expired_confirmation(setup_client):
    client, calls, _ = setup_client
    sign_in(client)
    token = client.post('/api/changes/prepare', json={'kind': 'wifi', 'values': {'enabled': True}}).json()['token']
    session = main.sessions[client.cookies.get(main.COOKIE)]
    session.pending[token]['expires'] = time.time() - 1
    assert client.post('/api/changes/confirm', json={'token': token}).status_code == 409
    assert not any(body['method'] == 'setProfiles' for body, _ in calls)


def test_port_rule_and_commit(setup_client):
    client, calls, _ = setup_client
    sign_in(client)
    values = {'id': 'test', 'internalPort': 8080, 'externalPort': 8081, 'destinationIPAddress': '192.168.1.20', 'protocol': '6', 'description': 'test-only'}
    token = client.post('/api/changes/prepare', json={'kind': 'port_add', 'values': values}).json()['token']
    assert client.post('/api/changes/confirm', json={'token': token}).status_code == 200
    methods = [body['method'] for body, _ in calls]
    assert methods.index('setPortForwarding') < methods.index('commit')
    rule = next(body['parameters'] for body, _ in calls if body['method'] == 'setPortForwarding')
    assert rule['origin'] == 'webui' and rule['persistent'] is True
    token = client.post('/api/changes/prepare', json={'kind': 'port_delete', 'values': {'id': 'test', 'origin': 'webui', 'destinationIPAddress': '192.168.1.20'}}).json()['token']
    assert client.post('/api/changes/confirm', json={'token': token}).status_code == 200
    assert next(body['parameters']['id'] for body, _ in calls if body['method'] == 'deletePortForwarding') == 'webui_test'


def test_invalid_network_changes(setup_client):
    client, calls, _ = setup_client
    sign_in(client)
    dhcp = {'Address': '192.168.1.1', 'Netmask': '255.255.255.0', 'DHCPEnable': True, 'DHCPMinAddress': '192.168.1.1', 'DHCPMaxAddress': '192.168.1.250'}
    assert client.post('/api/changes/prepare', json={'kind': 'dhcp', 'values': dhcp}).status_code == 422
    dhcp['DHCPMinAddress'] = '192.168.1.10'
    prepared = client.post('/api/changes/prepare', json={'kind': 'dhcp', 'values': dhcp}).json()
    assert prepared['values']['PrefixLength'] == 24
    assert client.post('/api/changes/confirm', json={'token': prepared['token']}).status_code == 200
    assert any(body['service'] == 'sysbus.NetMaster.LAN.default.Bridge.lan' for body, _ in calls)
    assert client.post('/api/changes/prepare', json={'kind': 'wifi', 'values': {'enabled': 'false'}}).status_code == 422


def test_wifi_configuration_never_returns_keys(setup_client):
    client, calls, _ = setup_client
    sign_in(client)
    response = client.get('/api/read/wifi_config')
    assert 'existing-secret' not in response.text
    prepared = client.post('/api/changes/prepare', json={'kind': 'wifi_config', 'values': {'SSID': 'New-test-only', 'password': 'new-test-only-key'}})
    assert prepared.status_code == 200
    assert 'new-test-only-key' not in prepared.text
    assert client.post('/api/changes/confirm', json={'token': prepared.json()['token']}).status_code == 200
    mibs = next(body['parameters']['mibs'] for body, _ in calls if body['method'] == 'setWLANConfig')
    assert set(mibs['wlanvap']) == {'wl0', 'wl1'}
    assert mibs['wlanvap']['wl0']['Security']['KeyPassPhrase'] == 'new-test-only-key'
    assert all('KeyPassPhrase' not in json.dumps(entry) for entry in client.get('/api/events').json())


def test_wifi_bands_and_supported_channels(setup_client):
    client, calls, _ = setup_client
    sign_in(client)
    response = client.get('/api/wifi/bands')
    assert response.status_code == 200
    assert [band['band'] for band in response.json()['data']] == ['2.4GHz', '5GHz']
    assert 'KeyPassPhrase' not in response.text and 'existing-secret' not in response.text
    values = {'interface': 'wifi0', 'auto': False, 'channel': 6}
    prepared = client.post('/api/changes/prepare', json={'kind': 'wifi_radio', 'values': values})
    assert prepared.status_code == 200
    assert client.post('/api/changes/confirm', json={'token': prepared.json()['token']}).status_code == 200
    mibs = next(body['parameters']['mibs'] for body, _ in calls if body['method'] == 'setWLANConfig')
    assert mibs['wlanradio']['wifi0'] == {'AutoChannelEnable': False, 'Channel': 6}
    values['channel'] = 10
    assert client.post('/api/changes/prepare', json={'kind': 'wifi_radio', 'values': values}).status_code == 422


def test_validation_errors_do_not_echo_secrets(setup_client):
    client, _, _ = setup_client
    response = client.post('/api/login', json={'password': 'private-input'})
    assert response.status_code == 422 and 'private-input' not in response.text


def test_websocket_uses_authenticated_session(setup_client):
    client, _, _ = setup_client
    sign_in(client)
    client.get('/api/status')
    with client.websocket_connect('/api/ws', headers={'origin': 'http://testserver'}) as socket:
        data = socket.receive_json()
        assert data['info']['data']['ProductClass'] == 'Livebox Fibre'
        assert 'events' in data and 'history' in data


def test_malformed_router_data_and_secret_redaction():
    async def scenario():
        box = Livebox('192.168.1.1', transport=httpx.MockTransport(lambda _: httpx.Response(200, json=[])))
        with pytest.raises(LiveboxError):
            await box.request('DeviceInfo', 'get')
        await box.client.aclose()
    asyncio.run(scenario())
    assert redact({'Security': {'KeyPassPhrase': 'private'}, 'SSID': 'Maison'}) == {'Security': {'KeyPassPhrase': '••••••••'}, 'SSID': 'Maison'}


def test_counter_reset_does_not_generate_false_traffic():
    class CounterBox:
        rx = 1000
        async def read(self, service, method, *args, **kwargs):
            return {'available': True, 'data': {'RxBytes': self.rx, 'TxBytes': self.rx}} if method == 'getNetDevStats' else {'available': True, 'data': {}}
    async def scenario():
        box = CounterBox()
        session = main.Session(box, 'test', interface='gpon0')
        await main.refresh(session)
        assert session.snapshot['rate']['down'] is None
        session.previous = (time.time() - 10, 1000, 1000)
        box.rx = 2000
        await main.refresh(session)
        assert 0.0007 < session.snapshot['rate']['down'] < 0.0009
        box.rx = 100
        await main.refresh(session)
        assert session.snapshot['rate']['down'] is None
    asyncio.run(scenario())
