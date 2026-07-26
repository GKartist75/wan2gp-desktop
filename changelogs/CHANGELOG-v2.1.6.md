# Wan2GP Desktop Launcher v2.1.6 — Release Notes

## Bug Fixes

- **Tray icon lingering after close** — closing the window now properly quits the app and destroys the tray icon in `before-quit`, preventing orphan icons in the Windows notification area.
- **Child process cleanup** — replaced `.kill()` with `killProcessTree()` (`taskkill /f /t` on Windows), ensuring Wan2GP server and setup processes are reliably terminated including child processes.
- **Single-instance lock** — added `app.requestSingleInstanceLock()` to prevent multiple launcher instances stacking.

## Changes

- **Window close behavior** — clicking X now quits the app instead of minimizing to tray.
- **Launch handler** — Wan2GP is now spawned directly (no temp batch script), with stdout/stderr streamed to the launch log and the process tracked via `_wangpProc`.
- **`before-quit` cleanup** — destroys tray, kills child process trees, closes DevTools to prevent orphan renderer processes.

## v2.1.5 to v2.1.6 diff

See [compare/v2.1.5...v2.1.6](https://github.com/GKartist75/wan2gp-desktop/compare/v2.1.5...v2.1.6).
