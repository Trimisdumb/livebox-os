import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.nat import normalize_section
from backend.shares import ShareLogin, safe_path


@pytest.mark.parametrize('path', ['../secret', '/etc/passwd', r'\\192.168.0.2\other', 'a/../b', 'file:stream', 'a//b', 'a/./b', 'a\x00b', 'name.'])
def test_share_paths_cannot_escape(path):
    with pytest.raises(ValueError):
        safe_path(path)


def test_private_share_and_relative_path():
    assert safe_path('Folder/file.txt') == 'Folder\\file.txt'
    assert safe_path('') == ''
    for host in ('127.0.0.1', '8.8.8.8', 'server.invalid', 'http://192.168.0.1'):
        with pytest.raises(ValueError):
            ShareLogin(host=host, share='test', username='test', password='test')


def test_new_endpoints_require_application_auth():
    with TestClient(main.app) as client:
        for path in ('/api/shares', '/api/shares/browse', '/api/network/tplink', '/api/network/nat', '/api/network/topology', '/api/openapi.json'):
            assert client.get(path).status_code == 401


def test_other_sections_keep_raw_fields_and_map_casing():
    source = {'remoteNumber': '0123', 'Duration': 12, 'CallType': 'incoming', 'StartTime': '2026-10-25'}
    row = normalize_section({'entry0': source}, 'calls')[0]
    assert row['duration'] == 12 and row['startTime'] == '2026-10-25' and row['Duration'] == 12
    device = normalize_section([{'ipaddress': '192.168.1.2', 'hostname': 'Test', 'active': True}], 'devices')[0]
    assert device['IPAddress'] == '192.168.1.2' and device['Name'] == 'Test' and device['Active'] is True


def test_wireless_secrets_are_redacted_without_hiding_protocol_metadata():
    from backend.livebox import redact
    result = redact({'wireless_2g_wep_key1': 'sensitive', 'wpa_key': 'sensitive', 'psk_key': 'sensitive', 'psk_cipher': 'aes', 'psk_version': 'wpa2'})
    assert 'sensitive' not in str(result)
    assert result['psk_cipher'] == 'aes' and result['psk_version'] == 'wpa2'
