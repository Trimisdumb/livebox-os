# Validation record — public v3.0.0 candidate

Date: 2026-10-25. Results below distinguish isolated tests, application startup and earlier hardware checks. No router was reset, reconfigured or subjected to a new NAT test during publication preparation.

## Application checks

- 52 isolated backend tests passed on Windows x64 / Python 3.12 with the public candidate dependencies, including FastAPI 0.162.0, Starlette 1.10.0 and cryptography 50.0.2.
- Three frontend tests passed and the TypeScript/Vite production build completed.
- The frontend source and current SVG logo are unchanged from the existing project after normalizing Git line endings. The built frontend asset content is unchanged.
- An isolated loopback instance started successfully. Its actual desktop, personalization and unconnected NAT application were captured with a temporary local account. No production account, router data or personal wallpaper was used.
- Direct browser CLI launch failed in this environment; screenshots were instead captured and visually checked through the integrated browser. This does not indicate an application startup failure.

Clean-clone and Compose results are recorded after execution below. CI workflows are prepared, but have not run on GitHub because no remote repository has been created or pushed.

## Earlier real-hardware verification

Before this publication task, on the existing private 3.0 installation:

- Livebox 5: authenticated status, firmware/uptime, GPON/WAN counters, devices, Wi-Fi/DHCP reads, calls and NAT rules were read from the actual router.
- Archer AX58 V1.0, **1.5.2 Build 20250812 rel.38324(4555)**: authentication, firmware identity, WAN/LAN, Ethernet/Wi-Fi clients, Wi-Fi reads, DHCP, CPU/memory and NAT reads succeeded.
- A temporary TCP double-NAT plan was explicitly approved, created on both routers, read back and deleted. The pre-existing rules were preserved. This checked rule lifecycle, not public reachability.
- Ping and authenticated API diagnostics succeeded for both devices. Livebox firewall level was read; no firewall protection was disabled.

These results establish a narrow hardware baseline, not support for all router models or firmware. The public candidate's dependency upgrades have isolated protocol regression coverage; a new real-router login or write was not repeated during this packaging task to preserve the private deployment.

## Limits

Coordinated updates, conflict checks, partial failures, rollback and SMB path protections are covered by isolated tests. No real fault injection, public reachability probe or authenticated SMB share test is claimed. TP-Link Wi-Fi writes and firewall reads remain unavailable. Application backup/restore is covered by isolated tests rather than destructive restoration on production.

Screenshots intentionally show no connected devices and should not be presented as proof of live router communication. Exact private addresses, device names, credentials, deployment instructions and original private screenshots are excluded from this public record.
