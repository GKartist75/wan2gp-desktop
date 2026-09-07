# v3.4.2 — Final Electron release: switch to the Tauri edition

This Electron edition is **retired**. [Wan2GP Desktop Launcher Tauri](https://github.com/GKartist75/Wan2GP-Desktop-Tauri) is the only edition still maintained — same launcher, same Wan2GP, same features, ~3 MB installer instead of ~150 MB, faster startup, lower RAM.

## What changed

- **Sunset banner in the app** — the dashboard now opens with a permanent notice recommending the Tauri edition, with a 3-step switch guide: download the [Tauri release](https://github.com/GKartist75/Wan2GP-Desktop-Tauri/releases/latest), install & launch it (it detects this Electron app and offers to remove it), done. Wan2GP install, models and settings carry over untouched — nothing to re-download. Dismissing the banner hides it for the session only.
- **README retired** — the front page is now a sunset notice pointing at Tauri (plus a star request for the Tauri repo). The full Electron-era documentation is preserved at `docs/archive/README-electron-final.md`.

No functional changes otherwise. Thank you for using the Electron edition — see you on Tauri.
