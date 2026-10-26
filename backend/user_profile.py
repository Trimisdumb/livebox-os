import asyncio
import hashlib
import io
import warnings

from fastapi import APIRouter, HTTPException, Request, Response
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import auth

router = APIRouter(prefix='/api/user', tags=['User profile'])
lock = asyncio.Lock()


class Profile(BaseModel):
    model_config = ConfigDict(extra='forbid')
    display_name: str = Field(min_length=1, max_length=80)

    @field_validator('display_name')
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if not value or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError('Nom invalide.')
        return value


def directory(request):
    session = auth.current(request)
    if not session or not session.username:
        raise HTTPException(401, 'Reconnectez-vous pour modifier votre profil utilisateur.')
    return auth.DATA / 'users' / hashlib.sha256(session.username.encode()).hexdigest()


def profile(request):
    root = directory(request)
    try:
        name = Profile.model_validate_json((root / 'profile.json').read_text(encoding='utf-8')).display_name
    except FileNotFoundError:
        name = auth.current(request).username
    image = root / 'avatar.webp'
    try:
        revision = str(image.stat().st_mtime_ns)
    except FileNotFoundError:
        revision = None
    return {'username': auth.current(request).username, 'display_name': name,
            'avatar_revision': revision}


@router.get('/profile')
async def get_profile(request: Request):
    return profile(request)


@router.put('/profile')
async def save_profile(body: Profile, request: Request):
    async with lock:
        root = directory(request)
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = root / 'profile.tmp'
        temporary.write_text(body.model_dump_json(), encoding='utf-8')
        temporary.chmod(0o600)
        temporary.replace(root / 'profile.json')
    return profile(request)


def encode_avatar(data):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format not in ('JPEG', 'PNG', 'WEBP') or image.width * image.height > 20_000_000:
                    raise ValueError()
                image.load()
                image = ImageOps.fit(ImageOps.exif_transpose(image).convert('RGB'), (256, 256), method=Image.Resampling.LANCZOS)
                output = io.BytesIO()
                image.save(output, format='WEBP', quality=90)
                return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, 'Image invalide : JPG, PNG ou WebP, 20 mégapixels maximum.')


@router.put('/avatar')
async def save_avatar(request: Request):
    directory(request)
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 5 * 1024 * 1024:
            raise HTTPException(413, 'Photo trop volumineuse : 5 Mo maximum.')
    async with lock:
        encoded = await asyncio.to_thread(encode_avatar, data)
        root = directory(request)
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = root / 'avatar.tmp'
        temporary.write_bytes(encoded)
        temporary.chmod(0o600)
        temporary.replace(root / 'avatar.webp')
    return profile(request)


@router.get('/avatar')
async def avatar(request: Request):
    async with lock:
        try:
            data = (directory(request) / 'avatar.webp').read_bytes()
        except FileNotFoundError:
            raise HTTPException(404, 'Aucune photo de profil.')
    return Response(data, media_type='image/webp', headers={'Cache-Control': 'no-store'})


@router.delete('/avatar')
async def delete_avatar(request: Request):
    async with lock:
        (directory(request) / 'avatar.webp').unlink(missing_ok=True)
    return profile(request)
