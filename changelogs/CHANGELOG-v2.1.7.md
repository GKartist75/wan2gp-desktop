# Wan2GP Desktop Launcher v2.1.7 — Release Notes

## Bug Fixes

- **Blank / gray screen on launch (critical)** — `#installer` was nested inside `#dashboard` in `index.html`. Because `show()` toggles `.active` on all `.screen` elements, activating the installer set its parent dashboard to `display:none`, collapsing the installer to 0×0 so only the body background painted. Moved `#installer` out to be a sibling of `#dashboard` under `#app`; the installer now renders at full size.
- **Installer model-folder selection ignored** — Browse selections for checkpoints / LoRAs / output were being overwritten:
  - `renderer/app.js` `loadPaths()` unconditionally reset the three folder values to defaults on every call (startup, install-location change, dashboard refresh), clobbering any Browse choice. Now only fills a folder when its value is still empty.
  - `main.js` `write-wgp-config` force-overwrote the Output path with `getDataDir()/outputs` regardless of the user's choice. Now only defaults when the user picked no folder.
- **Topbar live metrics (CPU/GPU/RAM/VRAM) didn't start** — `startMetricsPolling()` was only called on a cold launch when already installed, so a fresh install showed the dashboard but never polled until a restart. Now called after install completes, with a guard against duplicate intervals.
- **Installer console blank** — the `#installTermBody` log element was missing from the DOM (a stray `</div>` swallowed it), so `renderTerminals()` / scroll / Follow targeted null and the console never rendered. Restored the `term-body` element.

## Changes

- **GPU handling** — removed the dead `webviewTag:true` from the main and popout windows (the app uses BrowserView + preload, not `<webview>` tags) and restored the conditional `disableHardwareAcceleration()` (only when `electronGpu` is `false`), matching v2.1.5 behavior.
- **Startup error visibility** — added a `window` `error` / `unhandledrejection` overlay on the splash so any future blank-screen root cause is shown instead of a silent gray window.
- **Window show** — restored `show:false` with the existing `ready-to-show` handler.

## Known design note

- GPU/VRAM percentages only populate when `nvidia-smi` is present (NVIDIA). On AMD/Intel those two stay — by design; CPU/RAM always work.

## v2.1.6 to v2.1.7 diff

See [compare/v2.1.6...v2.1.7](https://github.com/GKartist75/wan2gp-desktop/compare/v2.1.6...v2.1.7).
