# Installation — Windows & Linux

[English](#english) · [Français](#français)

## English

### Docker Compose (recommended)

Use Docker Desktop with Linux containers on Windows, or Docker Engine with the Compose plugin on Linux. The Docker host must be able to reach your routers' private IPv4 addresses. Router firmware and network configuration are not modified during installation.

1. Clone this repository with GitHub's **Code** button, or extract its source archive. Open a terminal in the directory containing `compose.yaml`.
2. Optional non-secret configuration:

   Linux:
   ```sh
   cp .env.example .env
   ```
   PowerShell:
   ```powershell
   Copy-Item .env.example .env
   ```
3. Start the two services:

   ```sh
   docker compose config --quiet
   docker compose up -d --build --wait
   docker compose ps
   ```
4. Open **http://localhost:8097**. A new Docker installation displays a browser-pairing reference. Approve it on the Docker host:

   ```sh
   docker compose exec -T backend python -m backend.auth approve-pairing REFERENCE_FROM_THE_PAGE
   ```
   Replace the last argument with the reference shown in the page. The secret cookie stays in the browser. Approval expires after at most ten minutes and cannot be reused from another browser. No maintainer SSH access is needed; the UI's “via SSH” wording also covers running this command locally.
5. Create your own Livebox OS account (password at least 12 characters) in the **same browser**. No default password is supplied.
6. Connect your Livebox from the desktop. The usual address `http://192.168.1.1` is editable. Use the router administrator password, which may differ from its Wi-Fi key.
7. Optionally open **Archer AX58**, change its address if necessary and enter its administrator password. Leave forced-session replacement unchecked unless you explicitly want to replace another router administration session. A Livebox-only installation works without an Archer.

### Configuration

`.env.example` contains only non-secret deployment settings. **Do not put router or application passwords in `.env`.** The application does not read router credentials from environment variables.

| Variable | Default / purpose |
|---|---|
| `ORANGE_BIND` | `127.0.0.1`: host interface receiving the frontend port |
| `ORANGE_PORT` | `8097`: frontend host port; change if occupied |
| `ORANGE_ALLOWED_HOSTS` | `localhost,127.0.0.1`: exact allowed hostnames/IPs, without port or scheme |
| `ORANGE_COOKIE_SECURE` | `0` for local HTTP; set `1` only when serving through HTTPS |
| `ORANGE_SETUP_SOURCES` | Native bootstrap source allowlist; does not bypass browser approval behind the Compose proxy |
| `ORANGE_DATA_DIR` | Native installs only: private data directory; Compose fixes it to `/app/data` in the persistent volume |

The legacy `orange-os` project name, `orange-data` volume key, `ORANGE_*` settings, cookie names and browser storage IDs are intentionally retained for upgrade compatibility. They do not refer to a maintainer's server.

Prefer a local browser, a tunnel or a specific trusted private interface. For a LAN interface, put **your own host's private IPv4** in `ORANGE_BIND` and add that address to `ORANGE_ALLOWED_HOSTS`. Do not use `0.0.0.0` on an Internet-connected interface or add a NAT rule exposing the app. A tunnel to the loopback binding avoids changing the exposure:

```sh
ssh -L 8097:127.0.0.1:8097 your-user@your-private-host
```

Those SSH names are illustrative; use your own host, account and access controls. There is no required connection to the maintainer's network. When using a TLS reverse proxy, preserve Host, proxy WebSocket upgrades and configure a request limit comparable to Compose's 23 MiB limit.

### Native Windows (64-bit)

Install 64-bit Python 3.12+ and Node.js 24 with npm. From the repository root:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
npx --yes pnpm@11.25.0 --dir frontend install --frozen-lockfile
npx --yes pnpm@11.25.0 --dir frontend build
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --no-proxy-headers --workers 1 --no-access-log
```

Open **http://127.0.0.1:8000**. Native loopback setup is allowed without Docker pairing. Data is stored in the ignored `data/` directory unless you explicitly configure `ORANGE_DATA_DIR`.

### Native Linux

Install Python 3.12+, `python3-venv`, Node.js 24/npm and `iputils-ping` using the appropriate packages for your distribution. Then:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npx --yes pnpm@11.25.0 --dir frontend install --frozen-lockfile
npx --yes pnpm@11.25.0 --dir frontend build
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --no-proxy-headers --workers 1 --no-access-log
```

Open **http://127.0.0.1:8000**. Use one worker because sessions and prepared confirmations are in memory. Keep native serving on loopback, or supply an equivalent limiting reverse proxy; the native Content-Length check alone does not enforce a chunked-body edge limit.

### Updates and private data

Export the application backup from **Sauvegarde** before upgrading and back up the private persistent volume separately if you need the administrator account and incident history. Exported application backups contain no passwords or account hashes, but may contain private addresses, profile names and wallpaper. Never commit or attach them to issues.

For an existing installation, keep its Compose project name, volume and `.env`/private deployment configuration. Do not replace a private config with `.env.example` and do not run `down -v` against a production installation.

```sh
docker compose up -d --build --wait
```

Sessions expire on backend restart: sign in again and reconnect the routers. Updating local source does not automatically change router firmware or NAT rules. Existing private installations require a separately planned upgrade; preparing this public source does not update them.

### Troubleshooting

| Symptom | Check |
|---|---|
| Port occupied | Change `ORANGE_PORT`; inspect your existing services before choosing a port |
| Waiting for pairing | Approve the current reference on your Docker host, in time, then keep the same browser |
| `Invalid host header` | Add the actual private hostname/IP to `ORANGE_ALLOWED_HOSTS` and restart only this Compose project |
| Login does not stick | Do not enable `ORANGE_COOKIE_SECURE=1` on plain HTTP; preserve cookies and Host through the proxy |
| Router timeout | Verify its address from the Docker host, local routing, VPN isolation and firewall rules; never reset a router as a workaround |
| AX58 writes blocked | Check hardware/firmware in its identity panel; other releases are not automatically compatible |
| Prepared NAT rejected | It expired, a rule/session changed or topology/conflicts could not be verified; refresh and prepare again |
| Unknown/partial NAT result | Re-read both routers before retrying; do not delete unrelated rules |
| SMB cannot connect | Supply an actual SMB2/3 server/share and account; SMB3 encryption is required by default; SMB1/DFS are refused |
| Blank counters | Wait for two valid readings; unsupported/reset counters are shown as gaps |

Use `docker compose ps` and `docker compose logs --tail=100` locally. Logs can still include operational/private network metadata: inspect and anonymize them before sharing. No public support request needs your password.

## Français

### Installation Docker

Installez Docker Desktop avec les conteneurs Linux sur Windows, ou Docker Engine et le plugin Compose sur Linux. Clonez ce dépôt ou extrayez son archive, puis ouvrez un terminal dans le dossier contenant `compose.yaml`.

La copie de `.env.example` vers `.env` est facultative (`cp` sous Linux, `Copy-Item` sous PowerShell). Ce fichier ne contient que des paramètres de déploiement, **jamais les mots de passe**.

```sh
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
```

Ouvrez **http://localhost:8097**, approuvez la référence affichée depuis le terminal de **votre propre hôte Docker**, puis créez votre compte dans le même navigateur :

```sh
docker compose exec -T backend python -m backend.auth approve-pairing REFERENCE_AFFICHEE
```

L'autorisation expire après dix minutes maximum et reste liée au cookie du navigateur. Aucun accès SSH au mainteneur n'est requis. Le message d'interface mentionnant SSH désigne aussi l'exécution locale de cette commande sur l'hôte.

Connectez la Livebox avec son adresse privée et son mot de passe d'administration. L'adresse habituelle `192.168.1.1` est modifiable. L'AX58 est facultatif et se connecte dans sa propre application. Les sessions sont liées au navigateur et perdues au redémarrage du backend.

### Windows et Linux en natif

Les commandes détaillées plus haut sont utilisables telles quelles : bloc PowerShell pour Windows 64 bits, bloc shell pour Linux, avec Python 3.12+ et Node.js 24. L'adresse native est **http://127.0.0.1:8000**. Conservez un seul worker et un binding loopback. Le dossier `data/` reste privé et ignoré par Git.

### Configuration, accès privé et mises à jour

Les variables `ORANGE_BIND`, `ORANGE_PORT`, `ORANGE_ALLOWED_HOSTS`, `ORANGE_COOKIE_SECURE` et `ORANGE_SETUP_SOURCES` sont décrites dans le tableau ci-dessus. Les noms techniques historiques sont conservés pour préserver les installations existantes. Pour accéder depuis le LAN, choisissez explicitement une interface privée et autorisez son hôte ; privilégiez un tunnel si possible. N'exposez jamais l'administration par une redirection Internet.

Sauvegardez l'application et le volume avant mise à jour. Gardez le projet Compose, son volume et votre configuration privée. **N'exécutez pas `docker compose down -v` sur votre installation réelle.** `docker compose up -d --build --wait` reconstruit uniquement ce projet ; reconnectez ensuite les routeurs.

### Dépannage

Vérifiez le port disponible, l'appairage courant, l'hôte autorisé, les cookies et le mode HTTP/HTTPS. Pour un délai routeur, vérifiez la connectivité depuis l'hôte Docker, le VPN et les pare-feu sans réinitialiser le réseau. Pour un résultat NAT incertain, relisez les deux routeurs avant une nouvelle tentative. Un accès SMB exige un véritable partage compatible ; l'absence de disque USB ne doit pas être contournée avec un dossier Debian.

Consultez les logs uniquement localement et anonymisez-les avant tout partage. Consultez [SECURITY.md](../SECURITY.md) pour les signalements privés.
