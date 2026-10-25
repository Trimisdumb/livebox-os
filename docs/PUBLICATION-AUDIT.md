# Publication audit — Livebox OS v3.0.0

Prepared 2026-10-25. Scope: application source, browser/deployment security boundaries, repository contents, all reachable private-development Git history, public packaging, dependency advisories and licensing. This is a source/dependency review, not an independent penetration test or cryptographic certification.

## Result

The public repository is prepared as a **fresh sanitized snapshot**, not a rewrite or push of the private development repository. The original repository, private configuration and deployed services are preserved. No GitHub repository, push or public release has been created.

Gitleaks 8.30.1 scanned all 13 private development commits with redacted output and found no recognized secret. The historical review inspected 134 file blobs. It found private deployment/network metadata and two literal Argon2-prefix assertions in tests; the assertions are not stored password hashes. Private metadata is removed from the public copy. No real credential exposure requiring rotation was established by this review. A scanner cannot prove that no secret has ever existed outside its scope.

## Findings and dispositions

| ID | Severity | Evidence / location | Disposition |
|---|---|---|---|
| PUB-01 | High | Original `backend/requirements.txt`: cryptography 46.0.3 and FastAPI 0.121.3 resolved to Starlette 0.50.0; pip-audit returned 23 advisory records across those two packages, including duplicates | Public candidate uses cryptography 50.0.2, FastAPI 0.162.0 and Starlette 1.10.0; isolated regressions pass, fresh Python audit reports no known advisory. Existing private deployment is not automatically upgraded |
| PUB-02 | High (privacy) | Historical operational README/deployment/validation documents and some network test fixtures contained installation-specific metadata | Public documentation is rewritten, fixtures generalized, and public Git history starts clean. Do not push the original private history or old source archives |
| PUB-03 | Medium | Livebox `set_cookie` in `backend/main.py` originally used only the internal request scheme, unlike application-auth cookies | Public candidate also honors `ORANGE_COOKIE_SECURE`; a regression checks the TLS-proxy configuration. HTTP local defaults remain usable |
| PUB-04 | Low (licensing) | Unused, owner-supplied `frontend/public/orange-logo.png` had no documented redistribution license | Excluded from public source/history; the legacy URL returns the existing project SVG. The current interface and private original are preserved |
| PUB-05 | Medium (residual, native serving) | `backend/main.py` validates Content-Length; native chunked JSON bodies do not have the same edge limit as Compose | Compose nginx enforces 23 MiB. Native serving defaults to loopback; use an equivalent limiting proxy before private-network exposure. Do not expose administration publicly |
| PUB-06 | Informational | AX58 authentication reproduces firmware-specific RSA/AES/HMAC behavior, including required legacy padding/hash choices | Limited to the observed firmware; no universal compatibility or independent cryptographic assurance is claimed. Use trusted private networks |

## Controls reviewed

- Administrator account hashing with Argon2id, no shipped password, first-device approval for Docker bootstrap, login throttling and opaque server-side sessions.
- HttpOnly/SameSite cookies, explicit HTTPS secure-cookie setting, same-host Origin/CSRF validation, protected OpenAPI and authenticated/origin-checked WebSocket.
- No configured permissive CORS, debug server, raw HTML injection, unsafe deserialization, shell interpolation or arbitrary public outbound router target.
- Literal RFC1918 IPv4 router validation, ports 80/443 only, redirects disabled, environment proxies disabled and TLS validation preserved.
- TP-Link URL token confined to the backend and HTTP client logs suppressed; redaction of Wi-Fi keys, passwords and contexts; operational logging avoids request bodies.
- Prepared NAT tokens expire and are single-use; conflicts, identity/topology checks, operation ownership and partial/unknown states are explicit. Public reachability is not inferred.
- SMB private target, fixed share/port, signed sessions, optional required SMB3 encryption, no DFS/reparse traversal, read-only paths and bounded downloads.
- Persistent account/profile/settings files, observations, wallpapers and backups remain private and ignored. Exports exclude router passwords and account hashes, but still contain private metadata and must not be shared blindly.
- Compose loopback binding, no backend published port, non-root runtime, read-only filesystem, capabilities dropped, resource limits and healthchecks.

## Dependency and license review

`pip-audit` and `pnpm audit` query known advisory databases; no advisory was reported for the updated Python resolution or the locked frontend at review time. Audit details are recorded in local validation artifacts. This does not cover every operating-system/base-image package or unknown vulnerability; container operators must keep base images current and perform their own image scans.

LiveboxMonitor's MIT notice is retained. No GPL TP-Link reference package/source or proprietary firmware bundle is redistributed. Source comparison found no large exact implementation sequence between the application and the reference repositories; that is supporting evidence, not proof about every possible derivative work.

Dependency license texts, notices and versioned source pointers are retained in `licenses/` and `docs/dependency-licenses.json`. Apache/BSD/ISC/PSF notices, MPL file-level source requirements and CC-BY attribution are not replaced by the root MIT license. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Publication gate

The candidate passed tracked-file/documentation-link/image-metadata checks, clean-clone tests and isolated Compose startup. Public Git history and release-file scans are repeated for the final local tag/archive. No approval is implied by preparing a local commit/tag or source archive. Public creation and push remain separate human-approved actions.

The isolated test resources were removed. All 34 existing service containers and the private application's source/persistent non-SQLite file hashes matched the initial baseline. The private deployment therefore still uses its existing dependencies; applying the candidate's security updates to it is a separate operation requiring its own deployment plan.
