"""Check tracked publication files without reading or printing private local data."""
import re
import struct
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
errors = []
blocked_dirs = {'data', 'backups', 'private', 'node_modules', '__pycache__', '.venv', '.pytest_cache', 'dist'}
blocked_names = {'account.json', 'profiles.json', 'settings.json', 'deployment.conf', 'wallpaper.bin', '.npmrc', '.pypirc'}

for name in filter(None, paths):
    path = Path(name)
    if blocked_dirs.intersection(path.parts) or path.name in blocked_names or path.name.startswith('.env') and path.name != '.env.example' or re.search(r'\.(?:log|har|db|sqlite[0-9]?|pem|key|pfx|p12|zip|tgz)(?:-.*)?$', name, re.I):
        errors.append(f'Private/generated file tracked: {name}')
    content = (ROOT / path).read_bytes()
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
