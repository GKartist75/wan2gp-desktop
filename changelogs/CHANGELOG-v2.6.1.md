# v2.6.1 — The GUI stops disappearing

User reports: *"Every so often in Desktop mode, the GUI disappears. If I'm
running a generation it still runs but then I have to reload the GUI back to
its default state."*

That was a Chromium renderer crash with no handler anywhere. On Windows, a
display-driver hiccup (TDR) under heavy GPU load — a Wan2GP generation
saturating the card — can kill the GPU process and take a renderer down with
it. The window went blank, the main process and the Python server kept
running (so generation continued), and nothing in the app noticed, so the
only recovery was a manual reload that stranded the user on the dashboard.

The launcher now watches for those deaths and heals itself.

## Fixed

- **The launcher window auto-reloads when its renderer dies.** A watchdog on
  `render-process-gone` detects the crash, logs the reason and exit code,
  and reloads the UI automatically (bounded to 2 auto-reloads per 10 minutes
  so a genuinely broken machine can't enter a reload loop).
- **Desktop mode is restored, not lost.** The renderer reports which UI mode
  it is in (`app` / `browser`). When a crash happens, the reloaded UI asks
  the main process what it was doing and re-opens the embedded Wan2GP view
  (with the floating console per its saved dock) or re-arms the browser-mode
  UI — the user lands where they were, not on a bare dashboard. Generation is
  never touched: the server runs in its own process.
- **The embedded Wan2GP page also self-heals.** If the BrowserView renderer
  crashes (same GPU/driver risk), it is reloaded automatically with a toast
  in the shell, instead of leaving a dead grey panel.
- **GPU-process deaths are diagnosed.** `child-process-gone` flags a crashed
  GPU process, so the recovery message can say *"the display driver likely
  reset while the GPU was under heavy load"* and wait ~2s for Chromium to
  respawn the GPU process before reloading (a reload into a dead GPU process
  crashes right back).
- **Repeated crashes stop looping and say what to do.** After 2 crashes in 10
  minutes the auto-reload stops and the log (plus a notification) points at
  the real fix: disable GPU acceleration in Settings → General → *Enable GPU
  acceleration*, then restart the launcher.
- **Pop-out and floating-console windows** reload themselves too if their
  renderer dies.

## Impact

- Desktop mode: a disappearing GUI now comes back by itself in ~1–2 seconds,
  in the same state, with the generation still running.
- Browser mode: the running-state UI is restored after a crash.
- No behavior change for healthy sessions — the watchdog only acts when a
  renderer actually dies.
