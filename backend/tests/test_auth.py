import time

from fastapi.testclient import TestClient

from backend import auth, main


def test_application_auth_and_csrf(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, 'DATA', tmp_path)
    monkeypatch.setenv('ORANGE_SETUP_SOURCES', 'testclient')
    auth.sessions.clear()
    auth.attempts.clear()
    with TestClient(main.app, headers={'Origin': 'http://testserver'}) as client:
        assert client.get('/api/profiles').status_code == 401
        assert not client.get('/api/auth/state').json()['configured']
        value = {'username': 'test-admin', 'password': 'test-password-only-12345'}
        response = client.post('/api/auth/setup', json=value)
        assert response.status_code == 200
        assert value['password'] not in (tmp_path / 'account.json').read_text()
        assert '$argon2id$' in (tmp_path / 'account.json').read_text()
        assert client.post('/api/auth/setup', json=value).status_code == 409
        assert client.post('/api/logout', json={}).status_code == 403
        client.headers['X-CSRF-Token'] = response.json()['csrf']
        assert client.post('/api/auth/logout', json={}).status_code == 200
        assert client.get('/api/profiles').status_code == 401
        login = client.post('/api/auth/login', json=value)
        assert login.status_code == 200
        assert client.get('/api/auth/state').json()['authenticated']
        auth.sessions[client.cookies.get(auth.COOKIE)].expires = time.time() - 1
        assert client.get('/api/profiles').status_code == 401


def test_bootstrap_is_restricted(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, 'DATA', tmp_path)
    monkeypatch.setenv('ORANGE_SETUP_SOURCES', '127.0.0.1')
    auth.attempts.clear()
    with TestClient(main.app, headers={'Origin': 'http://testserver'}) as client:
        response = client.post('/api/auth/setup', json={'username': 'admin', 'password': 'test-long-password-only'})
        assert response.status_code == 403
        assert not (tmp_path / 'account.json').exists()


def test_proxy_bootstrap_is_bound_to_approved_browser(monkeypatch, tmp_path):
    import json
    monkeypatch.setattr(auth, 'DATA', tmp_path)
    monkeypatch.setenv('ORANGE_TRUST_PROXY', '1')
    auth.attempts.clear()
    with TestClient(main.app, headers={'Origin': 'http://testserver'}) as browser:
        state = browser.get('/api/auth/state').json()
        assert state['pairing_id'] and not state['setup_allowed']
        cookie = browser.cookies.get('orange_setup')
        identifier, _, secret = cookie.partition('.')
        record = tmp_path / f'pairing-{identifier}.json'
        value = json.loads(record.read_text())
        assert secret not in record.read_text()
        value['approved'] = True
        record.write_text(json.dumps(value))
        assert browser.get('/api/auth/state').json()['setup_allowed']
        with TestClient(main.app, headers={'Origin': 'http://testserver'}) as other_browser:
            assert not other_browser.get('/api/auth/state').json()['setup_allowed']
            response = other_browser.post('/api/auth/setup', json={'username': 'admin', 'password': 'test-strong-password-only'})
            assert response.status_code == 403
        assert browser.post('/api/auth/setup', json={'username': 'admin', 'password': 'test-strong-password-only'}).status_code == 200
