# V4 development validation

Date: 2026-10-25. Scope: the development workspace and implemented connectors, not completion of the V4 roadmap or a universal-router certification. No production deployment or real router configuration was changed. This is not an official 4.0.0 release.

## Automated checks

- Windows / Python 3.12: 83 backend tests passed, including the original 52 tests and 31 new cases covering registry validation, session ownership/cleanup, CSRF, secret persistence/redaction, bounded/malformed ubus responses, SSH command/host-key restrictions, login throttling, observed notifications, metric parsing/history and single-use confirmations.
- Node 24: four frontend tests passed, including cancellation of obsolete requests.
- TypeScript and the Vite production build passed. No new Python or frontend dependency was introduced.
- `pip-audit` and `pnpm audit` found no known advisories in their checked resolutions. This is not a comprehensive operating-system/image audit or a guarantee of security.
- The GitHub workflow also runs Windows/Linux backend tests, frontend build/tests, secret/dependency checks and isolated Docker Compose startup/authentication checks. Consult the actual [Actions runs](https://github.com/Trimisdumb/livebox-os/actions) for the branch's Linux/Compose result; local Windows validation alone is not a Docker result.

## Browser verification

An isolated loopback instance used a temporary application account and a separate data directory. No production credentials, router session, device list or private wallpaper was used.

- All 23 navigation destinations were opened and their headings/rendered states checked; the developer console reported no warnings/errors during that pass.
- The dashboard was checked at 320, 390, 768, 1024 and 1280 CSS pixels with no document/content horizontal overflow. The mobile navigation and menu use a distinct layout. Header/mobile navigation targets were measured at 44 pixels high.
- Light and dark themes, view selection, widget hide/show, density selection and classic-desktop return were exercised.
- Fifty-one visible text elements were checked in each dashboard theme using computed foreground/background pairs. Minimum measured ratios were 6.28:1 (light) and 6.75:1 (dark), with no pair below 4.5:1 in that view. This does not stand in for an audit of every connected-device response.
- Livebox login opens its existing dialog and Escape closes it. The new dialog focus handling cycles form controls and restores the initiating control; mobile-menu Escape returns focus to its menu button.
- The unsupported ASUS connector disabled profile submission; a loopback router address was rejected by the backend and displayed a visible error without contacting a router.
- A clearly labeled temporary server profile tested the missing-SSH-configuration path. The SSH directory was unset and ping measurement was off, so no server was contacted. The failed read, real collection timestamps and unavailable metrics were displayed rather than successful connection data.
- A local rule was created, toggled, explicitly tested and its notification acknowledged. The notification identifies itself as a manual test and does not represent a fabricated network event.
- Non-sensitive preferences were exported and re-imported with success feedback. History CSV downloaded with the expected metric headers.

Real hardware writes were not clicked or executed. Their backend authorization, stale-state handling, expiry, re-read and token replay guards were tested with fixtures. OpenWrt and SSH were not tested on physical equipment; the published compatibility list states that limit. Actual on-screen keyboard behavior and a physical assistive-technology audit remain unverified; CSS-width checks are not represented as a physical-device test.

## Anti-Slop gate for the implemented workspace

These checks apply to the new workspace, not a claim that every item in the [V4 roadmap](V4.md) has shipped. Hardware-dependent controls use the isolated protocol tests above; they are not evidence of hardware validation.

### Hard gate

- R-02 PASS: new product prose uses ordinary punctuation; the owner's previously requested AI disclosure is preserved.
- R-03 PASS: the five viewport checks above found no horizontal overflow in the dashboard; mobile navigation and forms were inspected.
- R-17 PASS: missing measurements display unavailable; ping tests verify unknown output stays null.
- R-18 PASS: no testimonials, invented people or avatars were added.
- R-23 PASS: the existing SVG identity is reused; navigation and visual direction follow the supplied brief.
- R-24 PASS: all 23 navigation destinations were opened; unsupported vendors have explicit availability explanations.
- R-25 PASS: computed palette checks include muted light text 6.28:1, primary black/orange 6.75:1 and muted dark text 9.24:1. Control borders/focus use contrasting palette values; no blanket WCAG certification is claimed for hardware-dependent screens.
- R-26 PASS: new controls invoke navigation, local state, validated forms, fixed backend operations or explicit downloads; unsupported vendor submission is disabled.
- R-27 PASS: data readers have loading/error feedback and empty/unavailable explanations; a rejected target and missing SSH configuration were exercised.
- R-28 PASS: no generic FAQ was added to the workspace.
- R-32 PASS: native semantic controls, visible focus, skip link, Escape handling and dialog focus cycling are implemented; keyboard dialog/menu paths were exercised.
- R-33 PASS: features are implemented in the repository's React/Python/CSS sources, without runtime page injection.
- R-34 PASS: the same workspace was inspected in both themes; selected/hover buttons retain contrasting text.
- R-35 PASS within the development scope: the app ran locally, compiled, and the recorded navigation/control flows above were exercised; protected hardware operations have fixture coverage, not a claimed real-device click-through.
- R-36 PASS: no security score, public-port claim, CPU percentage from load average or universal compatibility guarantee was added.
- R-37 PASS: Orange identity, functional administration, mobile access and restrained motion come from the user's supplied brief; the design read/dials are recorded in DESIGN-V4.md.
- R-38 PASS: screenshots show an unconnected installation. Test-only records were clearly labeled and were not passed off as network observations from hardware.

### Purpose gate

- R-01 PASS: orange marks current navigation and the primary connection action, with the reason recorded in DESIGN-V4.md; no default gradient/glow was added.
- R-04 PASS: reused network/settings/protection icons describe their groups; written rationale is in DESIGN-V4.md.
- R-06 PASS: the installed Segoe UI/Arial stack is retained for offline administration and readability; monospace is limited to technical data.
- R-07 PASS: no decorative grid, blueprint or dot-pattern background is added to the workspace.
- R-08 PASS: arrows are not added as decorative button identities.
- R-09 PASS: availability is expressed as text, without decorative capsule badges.
- R-10 PASS: new workspace surfaces are solid, without page-wide glass effects.
- R-12 PASS: new controls use borders and spacing; legacy primary-button shadows are removed in the workspace.
- R-13 PASS: no new glow treatment is used.
- R-14 PASS: connection facts use definition lists, inventory uses rows and technical reads use labeled details; the hierarchy is documented.
- R-19 PASS: interaction feedback is restrained and reduced-motion rules are present; no endless status animation was added.
- R-22 PASS: no generic illustration or fabricated network imagery is added.

### Liveliness and quality locks

- Dials PASS: ENERGY 2 / RHYTHM 2 / MOTION 1 matches the connection focal point, varied data sections and restrained transitions.
- Focus/space/accent/motif PASS: the connection statement leads; sections use structural spacing, one orange accent and repeated equipment-first labels.
- C-1 / R-31 PASS: major palette, navigation, typography, spacing, icon and motion decisions have written reasons in DESIGN-V4.md.
- C-2 PASS: control behavior is wired to implemented operations; unavailable capabilities are explained rather than represented by fake actions.
- C-3 / R-05 PASS: the layout organizes requested equipment administration, not marketing sections or equal-sized metric cards.
- C-4 PASS within tested states: empty/blocked/missing-configuration flows and both themes were checked; physical keyboard/device validation limits remain stated above.
- C-5 PASS: metric sources, connection state and compatibility are explicit; no fabricated customers, claims or hardware results are introduced.
- R-11 PASS: modest control radii distinguish inputs/actions from flat data sections.
- R-15 PASS: actions name their effect, such as connecting equipment, preparing a change or exporting observations.
- R-16 PASS: new copy describes implemented actions and limitations without promotional superlatives.
- R-20 PASS: Orange accent, reused identity and equipment operations retain the project's character.
- R-21 PASS: both themes have working controls and were inspected.
- R-29 PASS: the workspace uses orange and neutral surfaces/text; existing WAN series are mapped to contrasting orange/neutral styles.
- R-30 PASS: the new workspace is not a clone of an unrelated product; the explicitly requested legacy desktop remains optional.
- Comment hygiene PASS: new comments explain DNS pinning or sensitive-data retention constraints; no decorative/narrated comment blocks were added.

## Release boundary

The published branch must retain the development label. Multi-user roles, full VPN lifecycle management, additional vendor drivers and the other pending items in V4.md require further implementation and validation before an official V4 release. No V4 tag, release or production deployment is part of this development publication.
