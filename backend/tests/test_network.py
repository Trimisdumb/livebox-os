import asyncio
import hashlib
import hmac
import json
from urllib.parse import parse_qs

import httpx
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend import auth, database, main, network
from backend.nat import conflict, normalize
from backend.tplink import AX58


def test_supplied_livebox_object_and_array():
    data = {'webui_ExampleGame': {'Id': 'webui_ExampleGame', 'Origin': 'webui', 'Description': 'ExampleGame', 'Status': 'Enabled', 'Protocol': '6', 'ExternalPort': '25565', 'InternalPort': '25565', 'DestinationIPAddress': '192.168.1.2', 'Enable': True}}
    rule = normalize(data)[0]
    assert rule['description'] == 'ExampleGame' and rule['protocol'] == 'TCP'
    assert rule['externalPort'] == '25565' and rule['destinationIPAddress'] == '192.168.1.2' and rule['enabled'] is True
    assert normalize(list(data.values())) == normalize(data)
    assert normalize([{'key': 'key0', 'value': {'name': 'Example', 'protocol': 'UDP', 'external_port': '5', 'internal_port': '6', 'enable': 'on', 'ipaddr': '192.168.0.2'}}], 'tplink')[0]['id'] == 'key0'
    with pytest.raises(ValueError, match='Conflit'):
        conflict([rule], 25565, 'TCP')
    conflict([rule], 25565, 'UDP')


def test_ax58_crypto_exchange_isolated_not_a_real_router():
    async def scenario():
        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        numbers = private.public_key().public_numbers()
        public = [format(numbers.n, 'x'), format(numbers.e, 'x')]
        box = None
        calls = []
        def respond(request):
            nonlocal box
            path = str(request.url).split('/;stok=')[-1]
            params = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
            if 'form=config' in path:
                return httpx.Response(200, json={'success': True, 'data': {'certification': ['SG CLS L1 STAGE2']}})
            if 'form=keys' in path:
                return httpx.Response(200, json={'success': True, 'data': {'password': public}})
            if 'form=auth' in path:
                return httpx.Response(200, json={'success': True, 'data': {'key': public, 'seq': 12345}})
            login = 'form=login' in path
            if login:
                decoded = ''.join(private.decrypt(bytes.fromhex(params['sign'][i:i+512]), padding.OAEP(mgf=padding.MGF1(hashes.SHA1()), algorithm=hashes.SHA1(), label=None)).decode() for i in range(0, len(params['sign']), 512))
                assert decoded == f'k={box.key.decode()}&i={box.iv.decode()}&h={hashlib.sha256(b"adminexample-only").hexdigest()}&s={12345 + len(params["data"])}'
            else:
                message = f'h={hashlib.sha256(params["data"].encode()).hexdigest()}&s={12345 + len(params["data"])}'
                key = f'k={box.key.decode()}&i={box.iv.decode()}'.encode()
                assert params['sign'] == ''.join(hmac.new(key, message[i:i+53].encode(), hashlib.sha256).hexdigest() for i in range(0, len(message), 53))
            plain = {k: v[0] for k, v in parse_qs(box.aes(params['data'], decrypt=True)).items()}
            calls.append(plain)
            if login:
                assert private.decrypt(bytes.fromhex(plain['password']), padding.PKCS1v15()) == b'example-only'
                data = {'stok': '0' * 32}
            elif 'firmware' in path:
                data = {'model': 'Archer AX58', 'hardware_version': 'Archer AX58 v1.0', 'firmware_version': '1.5.2 Build 20250812 rel.38324(4555)'}
            else:
                data = [{'key': 'entry0', 'value': {'name': 'test', 'protocol': 'TCP', 'external_port': '80', 'internal_port': '80', 'ipaddr': '192.168.0.2', 'enable': 'on'}}]
            return httpx.Response(200, json={'data': box.aes(json.dumps({'success': True, 'data': data}))})
        box = AX58('192.168.0.1', httpx.MockTransport(respond))
        await box.login('example-only')
        assert box.compatible
        result = await box.read('ports')
        assert result['available'] and result['data'][0]['id'] == 'entry0'
        assert 'stok' not in str(result)
        await box.close()
    asyncio.run(scenario())


@pytest.fixture
def coordinator(monkeypatch, tmp_path):
    monkeypatch.setattr(database, 'DATA', tmp_path)
    auth.sessions.clear()
    auth.sessions['test-admin'] = auth.AdminSession(csrf='csrf')
    stores = {'livebox': [], 'tplink': []}
    fail = {'tplink': False}
    class Box:
        url = 'http://192.168.1.1'
        async def read(self, service, method, *args, **kwargs):
            if method == 'getPortForwarding':
                data = [{**r, 'protocol': {'TCP': '6', 'UDP': '17', 'ALL': '6,17'}[r['protocol']], 'Enable': True} for r in stores['livebox']]
            elif method == 'getLANIP':
                data = {'Address': '192.168.1.1', 'Netmask': '255.255.255.0'}
            elif service == 'Devices':
                data = []
            else:
                data = {}
            return {'available': True, 'data': data}
        async def request(self, service, method, values=None):
            if method == 'setPortForwarding':
                identifier = 'webui_' + values['id']
                stores['livebox'][:] = [r for r in stores['livebox'] if r['id'] != identifier]
                stores['livebox'].append(values | {'id': identifier, 'protocol': {'6': 'TCP', '17': 'UDP', '6,17': 'ALL'}[values['protocol']], 'enabled': True, 'router': 'livebox'})
            elif method == 'deletePortForwarding':
                stores['livebox'][:] = [r for r in stores['livebox'] if r['id'].removeprefix('webui_') != values['id'].removeprefix('webui_')]
    lb = Box()
    class TP:
        stok = 'isolated-test'
        compatible = True
        url = 'http://192.168.0.1'
        identity = {}
        def require_writes(self): pass
        async def read(self, section):
            if section != 'ports':
                return t.cached.get(section, {'available': True, 'data': {}})
            return {'available': True, 'data': stores['tplink']}
        async def add(self, rule):
            if fail['tplink']:
                raise network.LiveboxError('isolated-test failure')
            stores['tplink'].append(rule | {'id': 'entry' + str(len(stores['tplink'])), 'raw': {}})
        async def delete(self, rule, index):
            stores['tplink'].pop(index)
        async def update(self, old, new):
            stores['tplink'][:] = [new | {'id': r['id'], 'raw': {}} if r['id'] == old['id'] else r for r in stores['tplink']]
    t = network.RouterSession(TP())
    t.cached = {'status': {'available': True, 'data': {'wan_ipv4_ipaddr': '192.168.1.2', 'lan_ipv4_ipaddr': '192.168.0.1', 'access_devices_wired': [{'ipaddr': '192.168.0.50', 'hostname': 'test-client'}]}}, 'network': {'available': True, 'data': {'lan_ipv4_netmask': '255.255.255.0'}}}
    t.updated = network.time.time()
    network.sessions['test-admin'] = t
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(network.create_router(lambda _: type('LBSession', (), {'box': lb})()))
    with TestClient(app) as client:
        client.cookies.set(auth.COOKIE, 'test-admin')
        yield client, stores, fail
    network.sessions.clear()
    network.locks.clear()


def prepared(client, action='create', operation=None, external=25566):
    result = client.post('/api/network/nat/prepare', json={'action': action, 'operation': operation, 'rule': None if action == 'delete' else {'name': 'Test only', 'target': 'tplink', 'destination': '192.168.0.50', 'external': external, 'internal': 25566, 'protocol': 'TCP'}})
    assert result.status_code == 200, result.text
    return result.json()


def test_double_nat_create_update_delete_and_single_use_confirmation(coordinator):
    client, stores, _ = coordinator
    p = prepared(client)
    assert len(p['plan']['rules']) == 2 and not stores['livebox']
    result = client.post('/api/network/nat/confirm', json={'token': p['token']})
    assert result.json()['status'] == 'verified', result.text
    assert [r['router'] for r in result.json()['rules']] == ['livebox', 'tplink']
    assert stores['livebox'][0]['destinationIPAddress'] == '192.168.1.2'
    assert stores['tplink'][0]['destinationIPAddress'] == '192.168.0.50'
    assert client.post('/api/network/nat/confirm', json={'token': p['token']}).status_code == 409
    op = result.json()['id']
    p = prepared(client, 'update', op, 25567)
    assert client.post('/api/network/nat/confirm', json={'token': p['token']}).json()['status'] == 'verified'
    assert stores['tplink'][0]['externalPort'] == '25567'
    p = prepared(client, 'delete', op)
    assert client.post('/api/network/nat/confirm', json={'token': p['token']}).json()['status'] == 'deleted'
    assert not stores['livebox'] and not stores['tplink']


def test_partial_creation_rolls_back_only_owned_rule(coordinator):
    client, stores, fail = coordinator
    old = {'id': 'existing', 'description': 'Existing', 'externalPort': '22', 'internalPort': '22', 'destinationIPAddress': '192.168.1.20', 'protocol': 'TCP', 'enabled': True, 'router': 'livebox'}
    stores['livebox'].append(old)
    fail['tplink'] = True
    p = prepared(client)
    result = client.post('/api/network/nat/confirm', json={'token': p['token']}).json()
    assert result['status'] == 'rolled_back', result
    assert stores['livebox'] == [old] and not stores['tplink']


def test_prepare_conflicts_and_changed_snapshot_block_writes(coordinator):
    client, stores, _ = coordinator
    p = prepared(client)
    stores['tplink'].append({'id': 'foreign', 'description': 'Other', 'externalPort': '25566', 'internalPort': '25566', 'destinationIPAddress': '192.168.0.20', 'protocol': 'TCP', 'enabled': True, 'router': 'tplink'})
    result = client.post('/api/network/nat/confirm', json={'token': p['token']})
    assert result.status_code == 409 and not stores['livebox']
    result = client.post('/api/network/nat/prepare', json={'action': 'create', 'rule': {'name': 'Test', 'target': 'tplink', 'destination': '192.168.0.50', 'external': 25566, 'internal': 25566}})
    assert result.status_code == 409


def test_native_tp_rules_require_confirmation_and_preserve_existing(coordinator):
    client, stores, _ = coordinator
    body = {'action': 'create', 'rule': {'name': 'NativeTest', 'target': 'tplink', 'destination': '192.168.0.50', 'external': 25568, 'internal': 25568, 'protocol': 'UDP'}}
    plan = client.post('/api/network/tplink/nat/prepare', json=body)
    assert plan.status_code == 200, plan.text
    assert not stores['tplink']
    result = client.post('/api/network/tplink/nat/confirm', json={'token': plan.json()['token']})
    assert result.json()['status'] == 'verified', result.text
    old = stores['tplink'][0]
    body['action'], body['id'] = 'update', old['id']
    body['rule']['internal'] = 25569
    plan = client.post('/api/network/tplink/nat/prepare', json=body).json()
    assert client.post('/api/network/tplink/nat/confirm', json={'token': plan['token']}).json()['status'] == 'verified'
    assert stores['tplink'][0]['internalPort'] == '25569'
    plan = client.post('/api/network/tplink/nat/prepare', json={'action': 'delete', 'id': old['id']}).json()
    assert client.post('/api/network/tplink/nat/confirm', json={'token': plan['token']}).json()['status'] == 'verified'
    assert not stores['tplink'] and not stores['livebox']


def test_firmware_gate_and_topology_gate(coordinator):
    client, stores, _ = coordinator
    session = network.sessions['test-admin']
    session.cached['status']['data']['wan_ipv4_ipaddr'] = '10.0.0.2'
    result = client.post('/api/network/nat/prepare', json={'action': 'create', 'rule': {'name': 'Test', 'target': 'tplink', 'destination': '192.168.0.50', 'external': 25569, 'internal': 25569}})
    assert result.status_code == 409 and 'WAN' in result.text and not stores['livebox']
    box = AX58('192.168.0.1')
    with pytest.raises(network.LiveboxError, match='Écriture bloquée'):
        box.require_writes()
    asyncio.run(box.close())
