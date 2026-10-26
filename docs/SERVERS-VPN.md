# Linux servers and VPN observations

This integration is optional and reads fixed Linux commands. V4.0.1 adds an actual isolated Debian/OpenSSH test; this does not certify every Linux distribution or grant access to the owner's host. It does not install VPN software or change a remote service. The Livebox is not assumed to host WireGuard.

## Integrated SSH setup (V4.0.1)

Open **Serveurs > Ajouter un serveur**. Enter the existing non-root account, IPv4/authorized DNS name, actual SSH port and a dedicated key name (a filename, not a path). Save the profile. Open **Configurer l’authentification SSH par clé** and create its dedicated Ed25519 key. Install only the displayed public key in `~/.ssh/authorized_keys` for that account, using permissions 700 for `.ssh` and 600 for `authorized_keys`. The private key stays in the backend’s private data volume and is never returned by the API.

Read the host key without accepting it. Independently run `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server console or another trusted channel. Compare and type that verified fingerprint in the application, then explicitly save the host identity. **Tester la connexion** performs a real Linux read; a failed test leaves the resource disconnected and displays its cause. Unknown or changed host identities are never accepted automatically. If automatic scanning fails, the manual option accepts the public host-key file copied from a trusted console and still requires the independently verified fingerprint. The installed Windows client reproduced [Win32-OpenSSH issue 2140](https://github.com/PowerShell/Win32-OpenSSH/issues/2140); no cipher downgrade or host-check bypass was introduced.

The default managed key directory is `data/ssh`, protected by directory mode 700 and private-key mode 600. It persists with the data volume and is excluded from application preference exports. Full volume backups contain these private keys: keep them private. No personal `.ssh` directory is mounted. A configured `LIVEBOX_OS_SSH_DIR` still selects the external mode below, without modifying its files.

Only backend-authorized destination networks are allowed. For Tailscale, an administrator must add the particular VPN subnet or host they manage to `LIVEBOX_OS_ALLOWED_NETWORKS`; Tailscale addresses are not silently permitted by default.

## External dedicated SSH setup

Create a dedicated non-root account on a Linux host you administer. Give it only the permissions required for your selected reads. Provision a separate SSH key and independently verify the host key fingerprint on that server's console or another trusted channel. Put the dedicated private key and a verified `known_hosts` file in a backend-only folder. Do not upload either file through the web app or commit them to Git.

The app uses `BatchMode`, `StrictHostKeyChecking`, `IdentitiesOnly`, a dedicated identity, no SSH agent, no forwarding, bounded output and timeouts. It does not accept unknown host keys automatically. Native installs must set `LIVEBOX_OS_SSH_DIR` to the dedicated folder before starting the backend. The key must be usable non-interactively; use operating-system file permissions and a restricted account/key policy. Encrypted keys needing a prompt are not supported by this adapter.

For Docker, set a host directory and use the optional example override:

```sh
# Linux shell, from the repository root
export LIVEBOX_OS_SSH_HOST_DIR="$(pwd)/private/ssh"
docker compose -f compose.yaml -f compose.ssh.example.yaml up -d --build --wait
```

```powershell
# PowerShell, from the repository root
$env:LIVEBOX_OS_SSH_HOST_DIR = Join-Path (Get-Location) 'private/ssh'
docker compose -f compose.yaml -f compose.ssh.example.yaml up -d --build --wait
```

The folder must already contain the key and verified `known_hosts`, and be readable by container UID 10001 without being broadly readable. Docker mounts it read-only at `/run/livebox-os-ssh`. Never mount your entire personal `.ssh` directory. Without this external mount/variable, the backend uses the managed private directory described above.

Open **Serveurs > Ajouter un serveur**, enter its authorized address/name and account, then the key filename (no path) and SSH port. The app rejects the `root` username and paths that escape the dedicated key folder. **Tester la connexion** starts the collection session only after a successful Linux read; it does not promise that optional commands are installed or permitted.

## Available reads

| Section | Command scope | Interpretation |
|---|---|---|
| System | `/proc/stat`, `/etc/os-release`, `/proc/uptime`, `/proc/meminfo`, `df -Pk`, bounded `/proc/net/dev` | CPU use measured from two /proc/stat samples one second apart, uptime, MemTotal/MemAvailable, visible filesystems and per-interface byte totals. Missing fields remain null; network totals are not instantaneous rates |
| Services | `systemctl list-units --type=service --state=running` | Services visible to this account, not all possible services |
| Docker | `docker ps --format '{{json .}}'` | Containers visible to this account; daemon access may be refused. Membership of the Docker group can grant broad host powers; prefer a separately restricted/rootless setup |
| WireGuard | `wg show all transfer`, `wg show all latest-handshakes` | Per-peer byte counters and Unix timestamps of the latest handshakes, without private keys; an old handshake is not proof of an active connection |
| OpenVPN | `systemctl list-units ... 'openvpn*'` | systemd unit states, not client sessions or traffic |
| Tailscale | `tailscale status --json` | Backend state, local VPN IPs and peer count only; peer/user metadata is filtered from the response |

No shell text, script, service name or arbitrary executable can be supplied by the browser. Commands do not use sudo. A missing command, refused permission, host-key mismatch or timeout is reported as unavailable. There is no SSH terminal, root console, container control, VPN client creation/revocation, tunnel import or VPN configuration export in this version.

## Troubleshooting

- **SSH unavailable:** finish key and verified host-identity setup, install OpenSSH on native Windows/Linux and check file permissions/UID mapping. External mode additionally requires its dedicated folder.
- **Host verification refused:** verify the actual host key separately; do not disable verification or accept an unverified replacement key.
- **VPN read refused:** check whether the dedicated account may run the exact read command. Do not grant blanket root access to make the page appear populated.
- **Address rejected:** check the backend allowlist. Add only the VPN subnet you administer when required; no personal server address is compiled into the app.
- **Empty output:** the command may report no units, interfaces or peers. This is not proof of a VPN session; no client count is fabricated.
