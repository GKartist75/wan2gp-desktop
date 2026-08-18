# Changelog — v2.8.7

**Topic:** Blank-screen ROOT CAUSE fix — the `show:false` + viewport-derived-height
layout collapse (this is the real cause behind issues #39, #45, and every 2.8.x
blank report).

## Root cause (found by tracing the actual code, not by symptom)

The launcher creates its `BrowserWindow` with **`show: false`** and shows it on
`ready-to-show` (this pattern has been unchanged since v2.0.0 — it was already in
2.6.0). The entire UI height chain is **viewport-derived**:

```css
html, body { height: 100%; }
body        { height: 100vh; }
#app        { height: 100vh; display: flex; flex-direction: column; }
.screen     { display: none; height: 100%; }   /* 100% of #app */
```

When a `BrowserWindow` is created **hidden**, Chromium on certain GPU/compositor
stacks (reproducers: **RTX 3060** and **RTX 5070 Ti**, driver **610.88** — NOT the
dev machine's RTX 3080 / 610.62) **seeds the layout viewport at 0 height**. Because
`#app` and every `.screen` derive their height from `100vh`/`100%` of that viewport,
the whole flex column collapses to **0×0**. The `body` background (`#1A1A1A`) still
paints — it's the document root, handled by the OS compositor — but every `.screen`
(splash, dashboard, installer) is **0-height → invisible**.

This is exactly what the reporters' diagnostics showed:

- **dummydumb64** (RTX 3060): CDP `Page.captureScreenshot` returned only
  `rgb(26,26,26)` (= `#1A1A1A`, the renderer `html,body` background, **not** the
  window's `backgroundColor #0f0f0f` and **not** the splash's `#242424`), and
  `installer#getBoundingClientRect()` was `0×0`. Proof the renderer body painted but
  the screens collapsed — a **layout failure, not a present failure**.
- **satrincha** (RTX 5070 Ti, 610.88): identical boot.log signature, identical
  symptom.

## Why prior 2.8.x fixes were band-aids (and why they failed)

- 2.8.2/2.8.3: changed the *show timing* — didn't touch the hidden-layout race.
- 2.8.5/2.8.6: added `invalidate()` + resize-nudge "present hammer" keyed on the
  (wrong) theory that the compositor dropped a committed frame. It worked on the dev
  machine (RTX 3080 reflows the 0-height layer on nudge) but **did nothing** for the
  RTX 3060/5070 Ti reporters — you cannot re-present or re-rasterize a **0-height
  layer** into something visible. The hammer was treating a layout symptom, not the
  cause.

So **none** of 2.8.2–2.8.6 addressed the actual bug; they were iterations on a
misdiagnosis. The bug predates 2.8 entirely (it is in 2.6.0 too) — 2.8.x just hit
more users (larger base + driver 610.88).

## Fix (v2.8.7)

Create the window **`show: true`**. With the window visible from frame 0, the layout
viewport is real immediately, `100vh`/`100%` resolve to the true window size, and the
hidden-layout collapse **cannot occur**. This eliminates the entire class — both the
present path and the layout path — in one change. The only observable effect is the
window is visible during its own first paint (a 1-frame flash of the dark splash
background, which is imperceptible).

`paintWhenInitiallyHidden: true` and the 8 s blank-screen watchdog are retained as
harmless backstops (the watchdog still surfaces the GPU-off diagnostic if any stack
still fails to paint).

## Verification

- `node --check main.js` passes.
- Local regression: unpacked 2.8.7 launches and paints (247 elements) as before.
- **Needs confirmation on the failing hardware** (RTX 3060 / RTX 5070 Ti, driver
  610.88). After installing 2.8.7, the boot.log should show
  `ready-to-show (window already visible via show:true)` and the window should render.
  If it still blanks, the `boot.log` + a `Page.captureScreenshot` colour reading is the
  next diagnostic — but the 0-height-collapse mechanism is now structurally removed.

## Files changed

- `main.js` — `createWindow()`: `show: false` → `show: true`; clarified the
  `ready-to-show` handler (window is already visible; hammer/watchdog are backstops
  only); removed the now-unused `_winShown` flag.
- `package.json` — version 2.8.6 → 2.8.7.
