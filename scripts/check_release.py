"""Check tracked publication files without reading or printing private local data."""
import re
import hashlib
import struct
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
errors = []
reviewed_photos = {
    'frontend/public/hardware/livebox-4.jpg': '4c7eee5f02cb5285ef39bb92fee533aae29a79da72de270aad12189cb44a483f',
    'frontend/public/hardware/livebox-5.png': '48f56bfbcacbf7e9058707046440115890a944e87abcbfd2dd1829cae68b045e',
    'frontend/public/hardware/livebox-6.jpg': '78b364590a738f18c940722ea15873e73e0aa8154b596cff45b63b8eb5508992',
}
blocked_dirs = {'data', 'backups', 'private', 'node_modules', '__pycache__', '.venv', '.pytest_cache', 'dist'}
blocked_names = {'account.json', 'profiles.json', 'settings.json', 'deployment.conf', 'wallpaper.bin', '.npmrc', '.pypirc'}

for name in filter(None, paths):
    path = Path(name)
    if blocked_dirs.intersection(path.parts) or path.name in blocked_names or path.name.startswith('.env') and path.name != '.env.example' or re.search(r'\.(?:log|har|db|sqlite[0-9]?|pem|key|pfx|p12|zip|tgz)(?:-.*)?$', name, re.I):
        errors.append(f'Private/generated file tracked: {name}')
    content = (ROOT / path).read_bytes()
    if name in reviewed_photos:
        if hashlib.sha256(content).hexdigest() != reviewed_photos[name]:
            errors.append(f'Licensed hardware photograph requires a new provenance review: {name}')
        continue
    if path.suffix.lower() in ('.jpg', '.jpeg', '.webp'):
        if path.parent.as_posix() == 'docs/images' and path.suffix.lower() in ('.jpg', '.jpeg'):
            with Image.open(ROOT / path) as screenshot:
                if screenshot.format != 'JPEG' or screenshot.getexif() or set(screenshot.info) - {'jfif', 'jfif_version', 'jfif_unit', 'jfif_density', 'dpi'}:
                    errors.append(f'Screenshot metadata requires review: {name}')
        else:
            errors.append(f'Unreviewed photograph: {name}')
    if path.suffix == '.png':
        if path.parent.as_posix() != 'docs/images':
            errors.append(f'Unreviewed image location: {name}')
        offset = 8
        while offset + 12 <= len(content):
            length = struct.unpack('>I', content[offset:offset + 4])[0]
            kind = content[offset + 4:offset + 8]
            if kind in (b'tEXt', b'zTXt', b'iTXt', b'eXIf'):
                errors.append(f'Image metadata requires review: {name}')
            offset += length + 12
    elif b'\0' not in content:
        text = content.decode('utf-8', errors='replace')
        if re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\$argon2id\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]{12,}', text):
            errors.append(f'Credential material requires review: {name}')
        if path.suffix == '.md':
            for target in re.findall(r'!?\[[^\]]*\]\(([^)\s]+)\)', text):
                if not target.startswith(('http:', 'https:', 'mailto:', '#')) and not (ROOT / path.parent / target.split('#')[0]).exists():
                    errors.append(f'Broken local documentation link: {name}')

if errors:
    raise SystemExit('\n'.join(errors))
print('Tracked files, credential patterns, image metadata and documentation links checked.')
