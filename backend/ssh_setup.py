import asyncio
import base64
import hashlib
import os
import re
import secrets
import tempfile
from pathlib import Path

from cryptography.hazmat.primitives.serialization import load_ssh_public_key
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import connectors, control

router = APIRouter(prefix='/api/control', tags=['SSH setup'])
lock = asyncio.Lock()
NAME = r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'


class KeyName(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(pattern=NAME)

    @field_validator('name')
    @classmethod
    def reserved(cls, value):
        if value.startswith('known_hosts') or value.endswith(('.pub', '.tmp')):
            raise ValueError('Nom réservé.')
        return value


class HostKey(BaseModel):
    model_config = ConfigDict(extra='forbid')
    public_key: str = Field(max_length=4096)
    fingerprint: str = Field(max_length=100)
    verified: bool


class PublicHostKey(BaseModel):
    model_config = ConfigDict(extra='forbid')
    public_key: str = Field(max_length=4096)


def writable_directory():
    if os.environ.get('LIVEBOX_OS_SSH_DIR'):
        raise HTTPException(409, 'Le dossier SSH externe reste géré sur l’hôte. Préparez sa clé et son known_hosts sur cet hôte, ou utilisez le stockage privé intégré sans LIVEBOX_OS_SSH_DIR.')
    root = connectors.ssh_directory()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    root.chmod(0o700)
    return root


def resource(key):
    value = control.get_resource(key)
    if value['connector'] != 'ssh':
        raise HTTPException(422, 'Cette configuration est réservée aux serveurs SSH.')
    return value


def public_key(value):
    fields = value.strip().split()
    if len(fields) < 2 or fields[0] != 'ssh-ed25519':
        raise HTTPException(422, 'Une clé publique d’hôte SSH Ed25519 est requise.')
    key = ' '.join(fields[:2])
    try:
        load_ssh_public_key(key.encode())
        raw = base64.b64decode(fields[1], validate=True)
    except (ValueError, TypeError):
        raise HTTPException(422, 'Clé publique d’hôte invalide.')
    return key, 'SHA256:' + base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip('=')


@router.get('/ssh/config')
async def configuration():
    root = connectors.ssh_directory()
    keys = []
    if root.is_dir():
        for path in sorted(root.glob('*.pub'))[:32]:
            name = path.name[:-4]
            if re.fullmatch(NAME, name) and path.resolve().parent == root and path.stat().st_size <= 8192:
                value = ' '.join(path.read_text().split()[:2])
                try: load_ssh_public_key(value.encode())
                except (ValueError, TypeError): continue
                keys.append({'name': name, 'public_key': value, 'private_key_present': (root / name).is_file() and (root / name).resolve().parent == root})
    return {'mode': 'external' if os.environ.get('LIVEBOX_OS_SSH_DIR') else 'managed', 'keys': keys,
            'message': 'Les clés privées restent sur le backend. L’empreinte de chaque serveur doit être vérifiée séparément.'}


@router.post('/ssh/keys', status_code=201)
async def generate_key(body: KeyName):
    async with lock:
        root = writable_directory()
        if (root / body.name).exists() or (root / (body.name + '.pub')).exists():
            raise HTTPException(409, 'Ce nom de clé existe déjà. Choisissez-le dans votre profil sans le régénérer.')
        if len(list(root.glob('*.pub'))) >= 16:
            raise HTTPException(409, 'Limite de 16 clés atteinte.')
        try:
            with tempfile.TemporaryDirectory(dir=root) as temporary:
                path = Path(temporary) / 'identity'
                code, _ = await connectors.run_bounded(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'LiveboxOS', '-f', str(path)])
                if code or not path.is_file(): raise OSError()
                path.chmod(0o600)
                path.replace(root / body.name)
                path.with_suffix('.pub').replace(root / (body.name + '.pub'))
        except (OSError, TimeoutError, ValueError):
            raise HTTPException(503, 'Impossible de générer la clé : vérifiez OpenSSH et les droits du dossier privé du backend.')
    return await configuration()


@router.get('/resources/{key}/host-key')
async def scan_host(key: str):
    value = resource(key)
    try:
        ip = await connectors.resolve_host(value['host'])
        async with connectors.ssh_limit:
            code, output = await connectors.run_bounded(['ssh-keyscan', '-T', '3', '-p', str(value['port']), '-t', 'ed25519', ip], timeout=8, capture_stderr=True)
        if code and 'unsupported kex' in output.lower():
            raise HTTPException(503, 'Votre client OpenSSH ne peut pas lire automatiquement cette clé. Utilisez la saisie de la clé publique depuis une console fiable, ou mettez OpenSSH à jour. La vérification SSH reste obligatoire.')
        for line in output.splitlines():
            fields = line.split()
            if len(fields) >= 3 and fields[1] == 'ssh-ed25519':
                key_value, fingerprint = public_key(' '.join(fields[1:3]))
                return {'public_key': key_value, 'fingerprint': fingerprint, 'verified': False}
    except (OSError, ValueError, TimeoutError):
        pass
    raise HTTPException(502, 'Aucune clé d’hôte Ed25519 reçue. Vérifiez l’adresse, le port SSH et le réseau autorisé du backend.')


@router.post('/ssh/fingerprint')
async def fingerprint(body: PublicHostKey):
    value, digest = public_key(body.public_key)
    return {'public_key': value, 'fingerprint': digest, 'verified': False}


@router.put('/resources/{key}/host-key')
async def trust_host(key: str, body: HostKey):
    value = resource(key)
    key_value, fingerprint = public_key(body.public_key)
    if body.verified is not True or not secrets.compare_digest(fingerprint, body.fingerprint.strip()):
        raise HTTPException(422, 'Recopiez l’empreinte vérifiée sur la console du serveur et confirmez sa vérification.')
    async with lock:
        root = writable_directory()
        path = root / 'known_hosts'
        if path.exists() and path.stat().st_size > 128 * 1024:
            raise HTTPException(409, 'Le fichier known_hosts nécessite une vérification sur l’hôte.')
        alias = connectors.ssh_alias(value)
        lines = path.read_text().splitlines() if path.exists() else []
        lines = [line for line in lines if not line.split() or line.split()[0] != alias]
        temporary = root / 'known_hosts.tmp'
        temporary.write_text('\n'.join(lines + [alias + ' ' + key_value]) + '\n')
        temporary.chmod(0o600)
        temporary.replace(path)
    return {'verified': True, 'fingerprint': fingerprint}
