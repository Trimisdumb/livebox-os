import base64
import time

import httpx
from fastapi.testclient import TestClient

from backend import auth, database, main, operations
from backend.livebox import Livebox, LiveboxError


def client_for(monkeypatch, tmp_path):
    for module in (auth, database, main, operations):
        monkeypatch.setattr(module, 'DATA', tmp_path)
    auth.sessions.clear()
    auth.sessions['operations-test'] = auth.AdminSession(csrf='csrf-test')
    client = TestClient(main.app, headers={'Origin': 'http://testserver', 'X-CSRF-Token': 'csrf-test'})
    client.cookies.set(auth.COOKIE, 'operations-test')
    return client


def test_backup_preferences_wallpaper_and_confirmation(monkeypatch, tmp_path):
    with client_for(monkeypatch, tmp_path) as client:
        preferences = {'theme': 'dark', 'wallpaper': 'custom', 'fit': 'contain', 'blur': 3}
        assert client.put('/api/preferences', json=preferences).status_code == 200
        image = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9kAAAAASUVORK5CYII=')
        assert client.put('/api/wallpaper', content=image, headers={'content-type': 'image/png'}).status_code == 200
        assert client.get('/api/wallpaper').content == image
        assert client.put('/api/wallpaper', content=b'<html>unsafe</html>').status_code == 422
        value = {'name': 'Test', 'url': 'http://192.168.1.1', 'username': 'admin'}
        assert client.post('/api/profiles', json=value).status_code == 200
        backup = client.get('/api/backup').json()
        assert 'hash' not in backup and 'password' not in backup and 'csrf' not in backup
        assert base64.b64decode(backup['wallpaper']) == image
        assert backup['preferences'] == preferences
        prepared = client.post('/api/backup/prepare', json=backup).json()
        assert prepared['profiles'] == 1
        token = prepared['token']
        assert client.post('/api/backup/confirm', json={'token': token}).status_code == 200
        assert client.post('/api/backup/confirm', json={'token': token}).status_code == 409
        assert client.get('/api/preferences').json() == preferences
        assert client.get('/api/profiles').json() == [value]
        assert (tmp_path / 'settings.json').exists()
        backup['profiles'][0]['password'] = 'must-not-store'
        assert client.post('/api/backup/prepare', json=backup).status_code == 422


def test_diagnostics_allowlist_and_persistent_incidents(monkeypatch, tmp_path):
    async def synthetic_ping(host):
        assert host == '1.1.1.1'
        return {'available': True, 'ok': True, 'message': 'test-only'}
    monkeypatch.setattr(operations, 'ping', synthetic_ping)
    operations.last_diagnostic.clear()
    with client_for(monkeypatch, tmp_path) as client:
        assert client.post('/api/diagnostics', json={'test': '192.168.0.50; touch /tmp/unsafe'}).status_code == 422
        assert client.post('/api/diagnostics', json={'test': 'internet', 'target': 'attacker.invalid'}).status_code == 422
        response = client.post('/api/diagnostics', json={'test': 'internet'})
        assert response.status_code == 200 and response.json()['target'] == '1.1.1.1'
        assert client.get('/api/incidents').json()
        assert database.history()[0]['source'] == 'Livebox OS · diagnostic backend'
        assert (tmp_path / 'incidents.sqlite').exists()


def test_storage_is_livebox_only_and_never_a_server_mount(monkeypatch, tmp_path):
    class Box:
        auth_valid = True
        async def read(self, service, method, *args):
            assert service.startswith(('StorageService', 'Devices'))
            return {'available': True, 'data': []}
    with client_for(monkeypatch, tmp_path) as client:
        session = main.Session(Box(), 'test')
        main.sessions['storage-only'] = session
        client.cookies.set(main.COOKIE, 'storage-only')
        response = client.get('/api/storage')
        assert response.status_code == 200
        result = response.json()
        assert result['source'] == 'Livebox · USB uniquement'
        assert not any(result['file_access']['operations'].values())
        assert result['disks']['data'] == []
        main.sessions.pop('storage-only')


def test_livebox_expired_and_invalid_response(monkeypatch):
    import asyncio
    async def scenario():
        for status, code in ((401, 'LIVEBOX_SESSION_EXPIRED'), (403, 'LIVEBOX_SERVICE_REFUSED'), (404, 'LIVEBOX_HTTP_ERROR')):
            box = Livebox('192.168.1.1', transport=httpx.MockTransport(lambda _, status=status: httpx.Response(status)))
            result = await box.read('DeviceInfo', 'get')
            assert result['code'] == code
            assert box.auth_valid is (status != 401)
            await box.client.aclose()
        box = Livebox('192.168.1.1', transport=httpx.MockTransport(lambda _: httpx.Response(200, json={'status': True})))
        assert not (await box.read('Devices', 'get'))['available']
        await box.client.aclose()
    asyncio.run(scenario())

