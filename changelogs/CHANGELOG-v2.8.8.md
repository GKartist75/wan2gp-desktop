# Changelog — v2.8.8

**Topic:** Fix for issue #56 — the embedded Wan2GP view was reloaded every time
the launcher window was restored after being away (hidden / covered / minimized)
for ≥30 s while a generation was running. The reload discarded all in-page input
(prompt, reference media, settings), so returning to a finished generation left
the user with an empty form.

## Root cause

The v2.8.0 "queue re-sync" feature (`maybeResyncEmbeddedView` in `main.js`)
reloaded the embedded page on `show` / `restore` whenever the window had been
away for ≥30 s **and** a queue event had been seen while it was hidden.

The intent was to heal a page that had frozen during the window's absence —
but the *other* half of the v2.8.0 work (`backgroundThrottling: false` on the
BrowserView) had already solved that: the embedded page keeps receiving queue
updates while hidden, so it never falls behind. The re-sync therefore fired on
the healthy, fully-synced case and only produced the data loss.

Why it differed between monitors: the hidden stamp was set **only** by
`hide` / `minimize` events — never by occlusion or `blur`. A window left
visible-but-unfocused on a second monitor never set the stamp, so the reload
never triggered there; a window actually hidden behind another on the primary
monitor did.

## Fix (v2.8.8)

- Removed `maybeResyncEmbeddedView()` and its `show` / `hide` / `minimize` /
  `restore` bindings. The window no longer reloads the embedded Wan2GP page on
  focus.
- Removed the now-dead queue-activity stamp (`_lastQueueActivityAt`,
  `_activityState`, `stampQueueActivity`) that only fed the resync gate.
- **Kept the crash-watchdog** (`watchRenderer`): it only reloads when the
  renderer has actually died, so there is no good state to lose. This is the
  correct, loss-averse recovery path.
- Corrected the README v2.8.0 note to state the page is never auto-reloaded.

This aligns the launcher with Wan2GP's own "save, don't refresh" failsafe
(`save_queue_if_crash`): on an error Wan2GP saves the queue to a `.zip` and
never reloads the page.

## Verification

- `node --check main.js` / `preload.js` → syntax OK.
- `npm run test` → 82/82 pass.
- Built `Wan2GP-Desktop-Launcher-2.8.8-win-x64.exe`; user confirmed: window no
  longer reloads on focus after generation, inputs preserved.

## Files changed

- `main.js` — removed `maybeResyncEmbeddedView()` + handlers + dead stamp.
- `README.md` — corrected v2.8.0 note.
- `package.json` — version 2.8.7 → 2.8.8.
