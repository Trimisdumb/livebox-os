# V4 desktop design decisions

Design direction: retain the V3 desktop shown in the owner's reference, extending its applications. ENERGY 2 / RHYTHM 2 / MOTION 1. The supplied reference takes priority over conflicting aesthetic rules in the six Anti-Slop skills.

- Keep the top logo/theme/profile bar, large left welcome message, three-column colored app grid, right Livebox connection card and translucent bottom dock. These are the recognizable V3 structure.
- Reuse the existing SVG identity, Lucide icons, icon colors and built-in Signature/Dune/Minuit backgrounds. The reference screenshot's imported wallpaper belongs to its owner and is neither included nor made the default.
- Keep network forms inside movable windows with solid theme surfaces, so arbitrary backgrounds do not interfere with readability. Custom wallpaper receives a scrim and contrasting desktop labels.
- Keep the dock above windows and allow its application strip to scroll when space is limited. Minimized and unpinned open applications remain reachable.
- Use a generic Routeurs application. A firmware-specific connector remains explicitly identified within it; this does not imply support for every router.
- Place VPN, servers, security reads, notifications, automations and the optional network overview in desktop applications. There is no separate primary shell or sidebar.
- Keep Segoe UI/Arial for offline operation and continuity with V3. Labels and data explain state.
- Preserve existing image/theme/fit/blur preferences. New desktop options are additive, with defaults for old records. Window geometry is optional and browser-local.
- Use focusable title bars, arrow-key movement, Shift+arrow resizing and Enter maximize/restore. Native controls and keyboard tabs remain visible and labeled.
- On phones, welcome text, connection action and app grid reflow vertically. Windows fit above the dock and their content scrolls. Window controls have 44px touch targets.
- Keep the brief opening animation; optional animation disabling and system reduced-motion preferences take precedence. No perpetual decorative motion is added.
- Measure native resize layout dimensions without animation transforms. Clamp geometry on opening and viewport changes; normalize focus order below the dock.
- Missing measurements stay unavailable. No fictional clients, rates, security scores or universal compatibility claims are added.

See [validation](V4-VALIDATION.md) for checks actually performed and [remaining development work](V4.md) for capability limits.
