# Changelog — v2.8.7

**Topic:** Blank-screen ROOT CAUSE fix — the `#installer` (and any later-added)
`.screen` was accidentally nested *inside* `#dashboard` during the
gallery/plugin-tab refactor, so it inherited `#dashboard`'s `display:none` and
collapsed to 0×0. This is the real cause behind issues #39, #45, and every 2.8.x
blank report.

## Root cause (found by measuring the live renderer, not by guessing)

The launcher shows exactly one `.screen` at a time by toggling a single
`.active` class (`show(id)` in `app.js` just does
`document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); $(id).classList.add('active')`).

The CSS makes the active screen fill the window:

```css
#app    { height: 100vh; display: flex; flex-direction: column; position: relative; }
.screen { display: none; position: absolute; inset: 0; }   /* fills #app when .active */
.screen.active { display: flex; }
```

That works **only if every `.screen` is a direct child (sibling) of `#app`**.
But after the gallery/plugin-tab refactor, `#installer` (and the floating-terminal
block) were placed *inside* `#dashboard`'s closing `</div>` — so `#installer`
became a **child of `#dashboard`** instead of a sibling.

Consequence: whenever `#installer` is the active screen, `#dashboard` is
**not** `.active`, so `#dashboard` is `display:none`. A `display:none` element
hides its entire subtree — so the nested `#installer`, even with its own
`.active`/`display:flex`, is never laid out. `getBoundingClientRect()` returns
**0×0**. The window shows only the dark `body` background = the classic
"blank screen with title bar only".

This was confirmed empirically with a `content-size` diagnostic written to
`boot.log`:

```
BROKEN (before fix):
  activeId:"installer", parentId:"dashboard", offsetParentId:null,
  scrW:0, scrH:0

FIXED (after fix):
  activeId:"installer", parentId:"app", offsetParentId:"app",
  scrW:1265, scrH:761
```

It was **never** GPU-specific and **never** about the `BrowserWindow` `show`
path (that pattern is unchanged since v2.0.0 and is correct). It was a pure
DOM-nesting regression introduced *after* 2.6.0 (2.6.0 has `#installer` as a
correct sibling of `#dashboard`).

## Why prior 2.8.x fixes were band-aids (and why they failed)

- 2.8.2/2.8.3: changed the *show timing* — didn't touch the DOM structure.
- 2.8.5/2.8.6: added `invalidate()` + resize-nudge "present hammer" keyed on the
  (wrong) theory that the compositor dropped a committed frame. A 0×0 element
  cannot be re-presented into something visible, so it did nothing for reporters.
- 2.8.7 (first attempt): `show: true` — also wrong; the window was already
  showing, the screens were just 0×0 inside a hidden parent.

None of 2.8.2–2.8.6 addressed the actual bug; they were iterations on a
misdiagnosis.

## Fix (v2.8.7)

Restructure `renderer/index.html` so `#installer` (and the floating-terminal
block) are **siblings of `#dashboard`**, both direct children of `#app` — exactly
as they were in 2.6.0. With that, toggling `.active` on a screen that is its own
top-level child of `#app` lays it out at full window size.

Supporting / clean-up changes:
- `renderer/style.css` + inline `<style>` in `index.html`: `.screen` uses
  `position:absolute; inset:0` (fills `#app`, independent of any percentage-height
  chain) — robust against future reflow quirks.
- `main.js`: removed the 1px `setSize` resize-nudge in `_forcePresent()`. It was a
  backstop for the wrong theory and caused a visible window "shake" on the now
  correctly-laid-out `position:absolute` screens. `focus()` + `invalidate()` are
  kept as harmless backstops.
- The 8 s blank-screen watchdog is retained (surfaces a GPU-off diagnostic if any
  stack still fails to paint).

## Verification

- Local (RTX 3080): unpacked 2.8.7 launches; `content-size` reports the active
  screen at full window size (`scrW:1265, scrH:761`, `parentId:"app"`).
- **Clean reinstall test** (AppData wiped + stale data-dir pin injected): window
  renders from a totally fresh state; the stale-pin self-heal rewrote the dead
  override to the valid path.
- **Full user flow confirmed**: installer renders, install runs, Wan2GP opens —
  no blank, no shake.
- `node --check main.js` passes.

## Files changed

- `renderer/index.html` — moved `#installer` (+ floating-terminal block) out of
  `#dashboard` to be siblings under `#app`; inline `<style>` `.screen` rule uses
  `position:absolute; inset:0`.
- `renderer/style.css` — `.screen` uses `position:absolute; inset:0`.
- `main.js` — removed resize-nudge from `_forcePresent()` (kills the shake);
  retained `focus()` + `invalidate()` + watchdog as backstops.
- `package.json` — version 2.8.6 → 2.8.7.
