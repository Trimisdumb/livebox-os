import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend import auth, database, main


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, 'DATA', tmp_path)
    monkeypatch.setattr(database, 'DATA', tmp_path)
    auth.sessions.clear()
    auth.sessions['profile-a'] = auth.AdminSession(username='alice', csrf='profile-csrf')
    auth.sessions['profile-b'] = auth.AdminSession(username='bob', csrf='profile-csrf')
    with TestClient(main.app, headers={'Origin': 'http://testserver', 'X-CSRF-Token': 'profile-csrf'}) as test:
        test.cookies.set(auth.COOKIE, 'profile-a')
        yield test


def photo(color='#ff7900'):
    image = Image.new('RGB', (500, 300), color)
    stream = io.BytesIO()
    image.save(stream, format='PNG')
    return stream.getvalue()


def test_profile_name_avatar_persistence_and_account_isolation(client):
    assert client.get('/api/user/profile').json()['display_name'] == 'alice'
    assert client.put('/api/user/profile', json={'display_name': 'Élodie'}).status_code == 200
    saved = client.put('/api/user/avatar', content=photo())
    assert saved.status_code == 200 and saved.json()['avatar_revision']
    image = client.get('/api/user/avatar')
    assert image.headers['content-type'] == 'image/webp'
    with Image.open(io.BytesIO(image.content)) as decoded:
        assert decoded.size == (256, 256) and not decoded.getexif()
    auth.sessions['profile-a'] = auth.AdminSession(username='alice', csrf='profile-csrf')
    assert client.get('/api/user/profile').json()['display_name'] == 'Élodie'
    assert client.get('/api/user/avatar').content == image.content
    client.cookies.set(auth.COOKIE, 'profile-b')
    assert client.get('/api/user/profile').json()['display_name'] == 'bob'
    assert client.get('/api/user/avatar').status_code == 404
    client.cookies.set(auth.COOKIE, 'profile-a')
    assert client.put('/api/user/avatar', content=photo('#0044aa')).status_code == 200
    assert client.get('/api/user/avatar').content != image.content
    assert client.delete('/api/user/avatar').json()['avatar_revision'] is None
    assert client.get('/api/user/profile').json()['display_name'] == 'Élodie'
    assert client.get('/api/user/avatar').status_code == 404


def test_profile_and_image_validation_and_csrf(client):
    assert client.put('/api/user/avatar', content=b'<svg onload="bad"/>').status_code == 422
    assert client.put('/api/user/avatar', content=b'x' * (5 * 1024 * 1024 + 1)).status_code == 413
    assert client.put('/api/user/profile', json={'display_name': '  '}).status_code == 422
    assert client.put('/api/user/profile', json={'display_name': 'bad\x00name'}).status_code == 422
    assert client.put('/api/user/profile', json={'display_name': 'ok', 'username': 'bob'}).status_code == 422
    assert client.put('/api/user/profile', json={'display_name': 'ok'}, headers={'X-CSRF-Token': 'wrong'}).status_code == 403
    client.cookies.clear()
    assert client.get('/api/user/profile').status_code == 401
    assert client.get('/api/user/avatar').status_code == 401
