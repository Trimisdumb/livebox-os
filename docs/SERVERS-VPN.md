# Linux servers and VPN observations

This integration is optional and read-only. It is implemented and tested through the SSH subprocess adapter, not validated on the owner's server. It does not install VPN software or change a remote service. The Livebox is not assumed to host WireGuard.

## Dedicated SSH setup

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

The folder must already contain the key and verified `known_hosts`, and be readable by container UID 10001 without being broadly readable. Docker mounts it read-only at `/run/livebox-os-ssh`. Never mount your entire personal `.ssh` directory. The backend starts without this mount by default; missing configuration is reported as unavailable.

Open **Serveurs > Ajouter un serveur**, enter its authorized address/name and account, then the key filename (no path) and SSH port. The app rejects the `root` username and paths that escape the dedicated key folder. **Tester et connecter** starts the collection session and reads system information; it does not promise that optional commands are installed or permitted.

## Available reads

| Section | Command scope | Interpretation |
|---|---|---|
| System | `/proc/uptime`, `/proc/loadavg`, first memory-info lines, `df -Pk /`, bounded `/proc/net/dev` | Raw uptime, load, memory, disk and network counters. Load average is not a CPU utilization percentage |
| Services | `systemctl list-units --type=service --state=running` | Services visible to this account, not all possible services |
| Docker | `docker ps --format '{{json .}}'` | Containers visible to this account; daemon access may be refused. Membership of the Docker group can grant broad host powers; prefer a separately restricted/rootless setup |
| WireGuard | `wg show all transfer`, `wg show all latest-handshakes` | Per-peer byte counters and Unix timestamps of the latest handshakes, without private keys; an old handshake is not proof of an active connection |
| OpenVPN | `systemctl list-units ... 'openvpn*'` | systemd unit states, not client sessions or traffic |
| Tailscale | `tailscale status --json` | Backend state, local VPN IPs and peer count only; peer/user metadata is filtered from the response |

No shell text, script, service name or arbitrary executable can be supplied by the browser. Commands do not use sudo. A missing command, refused permission, host-key mismatch or timeout is reported as unavailable. There is no SSH terminal, root console, container control, VPN client creation/revocation, tunnel import, configuration export or unattended key persistence in this version.

## Troubleshooting

- **SSH unavailable:** configure the dedicated folder, install OpenSSH on native Windows/Linux and check file permissions/UID mapping.
- **Host verification refused:** verify the actual host key separately; do not disable verification or accept an unverified replacement key.
- **VPN read refused:** check whether the dedicated account may run the exact read command. Do not grant blanket root access to make the page appear populated.
- **Address rejected:** check the backend allowlist. Add only the VPN subnet you administer when required; no personal server address is compiled into the app.
- **Empty output:** the command may report no units, interfaces or peers. This is not proof of a VPN session; no client count is fabricated.
