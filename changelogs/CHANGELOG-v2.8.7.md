# Changelog — v2.8.7

**Topic:** Blank-screen harden (continued) — the `show:false` first-frame-never-commits class.

## Background

v2.8.6 added a **present-hammer** (`focus()` + `invalidate()` + 1px resize nudge every
500 ms) to force the compositor to present the first frame. It worked on the developer's
machine but **failed for multiple reporters** on issue #45 / #39:

- **dummydumb64** (RTX 3060, driver 610.88, Win11 26200): v2.8.6 still blank. CDP probe
  showed `requestAnimationFrame` at 60 fps (renderer alive), `visibilityState=visible`,
  `hasFocus=true`, but `Page.captureScreenshot` returned **only the html background**
  (`rgb 26,26,26`) and the active content layer was never presented. Reproduced across
  native RTX, `--use-angle=swiftshader --disable-gpu-compositing --in-process-gpu`, and
  `--use-angle=d3d11 --disable-direct-composition` — so it is **not** a specific GPU
  compositor path; the window surface itself never receives a stable committed frame.
- **satrincha** (RTX 5070 Ti, driver 610.88, dual 21:9 + 1080p): v2.8.6 still blank with
  the identical boot.log signature (`ready-to-show -> show()`, then `8s watchdog: forcing
  present`, no `first-paint`).

The common factor: a `BrowserWindow` created with **`show:false`** does not always commit
its first frame after `show()` on certain GPU/driver/compositor stacks. My machine (RTX 3080,
610.62) happened to present, which is why the hammer looked successful in local testing —
**the local test was not representative of the failing hardware.**

## Fix (v2.8.7)

`createWindow()` now passes **`paintWhenInitiallyHidden: true`** to the `BrowserWindow`
options. This forces Chromium to rasterize the web-content layer **while the window is
still hidden**, so when `ready-to-show` → `show()` fires, a fully committed frame is
already present and gets composited immediately — instead of relying on the compositor to
commit a frame at show time (the step that fails on the affected stacks).

The 2.8.6 present-hammer and the 8 s blank-screen watchdog are retained as harmless
backstops (the watchdog still surfaces the GPU-off diagnostic if a real `first-paint` never
arrives).

## Why this is the right lever

- The symptom (body background paints via the OS compositor, but the Chromium content
  layer never appears) is the textbook "show:false window never presents first frame" Electron
  bug. `paintWhenInitiallyHidden` is the option purpose-built to address exactly that.
- It is low-risk: the window is still created hidden (no flash-of-unstyled-content), and the
  splash screen covers the brief render.

## Verification

- `node --check main.js` passes.
- Local regression: unpacked 2.8.7 launches and paints (245 elements) as before.
- **Needs confirmation on the failing hardware** (RTX 3060 / RTX 5070 Ti, driver 610.88):
  after installing 2.8.7, the boot.log should show a `first-paint` mark and the window
  should render. If it still blanks, the GPU-off override
  (`%USERPROFILE%\.wan2gp-desktop-gpu-off`) remains the guaranteed fallback, and the boot.log
  from that attempt is the next diagnostic to share.

## Files changed

- `main.js` — `createWindow()`: added `paintWhenInitiallyHidden: true`; clarified the
  `ready-to-show` handler comment (offscreen paint now does the heavy lifting).
- `package.json` — version 2.8.6 → 2.8.7.
