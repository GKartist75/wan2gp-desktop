# v2.8.6 — presentation-class blank screen, hardened (the "paints once then darkens" case)

A user (Marco, RTX 3060, Windows 11 build 26200) reported that v2.8.5 still
blanked, but with a *changed* symptom that was the key diagnostic:

- v2.8.4: window never painted at all (title bar only).
- v2.8.5: window **appears briefly, then goes black**. boot.log showed
  `ready-to-show -> show()` fired and the 8s watchdog fired
  (`watchdog: forcing show after 8s`) with **no `first-paint`** mark — meaning
  `ready-to-show` fired and `webContents.invalidate()` was called, but the
  compositor **never committed/persisted the first frame**.

Critically, he reproduced it across **three rendering backends** — the native
NVIDIA stack, `--use-angle=swiftshader --disable-gpu-compositing
--in-process-gpu` (pure software), and
`--use-angle=d3d11 --disable-direct-composition`. In every case: DOM correct,
`requestAnimationFrame` at 60fps, zero JS errors, and `Page.captureScreenshot`
returned only the solid body background. So the renderer is healthy — **the
compositor never presents the first frame.**

## Root cause

The launcher creates the window with `show: false` and shows it on
`ready-to-show` (the v2.6.0 path, restored in v2.8.3/2.8.5). On some driver
stacks Electron/Chromium creates the first layer but, after the initial
present, drops it and never re-presents — so the window shows the body
background (or paints once then reverts to `backgroundColor`). This is a known
Electron `show:false` + `ready-to-show` presentation bug; it is **not** a
GPU-driver crash (feature status was clean) and **not** the update-corruption
class.

The v2.8.5 `invalidate()` was a single nudge — enough to paint *once* ("appears
briefly") but not enough to make the layer stick on these stacks.

## Fix

Add a **present hammer**: after `ready-to-show`, keep forcing the compositor to
re-present the frame until a real `paint` event arrives (or 15s, then stop):

- `mainWin.focus()` — forces the OS/compositor to treat the window as
  foreground and present.
- `webContents.invalidate()` — requests a new frame.
- A **real 1px geometry nudge** (`setSize(w+1, h)` then back after 40ms) — this
  triggers a genuine resize event, which makes Chromium re-present the layer.
  This is the canonical workaround for the "frame never commits after
  show:false" Electron bug. Skipped when the window is maximized (a resize would
  un-maximize it).

The hammer runs every 500ms and self-clears on the first real `paint` event (so
a healthy machine stops nudging as soon as it paints). The 8s watchdog now calls
the same `_forcePresent()` and its message is corrected to "first frame never
committed" (the old text said "no ready-to-show", which was wrong — `ready-to-show`
had fired).

## What this means for users

- Healthy machines: window paints on `ready-to-show`; hammer stops immediately.
- Affected stacks (RTX 3060 / swiftshader / d3d11-off): the hammer now keeps the
  frame committed, so the launcher renders instead of going black.
- If even the hammer fails (genuine GPU-process death), the 8s watchdog still
  force-presents + surfaces the `%USERPROFILE%\.wan2gp-desktop-gpu-off` recovery
  steps.

## Bug B — stale `DATA_DIR_OVERRIDE` blanked the launcher (reported by JedsDeadBaby)

A *second*, deterministic blank-screen cause surfaced: the launcher pins its data
dir once to `%USERPROFILE%\.wan2gp-desktop-data-dir` and never re-validates it.
If the user renamed/moved their Wan2GP folder and reinstalled, the pinned path
went stale → `getDataDir()` / `getRepoDir()` resolved to a missing folder → the
backend couldn't find Wan2GP core → blank screen. Restoring the original folder
name made the pinned path valid again, which is exactly the "rename → blank,
restore → works" determinism the user reported.

Fix: both `getDataDir()` and the `app.whenReady()` redirect now check that the
pinned dir (or its `Wan2GP` core) still exists. If not, the stale override is
dropped and the launcher re-derives the default (now the valid reinstalled
location) and re-pins it — so a renamed/moved folder self-heals on next launch
instead of blanking.

## Files changed

- `main.js` — added `_forcePresent()` + `_presentHammer` interval (clears on real
  `paint`); watchdog now calls `_forcePresent()` and reports "first frame never
  committed". Corrected the misleading "no ready-to-show" watchdog text. Added a
  stale-`DATA_DIR_OVERRIDE` guard in `getDataDir()` and `app.whenReady()` that
  drops a dead pin and re-derives/re-pins the default data dir.
