# Security policy / Politique de sécurité

## Report privately

Email **[trim@kirbytrim.buzz](mailto:trim@kirbytrim.buzz)** with the affected version, a minimal reproduction and the potential impact. Use a subject beginning with `Security: Livebox OS`. Do not open a public issue containing exploit details or private network data before coordination with the maintainer.

**Never send passwords, session cookies, tokens, account files, private keys, full backups or sensitive router configurations.** Start with an anonymized explanation; agree on a safe exchange method if additional evidence is necessary. No response-time guarantee or bug bounty is currently offered.

## Signalement privé

Écrivez à **[trim@kirbytrim.buzz](mailto:trim@kirbytrim.buzz)** avec la version concernée, une reproduction minimale et l'impact possible. Préfixez l'objet par `Security: Livebox OS`. Évitez un ticket public contenant des détails d'exploitation avant coordination.

**N'envoyez jamais de mot de passe, cookie de session, jeton, fichier de compte, clé privée, sauvegarde complète ou configuration sensible.** Commencez par une description anonymisée. Aucun délai de réponse ni programme de récompense n'est garanti.

## Scope and supported versions

Only the latest published 3.0.x release is the security-maintenance target. There is no promise of backports to older private development snapshots. The public v3.0.0 candidate updates FastAPI, Starlette and cryptography after a dependency audit; it does not automatically update existing private installations.

Livebox OS is a high-privilege **local network administration tool**. The default Compose port binds to `127.0.0.1`. Do not create a public port forwarding rule for it. Use a trusted private network or an authenticated tunnel; configure TLS and `ORANGE_COOKIE_SECURE=1` when serving it over HTTPS. Plain HTTP is intended only for loopback/trusted private use. Do not set secure-only cookies while using HTTP.

## Security model and limits

- One administrator account per installation; Argon2id password hash on the private volume. This is not a multi-tenant service.
- Opaque HttpOnly, SameSite=Strict session cookies; server-side sessions. CSRF token and same-host Origin checks for mutations; origin and session validation for WebSocket.
- Router passwords are supplied through forms, never committed or put in `.env`. Livebox contexts and TP-Link tokens stay in backend memory. Optional TP-Link reconnect retains its password in memory for up to eight hours, never on disk. Sessions expire and are lost on restart.
- Private literal IPv4 router targets only, HTTP/HTTPS on ports 80/443, no redirects or environment proxy inheritance. SMB uses an explicitly selected private IPv4 on port 445, signed connections, SMB3 encryption by default and no DFS or reparse-point traversal.
- NAT writes require a short-lived, single-use prepared plan and revalidation. Router APIs cannot provide an atomic transaction across two devices. Partial/unknown results need inspection; an existing rule is not silently rolled back.
- Network observations and application backups can contain device names, private addresses and wallpapers. Treat the data volume and backups as private even though router passwords are excluded from exported application backups.
- React escapes router text; CSP restricts scripts to the application. Inline styles remain allowed for desktop window positioning and user-selected backgrounds. SVG uploads are not accepted as wallpapers.
- Compose enforces a 23 MiB request limit. Native installs also check Content-Length, but do not provide the same edge limit against chunked request bodies; keep native serving on loopback or use an equivalent limiting reverse proxy.
- Scanners identify known patterns and advisories; a clean scan is not a guarantee of absence of vulnerabilities. See [the publication audit](docs/PUBLICATION-AUDIT.md).
