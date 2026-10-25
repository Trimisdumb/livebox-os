# Changelog

## Unreleased: V4 development

This branch is not an official 4.0.0 release. The package/API baseline remains 3.0 until the release scope is ready.

- Added a grouped network workspace with mobile navigation, keyboard support, two themes, widget selection, density and non-sensitive preference export/import. The classic desktop remains available.
- Added multiple router/server profiles, destination allowlisting, DNS pinning, passive gateway candidates, connection ownership and configurable session collectors.
- Added fixed OpenWrt ubus reads and optional dedicated-key SSH observations for Linux, systemd, Docker, WireGuard, OpenVPN and Tailscale. These integrations are protocol/adapter tested, not hardware validated.
- Added Livebox guest/schedule/firewall/ping/DMZ/DynDNS/reboot-history reads and confirmed guest/firewall/reboot operations, without executing them against real devices during development.
- Added local device annotations/favorites, availability history and CSV/JSON exports, opt-in measured ping latency/loss, transition-based notification rules, manual rule tests and acknowledgement.
- Added targeted ping, DNS, TCP and bounded traceroute diagnostics, cancellation of obsolete read requests, SSH/confirmation regression tests and additional secret-field redaction.
- Kept exact TP-Link firmware restrictions, existing Wi-Fi/DHCP/NAT/share/backup functionality and existing deployment defaults. No production upgrade is performed.
- Documented [remaining V4 work](docs/V4.md), [connector scope](docs/CONNECTORS.md), [SSH/VPN setup](docs/SERVERS-VPN.md) and [validation](docs/V4-VALIDATION.md).

## [3.0.0] — public release candidate

Prepared on 2026-10-25. This entry does not mean the release has already been published.

### Added

- Firmware-specific Archer AX58 V1 connector, authenticated WAN/LAN and client reads, Wi-Fi reads and confirmed NAT operations.
- Observed network topology, coordinated double-NAT preparation, conflict checks, verification, managed updates/deletes and ownership-limited rollback.
- Network monitoring, persistent audit events and diagnostics for both routers.
- Read-only SMB2/3 shares with explicit server/share selection, directory browsing and bounded downloads.
- Public English/French documentation, MIT license and third-party notices, contribution/security policies, issue templates and CI checks.

### Fixed

- Livebox NAT object/PascalCase parsing and case differences in device/call data.
- Consistent Livebox → TP-Link rule order and destination selection when editing an operation.
- Secret redaction, session cleanup and preferences persistence after failed loads.

### Security and packaging

- Public candidate uses FastAPI 0.162.0, Starlette 1.10.0 and cryptography 50.0.2 following advisory review.
- Private deployment notes, real network fixtures and owner-supplied legacy raster artwork are excluded from the public repository. The current SVG-based interface is preserved.
- Public history starts from a sanitized source snapshot. The private development repository and deployed system are preserved separately.

### Known limits

- Hardware verification covers Livebox 5 and Archer AX58 V1.0 firmware 1.5.2 Build 20250812 rel.38324(4555), not all Orange/TP-Link devices.
- TP-Link Wi-Fi writes, TP-Link firewall reads, public port reachability and a real authenticated SMB share are not validated.
- Existing NAT rules are preserved and are not automatically adopted into coordinated operations.
