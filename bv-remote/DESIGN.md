# BV Remote — Design Intention

> Status: Phase 1 scaffold. The full design pass is **Phase 4**. This file records the
> intent now so drift can be detected before then. It is a standard to judge against,
> not the Phase 4 polish itself.

## Intention (one sentence)

Calm operator console: one obvious action per screen, and it is always obvious **which
device you're controlling** and **what you can do to it**.

## Brand / decisions

- **Family:** part of the projectBV family — dark surface, single yellow accent, trefoil mark.
- **Palette (tokens in `console/src/index.css`):**
  - bg `#0e0f11`, panel `#17191c`, panel2 `#1e2125`, line `#2a2e33`
  - text `#e9ebee`, dim `#9aa1a9`
  - accent `#ffd200` on accent-ink `#1a1a00`
  - ok `#5cd67a`, bad `#ff5c5c`
- **Accent is scarce:** yellow marks exactly one thing per screen — the primary action, and
  the selected device's border. Nothing else should be yellow.
- **Logo:** trefoil (`trefoilSvg` in `console/src/ui.js`), yellow-on-dark.
- **Layout:** fixed 320px device picker (left) + device panel (right), header on top.
- **Feel:** flat, dark, quiet. Rounded panels (radius ~12), generous panel padding.

## Density stance

This design gets **calmer as it grows, not busier.** New per-device capabilities arrive as
distinct, well-spaced panels (or tabs, once there are more than ~3). Configuration that is
set once (e.g. the shared secret) moves **out** of the main flow into a settings surface —
it should not accumulate at the top of the device panel. Growth = more structure, not more
things crowding one screen.

## What would violate it

1. More than one accent-yellow / primary-weight action competing on a single screen.
2. Persistent configuration (shared-secret bar, connection settings) sitting above the
   primary action in the main pane instead of in a settings/menu surface.
3. Ambiguity about which device is selected, or a device panel that doesn't lead with the
   device identity + agent status before its actions.
