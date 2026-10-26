# V4 desktop validation

Date: 2026-10-26. Version: `4.0.0-dev.1`, branch `develop/v4`. This record covers the restored desktop and implemented integrations, not completion of the V4 roadmap or certification of all routers. The previous separate administration shell is retired; its historical validation remains in Git history.

## Automated checks

- Backend: **90 passed** on the local Windows environment. Coverage includes authentication/CSRF, connector and NAT guards, isolated protocol fixtures, backup confirmation, image preservation, old-client preference updates and invalid desktop settings.
- Frontend: **9 passed**, covering API cancellation/errors/CSRF and desktop geometry, focus order, icon ordering, dock access and old-preference defaults.
- TypeScript and Vite production build passed. No dependency was added.
- `pnpm audit` and `pip-audit -r backend/requirements.txt` reported no known vulnerabilities at the time of this check.
- The existing CI workflow additionally checks backend tests on Windows and Linux, frontend build/tests, source publication checks, dependency vulnerabilities, full-history secret scanning and an isolated Docker Compose startup/authentication boundary. Docker is unavailable on this local Windows environment; Compose execution is checked by that CI job. Consult the branch's [Actions results](https://github.com/trim360/livebox-os/actions) for its actual outcome.

The local backend run emits an upstream Starlette/httpx deprecation warning; all 90 tests pass. This does not justify replacing tested runtime dependencies during a UI correction.

## Visual comparison with V3

The owner-supplied 1920 × 1000 V3 screenshot was inspected before editing. The running application was then captured at the same CSS dimensions and compared visually. It retains the top identity/theme/profile bar, large welcome message at the left, three-column colored app grid, right Livebox connection card, customizable background and translucent bottom dock. Measured V4 regions include the app grid at x225/y430 (550px wide), Livebox card at x1302/y290 (330px wide), and dock at y915 (65px high).

The reference's wallpaper is a private user import, not the built-in background. It was neither copied into the repository nor adopted as the default. Published [light](images/v4-network-light.jpg), [dark](images/v4-network-dark.jpg) and [phone](images/v4-network-mobile.jpg) captures show the actual isolated installation without connected hardware or personal network records. The additional apps extend the existing scrollable grid and dock.

## Browser checks

An isolated loopback backend with a disposable administrator and separate data directory was used. No production credentials or data were loaded.

- All **25 applications** were opened and closed as desktop windows, including the retained V3 tools and new V4 applications. Missing connections display explicit empty/unavailable states.
- Pointer drag and native corner resize were exercised. Keyboard arrows move, Shift+arrows resize, and the controls maximize/restore/minimize/close. Double-click maximize and focus ordering between two windows were checked. Geometry remains stable through reduction/restoration; a resize-observer animation feedback defect found during testing was fixed.
- Icon size/order and defaults, dock pinning, access to an unpinned minimized window, animation disabling and optional saved geometry were exercised. Old and extended preference/backup round trips preserve image bytes in backend tests.
- A public project screenshot was imported as a test wallpaper; fit, blur, focal position, persistence, context-menu access and default restoration were checked. No owner wallpaper was used.
- Desktop/window behavior was inspected at **320, 390, 768, 1024 and 1920 CSS pixels**. The inspected router form/window has no horizontal content overflow, the document stays within the viewport, and the dock remains on screen. A tablet positioning override and the old five-app mobile dock limit were corrected. All 25 dock apps remain scrollable on phones; notifications remain accessible.
- Mobile window controls measured **44 × 44px**. Router application tabs were switched with arrow keys. The Livebox dialog cycles focus in both directions; Escape closes it and restores the initiating button.
- Selecting an unsupported ASUS connector disables profile submission. No unsupported router is presented as connected.
- No browser warning/error messages were recorded during the application navigation pass.

These are browser viewport checks, not physical-device, screen-reader or on-screen-keyboard certification.

## Anti-Slop and preservation

All six requested skills were applied during implementation, with the supplied V3 reference taking precedence for colored icons, glass effects and desktop structure. The [design decisions](DESIGN-V4.md) record that choice. New prose and controls have specific purposes, visible states and plain labels; no fictional measurements or unrelated landing-page sections were added.

The supplied contrast checker measured muted light text `#626773` on white at **5.66:1**, muted dark text `#bdc0cc` on `#23242b` at **8.52:1**, and primary text `#202020` on orange at **6.20:1**. Visible focus, native forms, keyboard window controls/tabs, mobile reflow, reduced-motion handling and explicit empty/error/unavailable output are implemented. These palette checks are not a blanket accessibility claim for arbitrary hardware responses or imported wallpapers.

Source publication checks and redacted secret scanning cover the staged change and Git history before pushing. No actual `.env`, production data directory, private wallpaper, credentials, Debian deployment or router configuration was modified for this change. No stable V4 release or force push is part of this work.

## Hardware limits

The unchanged V3 hardware evidence covers one Livebox 5 and Archer AX58 V1.0 firmware 1.5.2 Build 20250812 rel.38324(4555). Existing functionality has regression/protocol coverage here; it was not re-executed on the owner's network during this UI correction. OpenWrt, SSH/Linux/VPN observations, newer Livebox reads/writes and authenticated SMB still have the limitations recorded in the [V4 guide](V4.md), [connectors](CONNECTORS.md) and [server/VPN guide](SERVERS-VPN.md). Physical-device validation and unfinished roadmap functions remain outstanding.
