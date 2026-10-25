# Contributing / Contribuer

Thank you for helping improve Livebox OS. AI-assisted contributions are welcome; they must still be understood, reviewed and tested by their author. Constructive criticism is welcome. Report security issues privately using [SECURITY.md](SECURITY.md).

Merci de contribuer à Livebox OS. Les contributions assistées par IA sont acceptées, mais leur auteur doit comprendre, relire et tester le code. Pour une faille de sécurité, utilisez [SECURITY.md](SECURITY.md), sans ticket public contenant des données sensibles.

## Development

Use Python 3.12+ (64-bit), Node.js 24 and pnpm 11.25.0. From the repository root:

```sh
python -m venv .venv
# Linux: source .venv/bin/activate
# PowerShell: .\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements-dev.txt
npx --yes pnpm@11.25.0 --dir frontend install --frozen-lockfile
npx --yes pnpm@11.25.0 --dir frontend build
python -m pytest backend/tests -q
npx --yes pnpm@11.25.0 --dir frontend test
```

For the Vite development server, use `npx --yes pnpm@11.25.0 --dir frontend dev`. It binds only to loopback and proxies `/api` to the local backend on port 8000. Keep both on your development machine.

## Pull requests

- Open an issue before a major change. Keep changes small and preserve the existing desktop and private data formats.
- Explain the problem, behavior after the change and tests actually run. Mark simulated tests separately from hardware tests.
- Provide model, hardware revision and firmware for connector changes. One tested router does not establish support for a product family.
- Never attach `.env`, backups, account files, router responses, screenshots of real devices, logs with tokens or packet captures without anonymizing them.
- Do not replay network writes automatically, remove rules belonging to another operation, enable UPnP or expose administration publicly.
- Keep third-party license notices. New dependencies need a clear purpose and license review.
- Run the tests above and `python scripts/check_release.py` before submitting.

By submitting a contribution, you confirm you may license your original contribution under the project's MIT license. Third-party code retains its own license; identify it explicitly.

## Hardware testing / Tests matériels

Use your own equipment or equipment you have permission to administer. Obtain explicit approval for the exact NAT addresses, ports, protocol and cleanup before any write. A rule being present is not proof of public reachability. Do not reset routers or change an existing topology for a test.

Testez uniquement du matériel que vous êtes autorisé à administrer. Obtenez l'accord explicite sur les adresses, ports, protocole et nettoyage avant toute écriture. Une règle présente ne prouve pas l'accessibilité publique. Ne réinitialisez pas un routeur pour faciliter les tests.
