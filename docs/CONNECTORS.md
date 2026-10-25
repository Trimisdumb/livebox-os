# Connector contract and compatibility

The registry is implemented in `backend/control.py`; network protocols live in `backend/connectors.py`, `backend/livebox.py` and `backend/tplink.py`. Application authentication/CSRF remains the existing middleware. The control router is not a public proxy for arbitrary API methods or shell commands.

A connector establishes a temporary authenticated session, reads a fixed catalog of sections and closes its remote session/client. A read returns `{available, data, message?}`; unsupported/denied reads return `available: false`. The registry stores connection metadata separately from in-memory session credentials. Each active connection has a collection lock, bounded history and an owner administrator session. Logout, expiry, profile removal and shutdown close its resources.

To add a connector: document a primary protocol source/license, validate destinations, add only fixed reads, sanitize results, implement cleanup, add it to the explicit catalog and resource schema, and test authentication errors, denied operations, owner isolation and expiry. Do not advertise writes from a successful read or assume another model shares a vendor's protocol. API error text must not include submitted passwords, session cookies or VPN keys.

| Connector | Evidence | Scope |
|---|---|---|
| Orange Livebox 5 | [LiveboxMonitor](https://github.com/p-dor/LiveboxMonitor), existing V3 hardware record | Sysbus session and fixed service/method pairs; V3 hardware evidence is narrow, new V4 actions need hardware validation |
| TP-Link Archer AX58 V1 | [V3 protocol notes](PROTOCOL-AX58.md) and V3 tests | Exact firmware 1.5.2 Build 20250812 rel.38324(4555); no generic vendor compatibility claim |
| OpenWrt rpcd/uhttpd | [uhttpd ubus handler](https://github.com/openwrt/uhttpd/blob/master/ubus.c), [rpcd sessions](https://github.com/openwrt/rpcd/blob/master/session.c) | JSON-RPC `call`, temporary `session.login`; `system.board`, `system.info`, `network.interface.dump` and session destruction; fixture tested, not hardware tested |
| Linux SSH | [OpenSSH client](https://man.openbsd.org/ssh.1), fixed `/proc`, systemd, Docker, wg and tailscale commands | Read-only commands, no console, no forwarded agent, no supplied shell fragments; subprocess adapter tested, real host unvalidated |
| ASUS, Netgear, D-Link, GL.iNet, MikroTik, Ubiquiti, FRITZ!Box | No shipped vendor connector | Unavailable. GL.iNet or another device running a compatible OpenWrt installation can explicitly choose OpenWrt; stock vendor firmware is not inferred |

LiveboxMonitor is MIT licensed and its notice remains in `THIRD_PARTY_NOTICES.md` and `licenses/`. New code was written against protocol contracts, not copied from OpenWrt's GPL implementation. Linking to protocol sources does not relicense those projects. No new Python or frontend dependency is added by this branch; system executables installed in the image retain Debian's package notices.

OpenWrt requires an intentionally exposed local `/ubus` endpoint and a dedicated rpcd account with read ACLs for the objects above. The app does not install packages, create accounts, relax ACLs or enable remote administration on your router. Consult the firmware's own documentation to configure that account. The stock root account is not required. Certificates are verified and redirects are not followed.

Default destination ranges are RFC1918 IPv4. `LIVEBOX_OS_ALLOWED_NETWORKS` can narrow them or explicitly add an operator-controlled VPN subnet. Loopback, link-local/metadata, multicast and unspecified addresses stay blocked regardless of the allowlist. Existing V3 connectors keep their narrower IPv4 validation. Registry HTTPS pins a hostname's resolved IP; a certificate without that IP in its SAN will be refused.
