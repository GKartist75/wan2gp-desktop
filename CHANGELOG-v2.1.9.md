# Wan2GP Desktop Launcher v2.1.9

**Feature + bugfix release** — a new "Launch in External Terminal" mode that runs the server in a
real cmd window (like the desktop `Launch Wan2GP.bat` shortcut), plus terminal/UI reliability fixes.

## New
- **Launch in External Terminal** — a third launch mode (next to App/Desktop and Browser) that opens
  the server in a genuine Windows Terminal / conhost cmd window. It generates a `.bat` mirroring the
  `Launch Wan2GP.bat` shortcut (env activation, server port, and the extra args from the Manage menu),
  runs `python -u wgp.py ...` in the background, waits for the server, and opens `localhost` for you.
  The launcher keeps an in-app **Running** indicator + **Stop** button; Stop kills the server accurately
  via the captured python PID (with the window-title as a fallback). Closing the window also stops it.

## Fixes
- **White flash / freeze when switching to the floating terminal** — the floating console window now
  has a dark `backgroundColor`, and its `render()` is coalesced into a single `requestAnimationFrame`
  so high-volume logs no longer jank or stall the UI.
- **Double log replay** — removed a duplicate history send-on-load loop; the terminal now replays each
  log line exactly once when the view is (re)created.
- **"Back to menu" left Wan2GP on top of the dashboard** — `closeWebview` now closes the terminal
  first and destroys the BrowserView last, so the dashboard is fully interactive again.
- **Browser-mode Stop/Restart UI** — the Running indicator, Stop button, and per-mode reset are now
  shared by both Browser mode and the new External Terminal mode, so Stop/Restart works without
  restarting the launcher.

## Notes
- The desktop shortcut (`Launch Wan2GP.bat`, created from Manage) already includes the server port and
  the Manage-menu launch args, same as the new External Terminal mode.
