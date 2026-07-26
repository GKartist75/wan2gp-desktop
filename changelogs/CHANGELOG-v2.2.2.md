# Wan2GP Desktop Launcher v2.2.2

**Bugfix and quality release** — fixes the green dot update indicator (git state tracking),
replaces unreliable `git merge --ff-only` with `git reset --hard`, secures IPC handlers
against command injection, converts sync subprocess calls to async spawn, and tightens
the UI layout for more console space.

## Bugs Fixed

- **Green dot persisted after update** (`update-dot` stuck after "Update Wan2GP") — the
  git cache was returning stale commit hashes, and `git merge --ff-only` incorrectly
  reported "Already up to date." while leaving HEAD unchanged. Fixed by:
  - Adding `invalidateGitCache()` after install/update/reinstall operations
  - Replacing `git merge --ff-only` with `git fetch --prune` + `git reset --hard origin/<branch>`
  - Diagnosing branch and remote URL at update time

- **Green dot lingered when GitHub API was unreachable** — `loadWangpChangelog()` returned
  early on API errors without clearing the `has-update` class or removing the dot element.
  Now cleans up unconditionally.

- **Terminal div nested inside Desktop App card** (`index.html`) — `.dash-term-card` was
  a child of the changelog card instead of a sibling, breaking flex layout.

- **`onWangpExit` registered twice** — the callback was added both at module scope and
  again inside `DOMContentLoaded`, causing duplicate handler execution.

- **Back/Forward navigation buttons permanently disabled** — BrowserView history state
  was never pushed to the renderer. Added `bvNavState` IPC + `sendNavState()` after every
  `goBack()`/`goForward()`.

- **`_monitorInterval` never cleared on explicit stop** — leaked timer kept polling after
  the user clicked Stop.

- **`escapeBatCmdArg` incorrectly escaped `!`** — the `.bat` file never uses
  `setlocal enabledelayedexpansion`, so `!` should not be escaped.

## Security

- **`check-package` used `execSync` with shell interpolation** — replaced with
  `spawn(py, [helperPath, modName])` using an argument array. Package whitelist is now
  derived from the single `ALL_PACKAGES` source of truth.

- **`ensureInsideRepo` bypassable via symlinks/junctions** — added `fs.realpathSync()`
  before path comparison.

- **`DATA_DIR_OVERRIDE` unsanitized** — rejects non-absolute, non-normalized, or `..`-
  containing paths.

- **GPU cache stored empty/error results** — now only caches when vendor is detected.

## Architecture

- **`get-system-metrics` blocked the main process every 2 seconds** — converted
  `execSync('nvidia-smi')` to async `spawn` via `queryGpuMetricsAsync()`, with
  last-value fallback when nvidia-smi fails.

- **Duplicate package lists (`PACKAGES_TO_CHECK` + `_CHECK_PKG_WHITELIST`)** — unified
  into single `ALL_PACKAGES` array to prevent drift.

- **GPU detection ran `nvidia-smi` twice on Windows** — removed redundant code in
  `detect-gpu` handler (uses `getGpuInfo()` cache).

- **Git info lookups blocked IPC on every dashboard refresh** — added `_gitCache` with
  30s TTL.

- **Module-level GPU config read `app.getPath()` before `app.whenReady()`** — falls
  back to override file path when `userData` path is unavailable.

- **DevTools picker menu rebuilt on every F12 press** — now cached.

- **`findWan2gpPid` used deprecated `wmic`** — replaced with `Get-CimInstance`.

## Code Quality

- Added `"use strict"` to `main.js`, `preload.js`, `renderer/app.js`, `renderer/term.js`.
- Removed inline `require('child_process')` calls (5 occurrences).
- Added platform guards for `open-task-manager` and `create-desktop-shortcut` (Windows-only).
- Post-install phase now sends `setup-phase` event so UI shows "Post-install: verifying
  dependencies" before the final "Installation complete!" banner.

## UI

- **Launch buttons shrunk** — padding `16px 20px` → `8px 12px`, icons `20px` → `14px`,
  action items `10px 12px` → `6px 8px` — freeing vertical space for the console terminal.
- **Console max-height** increased from `35vh` to `50vh`.
- **Column gap** reduced from `10px` to `6px`.
