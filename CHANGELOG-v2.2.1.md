# Wan2GP Desktop Launcher v2.2.1

**Bugfix release** — fixes Gradio "localhost not accessible" error on launch when the
user has proxy environment variables set (e.g. corporate VPN, HTTP proxies). Wan2GP
(wgp.py) uses Gradio 5.x which checks localhost accessibility and raises an error when
a proxy is configured without `no_proxy=localhost,127.0.0.1`.

## Fixes

- **Gradle "localhost not accessible" error** — the launcher now passes `--server-name
  127.0.0.1` to wgp.py by default (instead of `localhost`). The raw loopback IP bypasses
  DNS resolution and proxy interception, so Gradio's localhost accessibility check
  succeeds regardless of proxy settings. Also sets `NO_PROXY=localhost,127.0.0.1,::1` in
  the spawned process environment as a safety net.
- **All launch paths covered** — the fix applies to Desktop (webview), Browser, External
  Terminal, and the standalone "Launch Wan2GP.bat" desktop shortcut.
- **127.0.0.1 consistency** — all health-check requests (`Invoke-WebRequest`, TCP socket
  monitoring, browser URL, `waitForPort`) now use `127.0.0.1` instead of `localhost` to
  avoid the same proxy issue at every level.

## Notes

- The underlying issue is tracked upstream at [gradio-app/gradio#4046](https://github.com/gradio-app/gradio/issues/4046).
- Users who still encounter the error can set `--share` in their launch args (creates a
  public Gradio tunnel URL) as a last resort.
