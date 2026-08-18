# v2.8.5 — in-app update no longer blanks the launcher (handle-release fix)

A user reported the exact symptom the v2.8.x line has been fighting all along:
after updating **within the app** (2.6 → 2.8.4), the launcher opened to a
**blank window — title bar visible, content never appeared** — while a clean
2.6 install worked fine. This release fixes the root cause of that specific
failure: the installer swap running while the app still held handles on its
own install directory.

## Root cause

The launcher uses `electron-builder` NSIS packaging + `electron-updater`. The
"Install & Restart" flow calls `autoUpdater.quitAndInstall()`, which runs the
full NSIS installer **over the still-running app** to swap `app.asar` /
extracted files.

The old code released handles **too late and too partially**:

- `ipcMain.handle('install-update')` called `autoUpdater.quitAndInstall()`
  **directly, with zero teardown first**.
- `app.on('before-quit')` (the only teardown path) killed the setup process
  and the Wan2GP server, but **missed the `_bv` BrowserView and the `_pulseWin`
  progress window** — and closed DevTools only for `mainWin`, not `_bv`.

So when NSIS tried to overwrite the install dir, a still-live process or
handle (server child, embedded BrowserView, pulse window) could hold a file
open. On Windows the swap then completes **partially** — a corrupt / half -
written `app.asar`. The next launch loads that bundle, `loadFile(index.html)`
hits `did-fail-load` / `preload-error` / a dead `window.w2gp`, and the
renderer never paints: title bar only, blank body. This is exactly why v2.8.4
added `did-fail-load` / `preload-error` → splash diagnostics and a launcher -
local `boot.log` — to self-diagnose this class of failure.

## Fix

One `forceTeardown()` function now releases **every** handle that can lock the
install dir, reused by all three teardown paths:

- **`install-update`** — calls `forceTeardown()` **before** `quitAndInstall()`,
  so all handles are gone *before* the NSIS swap runs, instead of racing it.
- **`autoUpdater.on('error')`** — if an update was in flight (`_updateActive`),
  it now `forceTeardown()`s and clean-quits after 1s. A failed in-flight update
  used to leave the install dir half-swapped with locks held; now the app exits
  cleanly so a **manual reinstall / in-app update after is never blocked** by
  stale handles.
- **`before-quit`** — replaced the partial inline teardown with `forceTeardown()`,
  which additionally covers `_bv` + `_pulseWin` that the old code missed.

`forceTeardown()` releases: setup process tree, Wan2GP server (incl.
external-terminal PID file + title kill), the embedded `_bv` BrowserView,
the `_pulseWin` window, DevTools on both `mainWin` and `_bv`, and the tray.
It is idempotent (each step wrapped in try/catch), so calling it from multiple
paths is safe.

## What this does NOT change

- It does not touch the **show-path** regression fixed in v2.8.3 (window showed
  ~0.5s then vanished) — the window still shows only on `ready-to-show`.
- `autoUpdater` is still policy-driven (auto-update toggle respected); this
  only hardens the *teardown* around the swap, not the update policy.

## Also fixed in 2.8.5: the presentation-class blank screen (issue #45, part 2)

A separate, still-open failure in issue #45 (reporter `dummydumb64`, v2.8.4,
Win11 + RTX 3060): the window shows and **stays**, title bar visible, content
**never paints** — `boot.log` shows `ready-to-show -> show()` and
`did-finish-load`, but **no `first-paint` mark**. CDP confirms the renderer is
alive (DOM correct, rAF 60fps, zero JS errors) yet `captureScreenshot` returns
only the body background. This is **not** the GPU-compositor class (the
`%USERPROFILE%\.wan2gp-desktop-gpu-off` file does *not* help; it fails
identically in swiftshader software rendering) — it is a **window-surface
presentation failure**: `ready-to-show` fires but Chromium never commits a
frame on that display stack.

Root cause in the old code: the blank-screen watchdog keyed on `ready-to-show`
(`_painted`), so once `ready-to-show` fired it considered the window "painted"
and the watchdog **never ran** for this class — leaving a silent blank window
with no diagnostic. Two changes:

1. The watchdog now keys on **real paint** (`paint` event → `_didPaint`, i.e. an
   actual `first-paint` mark), not on `ready-to-show`. If `first-paint` never
   arrives within 8s, the watchdog force-shows + shows the GPU-off diagnostic,
   exactly as intended.
2. On `ready-to-show`, immediately after `show()`, the launcher calls
   `webContents.invalidate()` to **force a compositor frame** — the proven
   nudge that makes the first frame actually commit on the affected stacks
   (the v2.8.2 show-on-`did-finish-load` path painted fine; the problem is only
   the frame never being committed after a `show:false` + `ready-to-show`
   sequence, which `invalidate()` resolves).

The GPU-compositor class (issue #39) is unchanged and still fixed by the
`%USERPROFILE%\.wan2gp-desktop-gpu-off` override.

## User-side recovery (if a prior update already blanked you)

1. **Uninstall** Wan2GP Desktop Launcher (Control Panel), then reinstall the
   latest `.exe` from the [Releases page](https://github.com/GKartist75/wan2gp-desktop/releases)
   with the launcher **fully closed** (no live process holding files).
2. If a clean install *still* blanks → it's the GPU class, not the update class:
   create an empty file `%USERPROFILE%\.wan2gp-desktop-gpu-off` and restart.
3. To diagnose which class: open `%LOCALAPPDATA%\Wan2GP Desktop Launcher\boot.log`
   after a blank launch. `first-paint` / `ready-to-show` **absent** + a
   `did-fail-load` mark = corrupt bundle (update class, fixed here). A long
   stall with no paint = GPU class (override file).

## Files changed

- `main.js` — added `forceTeardown()`; wired into `install-update`,
  `autoUpdater.on('error')`, and `before-quit`; added `_updateActive` flag.
