# Wan2GP Desktop Launcher v2.2.1

**Feature + bugfix release** — fixes Gradio "localhost not accessible" error, adds
Share Link toggle for proxy/VPN users, adds dashboard Auto-Tune shortcut, and
simplifies settings tab navigation.

## New Features

- **Share Link toggle** (Settings → Launch tab) — enables `--share` and `GRADIO_SHARE=true`
  for users behind corporate proxies or VPNs where Gradio 5.x's localhost accessibility
  check fails. Creates a public Gradio tunnel URL. All 4 launch modes (Browser, Desktop,
  External Terminal, Chrome no-GPU) respect the setting.

- **Auto-Tune dashboard button** — a new ⚡ Auto-Tune button on the main dashboard (action
  grid, alongside Update / Check Updates / Desktop Shortcut) opens the Manage panel
  directly on the Auto-Tune tab for one-click hardware detection.

- **Settings tab navigation refactored** — `switchSettingsTab(tabName)` extracted as a
  reusable function, enabling programmatic tab switching from any UI element.

## Fixes

- **Gradio "localhost not accessible" error** — the launcher now passes `--server-name
  127.0.0.1` to wgp.py by default (instead of `localhost`). The raw loopback IP bypasses
  DNS resolution and proxy interception, so Gradio's localhost accessibility check
  succeeds regardless of proxy settings. Also sets `NO_PROXY=localhost,127.0.0.1,::1` in
  the spawned process environment as a safety net.

- **All launch paths covered** — the fix applies to Desktop (webview), Browser, External
  Terminal, and the standalone "Launch Wan2GP.bat" desktop shortcut.

- **127.0.0.1 consistency** — all health-check requests (`Invoke-WebRequest`, TCP socket
  monitoring, browser URL, `waitForPort`) now use `127.0.0.1` instead of `localhost` to
  avoid the same proxy issue at every level.

- **Error logging** — when the Gradio error is detected in stderr, a helpful message is
  logged directing users to the Share Link toggle in Settings.

## Notes

- The underlying issue is tracked upstream at [gradio-app/gradio#4046](https://github.com/gradio-app/gradio/issues/4046).
- The Share Link toggle is the recommended workaround when `--server-name 127.0.0.1` isn't
  sufficient.
