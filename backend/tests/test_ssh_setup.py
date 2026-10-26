import asyncio
import json

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

from backend import connectors, control, ssh_setup
from backend.tests.test_control import client, add


def host_public_key():
    return Ed25519PrivateKey.generate().public_key().public_bytes(serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH).decode()


def test_linux_actual_counter_deltas_and_missing_measurements():
    output = '''CPU
cpu 100 0 50 800 50 0 0 0 0 0
cpu 120 0 60 850 70 0 0 0 0 0
OS
PRETTY_NAME="Debian GNU/Linux test"
UPTIME
1234.5 555
MEMORY
MemTotal: 1000 kB
MemAvailable: 400 kB
DISK
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/test 2000 500 1500 25% /
NETWORK
eth0: 1234 1 0 0 0 0 0 0 5678 1 0 0 0 0 0 0
'''
    result = connectors.linux_system(output)
    assert result['cpu_percent'] == 30.0
    assert result['uptime_seconds'] == 1234.5
    assert result['memory']['used_bytes'] == 600 * 1024
    assert result['disks'][0]['available_bytes'] == 1500 * 1024
    assert result['interfaces'][0]['sent_bytes'] == 5678
    absent = connectors.linux_system('unrecognized output')
    assert absent['cpu_percent'] is None and absent['memory']['used_bytes'] is None and absent['uptime_seconds'] is None


def test_verified_host_identity_is_required_and_only_public_keys_are_returned(client, monkeypatch, tmp_path):
    monkeypatch.delenv('LIVEBOX_OS_SSH_DIR', raising=False)
    assert add(client, kind='server', connector='ssh', username='monitor', key_name='known_hosts').status_code == 422
    key = add(client, kind='server', connector='ssh', username='monitor').json()['id']
    public = host_public_key()
    async def scan(arguments, timeout=15, capture_stderr=False):
        assert arguments[0] == 'ssh-keyscan' and arguments[-1] == '192.168.2.1'
        return 0, '192.168.2.1 ' + public
    monkeypatch.setattr(connectors, 'run_bounded', scan)
    result = client.get(f'/api/control/resources/{key}/host-key').json()
    assert client.post('/api/control/ssh/fingerprint', json={'public_key': public}).json()['fingerprint'] == result['fingerprint']
    assert not result['verified']
    assert client.put(f'/api/control/resources/{key}/host-key', json=result).status_code == 422
    body = result | {'verified': True, 'fingerprint': 'SHA256:wrong'}
    assert client.put(f'/api/control/resources/{key}/host-key', json=body).status_code == 422
    assert client.put(f'/api/control/resources/{key}/host-key', json=result | {'verified': True}).status_code == 200
    known = (connectors.ssh_directory() / 'known_hosts').read_text()
    assert known == f'livebox-os-{key} {public}\n'
    root = connectors.ssh_directory()
    (root / 'monitor.pub').write_text(public)
    (root / 'monitor').write_text('private-test-material-never-returned')
    config = client.get('/api/control/ssh/config')
    assert 'private-test-material' not in config.text
    assert config.json()['keys'][0]['name'] == 'monitor'
    assert client.post('/api/control/ssh/keys', json={'name': '../escape'}).status_code == 422
    assert client.post('/api/control/ssh/keys', json={'name': 'known_hosts'}).status_code == 422
    assert client.post('/api/control/ssh/keys', json={'name': 'key.pub'}).status_code == 422


def test_failed_ssh_test_does_not_create_a_connected_session(client, monkeypatch):
    key = add(client, kind='server', connector='ssh', username='monitor').json()['id']
    async def fail(resource, section): return connectors.unavailable('Clé d’hôte non vérifiée.')
    monkeypatch.setattr(control, 'ssh_read', fail)
    result = client.post(f'/api/control/resources/{key}/connect', json={})
    assert result.status_code == 502 and 'non vérifiée' in result.json()['detail']
    assert not client.get('/api/control/resources').json()[0]['connected']


@pytest.mark.parametrize('stderr,fragment', [('Host key verification failed.', 'Identité SSH'), ('Permission denied (publickey)', 'Authentification SSH'), ('Connection refused', 'port SSH'), ('Connection timed out', 'injoignable')])
def test_ssh_errors_explain_the_cause_without_raw_paths(monkeypatch, tmp_path, stderr, fragment):
    monkeypatch.setenv('LIVEBOX_OS_SSH_DIR', str(tmp_path))
    (tmp_path / 'monitor').write_text('test-file-not-a-key')
    (tmp_path / 'known_hosts').write_text('test-file-not-a-host-key')
    async def run(arguments, timeout=15, capture_stderr=False): return 255, stderr + ' /private/secret-path'
    monkeypatch.setattr(connectors, 'run_bounded', run)
    resource = dict(host='192.168.2.1', key_name='monitor', username='monitor', port=22)
    result = asyncio.run(connectors.ssh_read(resource, 'system'))
    assert not result['available'] and fragment in result['message'] and '/private/' not in json.dumps(result)
