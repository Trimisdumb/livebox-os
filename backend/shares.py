"""Read-only SMB2/3 shares; fixed private host and share, no DFS redirects."""
import asyncio
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator
from smbprotocol.connection import Connection
from smbprotocol.exceptions import NoMoreFiles, SMBException
from smbprotocol.file_info import FileInformationClass
from smbprotocol.open import CreateDisposition, CreateOptions, FileAttributes, FilePipePrinterAccessMask, ImpersonationLevel, Open, ShareAccess
from smbprotocol.session import Session
from smbprotocol.tree import TreeConnect

from . import auth, database
from .livebox import local_url

logging.getLogger('smbprotocol').setLevel(logging.ERROR)
logging.getLogger('spnego').setLevel(logging.ERROR)
router = APIRouter(prefix='/api/shares', tags=['Partages SMB2/3'])
sessions = {}


class ShareLogin(BaseModel):
    model_config = ConfigDict(extra='forbid')
    host: str
    share: str = Field(min_length=1, max_length=100, pattern=r'^[^\\/:*?"<>|\x00-\x1f]+$')
    username: str = Field(min_length=1, max_length=128)
    password: SecretStr = Field(min_length=1, max_length=256)
    encryption: bool = True

    @field_validator('host')
    @classmethod
    def validate_host(cls, value):
        if not re.fullmatch(r'[0-9.]+', value):
            raise ValueError('IPv4 privée requise.')
        local_url(value)
        return value


def safe_path(value):
    if not isinstance(value, str) or len(value) > 1024 or value.startswith(('/', '\\')):
        raise ValueError('Chemin relatif requis.')
    parts = value.replace('\\', '/').split('/') if value else []
    if any(p in ('', '.', '..') or p[-1:] in (' ', '.') or re.search(r'[:*?"<>|\x00-\x1f]', p) for p in parts):
        raise ValueError('Chemin non autorisé.')
    return '\\'.join(parts)


@dataclass
class Share:
    host: str
    name: str
    connection: Connection
    tree: TreeConnect
    expires: float = field(default_factory=lambda: time.time() + 3600)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def open(self, path, directory=False):
        handle = Open(self.tree, path)
        options = CreateOptions.FILE_OPEN_REPARSE_POINT | (CreateOptions.FILE_DIRECTORY_FILE if directory else CreateOptions.FILE_NON_DIRECTORY_FILE)
        access = FilePipePrinterAccessMask.FILE_READ_DATA | FilePipePrinterAccessMask.FILE_READ_ATTRIBUTES
        handle.create(ImpersonationLevel.Impersonation, access, FileAttributes.FILE_ATTRIBUTE_NORMAL,
                      ShareAccess.FILE_SHARE_READ | ShareAccess.FILE_SHARE_WRITE | ShareAccess.FILE_SHARE_DELETE, CreateDisposition.FILE_OPEN, options)
        if handle.file_attributes & FileAttributes.FILE_ATTRIBUTE_REPARSE_POINT:
            handle.close()
            raise ValueError('Liens et points de réanalyse non suivis.')
        return handle

    def check_parents(self, path):
        parts = path.split('\\')
        for i in range(1, len(parts)):
            self.open('\\'.join(parts[:i]), True).close()

    def browse(self, path):
        self.check_parents(path)
        handle = self.open(path, True)
        items = []
        try:
            while len(items) < 2000:
                try:
                    batch = handle.query_directory('*', FileInformationClass.FILE_ID_BOTH_DIRECTORY_INFORMATION)
                except NoMoreFiles:
                    break
                if not batch:
                    break
                for entry in batch:
                    name = entry['file_name'].get_value().decode('utf-16-le')
                    if name in ('.', '..'):
                        continue
                    attrs = entry['file_attributes'].get_value()
                    items.append({'name': name, 'directory': bool(attrs & FileAttributes.FILE_ATTRIBUTE_DIRECTORY),
                                  'link': bool(attrs & FileAttributes.FILE_ATTRIBUTE_REPARSE_POINT), 'size': entry['end_of_file'].get_value()})
        finally:
            handle.close()
        return {'items': sorted(items[:2000], key=lambda item: (not item['directory'], item['name'].lower())), 'truncated': len(items) >= 2000}

    def download(self, path):
        self.check_parents(path)
        handle = self.open(path)
        try:
            if handle.end_of_file > 32 * 1024 * 1024:
                raise ValueError('Téléchargement limité à 32 Mio depuis cette interface.')
            output = bytearray()
            size = handle.end_of_file
            while len(output) < size:
                chunk = handle.read(len(output), min(size - len(output), 65536))
                if not chunk:
                    raise ValueError('Lecture interrompue ; fichier non téléchargé.')
                output.extend(chunk)
            return bytes(output)
        finally:
            handle.close()


async def disconnect(key):
    session = sessions.pop(key, None)
    if session:
        await asyncio.to_thread(session.connection.disconnect, close=True)


async def cleanup():
    for key, session in list(sessions.items()):
        if not auth.sessions.get(key) or auth.sessions[key].expires < time.time() or session.expires < time.time():
            await disconnect(key)


def current(request):
    session = sessions.get(request.cookies.get(auth.COOKIE))
    if not session or session.expires < time.time():
        raise HTTPException(409, 'Connectez un partage SMB2/3.')
    return session


async def run(session, function, *args):
    async with session.lock:
        try:
            return await asyncio.wait_for(asyncio.to_thread(function, *args), 35)
        except TimeoutError:
            await asyncio.to_thread(session.connection.disconnect, close=True)
            session.expires = 0
            raise HTTPException(504, 'Délai SMB dépassé. Reconnectez le partage.')
        except (OSError, SMBException):
            raise HTTPException(502, 'Le partage refuse cet accès ou ne répond pas. Vérifiez le nom du partage, les droits et SMB2/3 ; SMBv1 et DFS ne sont pas pris en charge.')
        except ValueError as error:
            raise HTTPException(422, str(error))


@router.post('/login')
async def login(body: ShareLogin, request: Request):
    auth.throttle(request)
    connection = Connection(uuid.uuid4(), body.host, 445, require_signing=True)
    def connect():
        connection.connect(timeout=8)
        session = Session(connection, username=body.username, password=body.password.get_secret_value(), require_encryption=body.encryption, auth_protocol='ntlm')
        session.connect()
        tree = TreeConnect(session, f'\\\\{body.host}\\{body.share}')
        tree.connect()
        if tree.is_dfs_share:
            raise ValueError('Partages DFS non pris en charge : aucune redirection vers un autre serveur autorisée.')
        result = Share(body.host, body.share, connection, tree)
        result.browse('')
        return result
    try:
        result = await asyncio.wait_for(asyncio.to_thread(connect), 35)
    except (OSError, SMBException, ValueError, TimeoutError):
        await asyncio.to_thread(connection.disconnect, close=True)
        raise HTTPException(502, 'Connexion SMB impossible : vérifiez le serveur, le partage, les droits et la prise en charge du chiffrement SMB3 demandé. SMBv1 et DFS sont refusés.')
    await disconnect(request.cookies.get(auth.COOKIE))
    sessions[request.cookies.get(auth.COOKIE)] = result
    database.record('Connexion à un partage SMB2/3 en lecture seule.', 'Livebox OS · stockage réseau')
    return {'connected': True}


@router.post('/logout')
async def logout(request: Request):
    await disconnect(request.cookies.get(auth.COOKIE))
    return {'connected': False}


@router.get('')
async def state(request: Request):
    session = sessions.get(request.cookies.get(auth.COOKIE))
    if not session or session.expires < time.time():
        return {'connected': False}
    return {'connected': True, 'host': session.host, 'share': session.name, 'dialect': hex(session.connection.dialect), 'read_only': True, 'expires': session.expires}


@router.get('/browse')
async def browse(request: Request, path: str = ''):
    session = current(request)
    try:
        path = safe_path(path)
    except ValueError as error:
        raise HTTPException(422, str(error))
    return await run(session, session.browse, path)


@router.get('/download')
async def download(request: Request, path: str):
    session = current(request)
    try:
        path = safe_path(path)
        if not path:
            raise ValueError('Fichier requis.')
    except ValueError as error:
        raise HTTPException(422, str(error))
    content = await run(session, session.download, path)
    return Response(content, media_type='application/octet-stream', headers={'Content-Disposition': "attachment; filename*=UTF-8''" + quote(path.split('\\')[-1], safe=''), 'Cache-Control': 'no-store'})
