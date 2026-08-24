# Wan2GP Desktop Launcher v3.0.9

Install-location hardening + a user-controlled uv wheel cache.

## What changed
- **Install into a folder, never a bare drive root.** Picking a drive root
  (e.g. `D:\`) now pops a confirm: install into `<drive>:\Wan2GP` instead?
  Accept → auto-fills `X:\Wan2GP` (drive-agnostic — not hardcoded to `C:` or
  `D:`). The Install button also shows a cross + "pick a folder" message when a
  root is selected, and the pre-flight / set-data-dir guards reject a bare root
  outright, so you can no longer start an install on a drive root (which fails
  with `EPERM` on a fresh/empty disk where only SYSTEM can write the root). The
  old `(e.g. D:\Wan2GP)` hint text was removed.
- **`safeMkdir` hardened.** It never tries to "create" a drive root
  (`fs.mkdirSync('D:\')` throws `EPERM` on Windows); the root component is
  skipped, so cloning/installing onto a fresh drive no longer trips that error.
- **Co-located uv cache kills the hardlink warning.** The installer now sets
  `UV_CACHE_DIR` to `<install>/.uv-cache` for both install and in-app update.
  Cache and venv live on the same filesystem, so uv hardlinks wheels instead of
  falling back to a full copy — the `Failed to hardlink files; falling back to
  full copy` warning is gone on every drive (verified clean on both
  `C:\Wan2GP` and `D:\Wan2GP`). The cache is also self-contained, no longer
  shared with the global `AppData\Local\uv\cache`, matching the "keep multi-GB
  data out of roaming AppData" rule.
- **Manage → General: uv Wheel Cache control.** New section shows live cache
  size + path and offers **Purge unused** (`uv cache prune` on the co-located
  cache) and **Remove cache** (deletes the `.uv-cache` folder — the real
  space-reclaimer, since an in-use cache can't be pruned smaller). Both use the
  resolved `uv` binary with `--cache-dir`, so they no longer fail with
  "uv not found".
- **Dropped the silent post-install `uv cache prune`.** It reported "No unused
  entries found" because the cache is hardlinked to the live `env_uv` and
  couldn't shrink — it only added noise. Cache cleanup is now the explicit
  Manage control above.
- **Tests:** added `tests/safemkdir.test.js` (3 cases) + renderer-HTML
  assertions for the new uv-cache UI ids; suite now **129 passing** (was 127).

## Upgrade
Install over 3.0.8 (or any 3.0.x). Non-disruptive. Existing installs keep their
cache; use Manage → General to inspect or clear it.

## Note
This release does not change the on-disk folder layout for existing installs
(`C:\Wan2GP` + `C:\Wan2GP-Models` defaults remain user-selectable). The
`UV_CACHE_DIR` change only affects where uv stores its download warehouse going
forward.
