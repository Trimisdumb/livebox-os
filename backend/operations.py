import asyncio
import base64
import json
import os
import secrets
import socket
import time
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import auth, database

DATA = Path(os.environ.get('ORANGE_DATA_DIR', Path(__file__).resolve().parent.parent / 'data'))
lock = asyncio.Lock()
diagnostic_lock = asyncio.Semaphore(2)
last_diagnostic = {}


class DesktopPreferences(BaseModel):
    model_config = ConfigDict(extra='forbid')
    icon_size: Literal['small', 'medium', 'large'] = 'medium'
    icon_order: list[str] = Field(default_factory=list, max_length=64)
    dock_pinned: list[str] | None = Field(default=None, max_length=64)
    remember_windows: bool = False
    wallpaper_x: float = Field(default=50, ge=0, le=100)
    wallpaper_y: float = Field(default=50, ge=0, le=100)
    animations: bool = True
    accent: Literal['orange', 'amber'] = 'orange'

    @field_validator('icon_order', 'dock_pinned')
    @classmethod
    def app_ids(cls, value):
        import re
        if value is not None and (len(value) != len(set(value)) or any(not re.fullmatch(r'[a-z][a-z0-9-]{0,63}', item) for item in value)):
            raise ValueError('Identifiants d’applications invalides ou répétés.')
        return value


class Preferences(BaseModel):
    model_config = ConfigDict(extra='forbid')
    theme: Literal['light', 'dark'] = 'light'
    wallpaper: Literal['signature', 'dune', 'night', 'custom'] = 'signature'
    fit: Literal['cover', 'contain', 'center'] = 'cover'
    blur: float = Field(default=0, ge=0, le=20)
    desktop: DesktopPreferences | None = None


class Diagnostic(BaseModel):
    model_config = ConfigDict(extra='forbid')
    test: Literal['livebox', 'tplink', 'internet', 'dns', 'https']


class RestoreToken(BaseModel):
    token: str


def read_settings():
    try:
        data = json.loads((DATA / 'settings.json').read_text(encoding='utf-8'))
        return Preferences.model_validate(data['preferences']).model_dump(exclude_none=True) | {'_profiles': data.get('profiles', [])}
    except FileNotFoundError:
        return {}


def read_preferences():
    return {k: v for k, v in read_settings().items() if k != '_profiles'}


def atomic_json(path, value):
    DATA.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    temporary.replace(path)


def image_type(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if data.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    raise HTTPException(422, 'Image invalide : JPG, PNG ou WebP uniquement.')


async def ping(host):
    arguments = ['-n', '2', '-w', '2000'] if os.name == 'nt' else ['-c', '2', '-W', '2']
    try:
        process = await asyncio.create_subprocess_exec('ping', *arguments, host, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    except FileNotFoundError:
        return {'available': False, 'ok': False, 'message': 'Non disponible : programme ping absent du backend.'}
    try:
        output, _ = await asyncio.wait_for(process.communicate(), timeout=7)
    except TimeoutError:
        process.kill()
        await process.communicate()
        return {'available': True, 'ok': False, 'message': 'Le test ping a dépassé son délai.'}
    return {'available': True, 'ok': process.returncode == 0, 'message': output.decode('utf-8', errors='replace')[-2500:]}


def create_router(get_session, profile_type, profiles_read, profiles_write):
    router = APIRouter(prefix='/api')

    @router.get('/incidents')
    async def incidents():
        return await asyncio.to_thread(database.history)

    @router.post('/diagnostics')
    async def diagnostics(body: Diagnostic, request: Request):
        admin = auth.current(request)
        key = request.cookies.get(auth.COOKIE)
        if time.time() - last_diagnostic.get(key, 0) < 3:
            raise HTTPException(429, 'Attendez quelques secondes entre deux diagnostics.')
        last_diagnostic[key] = time.time()
        for old in list(last_diagnostic):
            if old not in auth.sessions:
                last_diagnostic.pop(old, None)
        started = time.monotonic()
        async with diagnostic_lock:
            if body.test == 'livebox':
                session = get_session(request)
                target = urlsplit(session.box.url).hostname
                result = await ping(target)
                api_status = await session.box.read('DeviceInfo', 'get')
                result['api_available'] = api_status['available']
                result['api_message'] = api_status.get('message', 'Communication Sysbus authentifiée réussie.')
            elif body.test == 'tplink':
                from . import network
                session = network.sessions.get(key)
                if not session or session.expires < time.time():
                    raise HTTPException(409, 'Connectez d’abord l’Archer AX58.')
                target = urlsplit(session.box.url).hostname
                result = await ping(target)
                api_status = await session.box.read('status')
                result['api_available'] = api_status['available']
                result['api_message'] = api_status.get('message', 'Communication TP-Link chiffrée et authentifiée réussie.')
            elif body.test == 'internet':
                target = '1.1.1.1'
                result = await ping(target)
            elif body.test == 'dns':
                target = 'orange.fr'
                try:
                    values = await asyncio.wait_for(asyncio.to_thread(socket.getaddrinfo, target, 443, type=socket.SOCK_STREAM), timeout=6)
                    result = {'available': True, 'ok': True, 'message': 'Résolution DNS : ' + ', '.join(sorted({entry[4][0] for entry in values}))}
                except (OSError, TimeoutError):
                    result = {'available': True, 'ok': False, 'message': 'La résolution DNS a échoué ou dépassé son délai.'}
            else:
                target = 'https://www.orange.fr/'
                try:
                    async with httpx.AsyncClient(timeout=6, follow_redirects=False, trust_env=False) as client:
                        response = await client.head(target)
                    result = {'available': True, 'ok': response.status_code < 400, 'message': f'Réponse HTTPS : HTTP {response.status_code}. Certificat TLS vérifié.'}
                except httpx.HTTPError:
                    result = {'available': True, 'ok': False, 'message': 'La connexion HTTPS ou la validation du certificat a échoué.'}
        result.update({'target': target, 'test': body.test, 'duration_ms': round((time.monotonic() - started) * 1000), 'time': time.time(), 'source': 'Backend Livebox OS'})
        await asyncio.to_thread(database.record, f"Diagnostic {body.test} : {'réussi' if result.get('ok') else 'échec ou indisponible'}. Cible : {target}.", 'Livebox OS · diagnostic backend')
        return result

    @router.get('/storage')
    async def storage(session=Depends(get_session)):
        usb, disks, volumes, capabilities = await asyncio.gather(
            session.box.read('Devices', 'get', {'expression': 'usb'}),
            session.box.read('StorageService', 'getPhysicalMediums'),
            session.box.read('StorageService.LogicalVolume', 'get'),
            session.box.read('StorageService.Capabilities', 'get'),
        )
        return {'source': 'Livebox · USB uniquement', 'usb': usb, 'disks': disks, 'volumes': volumes, 'capabilities': capabilities, 'file_access': {'available': False, 'message': 'Non disponible : aucun accès aux fichiers USB compatible n’est implémenté pour cette Livebox 5. Orange a désactivé le partage SMBv1. Le stockage du serveur Debian n’est pas utilisé.', 'source': 'https://assistance.orange.fr/nid/435465', 'operations': {name: False for name in ('browse', 'download', 'upload', 'mkdir', 'rename', 'delete')}}}

    @router.get('/wifi/bands')
    async def wifi_bands(session=Depends(get_session)):
        mibs, devices = await asyncio.gather(session.box.read('NeMo.Intf.lan', 'getMIBs', {'mibs': 'base wlanradio wlanvap'}), session.box.read('Devices', 'get', {'expression': 'physical and !self and !voice'}))
        if not mibs['available'] or not isinstance(mibs['data'], dict):
            return mibs
        data = mibs['data']
        bands = []
        for key, vap in data.get('wlanvap', {}).items():
            base = data.get('base', {}).get(key, {})
            lower = base.get('LLIntf', {})
            radio_key = next(iter(lower), None) if isinstance(lower, (dict, list)) else None
            radio = data.get('wlanradio', {}).get(radio_key, {})
            if not isinstance(vap, dict) or not isinstance(radio, dict):
                continue
            connected = [d for d in devices['data'] if isinstance(d, dict) and d.get('Active') is True and d.get('Layer2Interface') == key] if devices['available'] and isinstance(devices['data'], list) else None
            bands.append({'interface': key, 'radio': radio_key, 'band': radio.get('OperatingFrequencyBand'), 'ssid': vap.get('SSID'), 'enabled': base.get('Enable'), 'channel': radio.get('Channel'), 'auto': radio.get('AutoChannelEnable'), 'channels': radio.get('PossibleChannels'), 'standard': radio.get('OperatingStandards'), 'devices': [{'name': d.get('Name'), 'ip': d.get('IPAddress')} for d in connected] if connected is not None else None})
        return {'available': bool(bands), 'data': bands, 'message': '' if bands else 'Non disponible : informations radio non retournées par le firmware.'}

    @router.get('/preferences')
    async def preferences():
        return read_preferences()

    @router.put('/preferences')
    async def save_preferences(body: Preferences):
        async with lock:
            current = read_settings()
            value = body.model_dump(exclude_none=True)
            if body.desktop is None and current.get('desktop'):
                value['desktop'] = current['desktop']
            atomic_json(DATA / 'settings.json', {'preferences': value, 'profiles': current.get('_profiles', [])})
        return {'ok': True}

    @router.put('/wallpaper')
    async def save_wallpaper(request: Request):
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > 15 * 1024 * 1024:
                raise HTTPException(413, 'Image trop volumineuse (15 Mo maximum).')
        image_type(data)
        async with lock:
            DATA.mkdir(parents=True, exist_ok=True)
            temporary = DATA / 'wallpaper.tmp'
            temporary.write_bytes(data)
            temporary.replace(DATA / 'wallpaper.bin')
        return {'ok': True}

    @router.get('/wallpaper')
    async def get_wallpaper():
        path = DATA / 'wallpaper.bin'
        if not path.exists():
            raise HTTPException(404, 'Aucune image personnalisée enregistrée.')
        with path.open('rb') as source:
            mime = image_type(source.read(12))
        return FileResponse(path, media_type=mime, headers={'Cache-Control': 'no-store'})

    @router.get('/backup')
    async def backup():
        image = DATA / 'wallpaper.bin'
        preferences = read_preferences() or Preferences().model_dump(exclude_none=True)
        return {'application': 'Livebox OS', 'version': '4.0' if 'desktop' in preferences else '3.0', 'profiles': profiles_read(), 'preferences': preferences, 'wallpaper': base64.b64encode(image.read_bytes()).decode('ascii') if image.exists() else None}

    @router.post('/backup/prepare')
    async def prepare_backup(body: dict, request: Request):
        try:
            if set(body) != {'application', 'version', 'profiles', 'preferences', 'wallpaper'} or (body['application'], body['version']) not in (('Orange OS', '1.1'), ('Livebox OS', '3.0'), ('Livebox OS', '4.0')) or not isinstance(body['profiles'], list) or len(body['profiles']) > 20:
                raise ValueError()
            profiles = [profile_type.model_validate(p).model_dump() for p in body['profiles']]
            if len({p['name'] for p in profiles}) != len(profiles):
                raise ValueError()
            preferences = Preferences.model_validate(body['preferences']).model_dump(exclude_none=True)
            image = base64.b64decode(body['wallpaper'], validate=True) if body['wallpaper'] else None
            if image:
                if len(image) > 15 * 1024 * 1024:
                    raise ValueError()
                image_type(image)
        except (ValueError, TypeError, KeyError):
            raise HTTPException(422, 'Sauvegarde Livebox OS invalide ou incompatible.')
        admin = auth.current(request)
        admin.pending = {k: v for k, v in admin.pending.items() if v['expires'] > time.time()}
        if len(admin.pending) >= 3:
            raise HTTPException(429, 'Trop de restaurations en attente.')
        token = secrets.token_urlsafe(24)
        admin.pending[token] = {'profiles': profiles, 'preferences': preferences, 'wallpaper': image, 'expires': time.time() + 120}
        asyncio.get_running_loop().call_later(120, admin.pending.pop, token, None)
        return {'token': token, 'profiles': len(profiles), 'wallpaper': bool(image), 'warning': 'Cette opération remplace les profils, les préférences et le fond d’écran Livebox OS. Les paramètres réseau de la Livebox ne sont pas modifiés.'}

    @router.post('/backup/confirm')
    async def confirm_backup(body: RestoreToken, request: Request):
        admin = auth.current(request)
        backup = admin.pending.pop(body.token, None)
        if not backup or backup['expires'] < time.time() or not {'profiles', 'preferences', 'wallpaper'}.issubset(backup):
            raise HTTPException(409, 'Confirmation expirée ou déjà utilisée.')
        async with lock:
            # Profiles and appearance share one atomically replaced settings document.
            atomic_json(DATA / 'settings.json', {'profiles': backup['profiles'], 'preferences': backup['preferences']})
            await profiles_write(backup['profiles'])
            image = DATA / 'wallpaper.bin'
            if backup['wallpaper']:
                temporary = DATA / 'wallpaper.tmp'
                temporary.write_bytes(backup['wallpaper'])
                temporary.replace(image)
            elif image.exists():
                image.unlink()
        await asyncio.to_thread(database.record, 'Configuration Livebox OS restaurée après confirmation.', 'Livebox OS · sauvegarde')
        return {'ok': True, 'preferences': backup['preferences']}

    return router
