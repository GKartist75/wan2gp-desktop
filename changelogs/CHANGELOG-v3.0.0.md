# Changelog — v3.0.0

**Topic:** Major layout change. Wan2GP, its environment, and your settings now
live in a **self-contained, dedicated location** by default — `C:\Wan2GP` — and
model checkpoints/LoRAs are kept on a **separate** drive/folder (`C:\Wan2GP-Models`)
instead of inside the repo or your roaming AppData profile. This is a breaking
change for existing installs, so please **read the folder-change notice below**.

## ⚠️ BREAKING: install folders moved (please read)

The launcher no longer dumps everything into
`%APPDATA%\wan2gp-desktop\Wan2GP` (a roaming profile that syncs with your
account and can bloat unexpectedly). New defaults:

| What | Old default | New default (v3.0.0) |
|------|-------------|----------------------|
| Wan2GP repo + venv + `wgp_config.json` + launcher data | `%APPDATA%\wan2gp-desktop\Wan2GP\Wan2GP` | `C:\Wan2GP` |
| Model checkpoints | `<repo>\ckpts` (inside the repo) | `C:\Wan2GP-Models\ckpts` |
| LoRAs | `<repo>\loras` | `C:\Wan2GP-Models\loras` |
| Generated outputs | `<repo>\outputs` | `C:\Wan2GP-Models\outputs` |

Why: roaming AppData is a terrible place for tens–hundreds of GB of
checkpoints (it roams with your profile, can sync/backup unexpectedly, and
counts against profile quotas). A dedicated top-level folder on a fast drive is
faster, easier to back up, and keeps the repo clean.

### How to upgrade

**Preferred — uninstall, then install fresh:**
1. Open the launcher → **Manage** → **Uninstall** (keep or delete your existing
   models — they're in the old AppData path).
2. Close the launcher completely.
3. Run the new v3.0.0 `.exe` and install. It creates `C:\Wan2GP` fresh.
4. Point your models back at `C:\Wan2GP-Models\ckpts` (or copy your old
   checkpoints there).

**Also works — in-place update:** updating an existing v2.8.x install will
**auto-migrate** your old AppData data dir into `C:\Wan2GP` on first launch
(rollback-safe: the source is only removed after the move verifies on disk).
The old `Wan2GP\Wan2GP` doubling is preserved if you had it; only genuinely
fresh installs get the clean flat layout.

> Either path is supported. Uninstall-first is cleaner; update-in-place is
> fine if you just want the new build. Both end up at `C:\Wan2GP`.

## What changed

- **Self-contained default data dir.** `getDataDir()` now prefers a writable
  `C:\Wan2GP` (Windows) / `~/Wan2GP` (others) and only falls back to AppData
  when `C:\` is not writable (e.g. a per-machine Program-Files install without
  admin). One-time migration moves a legacy AppData install into `C:\Wan2GP`.
- **No more `Wan2GP\Wan2GP` doubling.** Fresh installs clone the repo directly
  at `C:\Wan2GP` (the `getRepoDir()` smart-fallback returns the nested
  `Wan2GP` subfolder only when it already exists from an older install).
- **Separate Models/LoRAs location.** Default checkpoints path is now
  `C:\Wan2GP-Models\ckpts` (note: `ckpts`, not `checkpoints`), LoRAs
  `C:\Wan2GP-Models\loras`, outputs `C:\Wan2GP-Models\outputs`. These are
  pre-filled on the install screen (editable) and written into `wgp_config.json`
  even when left at default, so big files never land in AppData.
- **Legacy repo-relative model paths upgraded.** `write-wgp-config` and
  `detect-model-folders` now treat a repo-relative/old-default model path as
  "no real choice" and upgrade it to the separate default, so migrated installs
  cleanly move off the repo.
- **User-facing warnings (3 layers).** The install screen shows the repo field
  (`C:\Wan2GP`) plus a caution note ("keep it OUT of AppData") and a highlighted
  ⚠ warning under Model Folders explaining that checkpoints/LoRAs are large and
  should live on a fast, non-system drive. The dashboard shows a dismissible
  `MODELS` banner if your configured model paths still resolve under the
  roaming AppData profile.
- **EPERM-on-reinstall fixed.** The clone step used to `renameSync` the live
  data dir into a temp stash — which caused
  `EPERM: rename 'C:\Wan2GP' -> …` and would have moved your config/models. It
  now clones into a temp dir and `mergeDir()`s the result into the target,
  preserving existing user files (models, `desktop-config.json`, `.electron`,
  `wgp_config.json`) and always replacing `.git` so a half-failed clone can't
  leave a broken repo. No live-dir rename, ever.
- **`boot.log` + all dotfolders** (`boot.log`, `.electron`, `.py-shim`,
  `.reinstall-backup`, `patches`) now colocate with the repo.

## Verification

- `node --check main.js` / `renderer/app.js` → syntax OK.
- `npm test` → 98 tests pass.
- Built `Wan2GP-Desktop-Launcher-3.0.0-win-x64.exe`; clean install verified on
  RTX 3080: repo at `C:\Wan2GP`, venv `C:\Wan2GP\env_uv`, checkpoints default
  `C:\Wan2GP-Models\ckpts`, no EPERM.

## Files changed

- `main.js` — `getDataDir()`/`getRepoDir()` self-contained layout + migration;
  `defaultModelsDir()` + `isRepoRelativePath(s)`; `write-wgp-config` /
  `detect-model-folders` separate-default upgrade; `mergeDir()` clone path;
  `get-install-paths` exposes `modelsDefault` + `appDataRoot`; dashboard
  `MODELS` banner.
- `renderer/app.js` / `renderer/index.html` / `renderer/style.css` — install
  screen model-folder defaults + warnings, dashboard banner, `path-hint-warn`
  style.
- `package.json` — version 2.8.9 → 3.0.0.
