# Changelog — v3.0.0

**Topic:** Major layout change. Wan2GP, its environment, and your settings now
live in a **self-contained, dedicated location** by default — `C:\Wan2GP` — and
model checkpoints/LoRAs are kept on a **separate** drive/folder (`C:\Wan2GP-Models`, also the default)
instead of inside the repo or your roaming AppData profile. Both are pre-filled suggestions — you can choose any drive/folder at install. This is a breaking
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
- **Latest GPU kernels installed per hardware (with versions).** The installer
  reads Wan2GP's `setup_config.json` and pulls the **current** attention/quant
  wheels matched to your GPU into `C:\Wan2GP\env_uv`, re-syncing them on every
  update. v3.0.0 pins: Python 3.11.14 (RTX 20–50) / 3.10.9 (GTX 10), PyTorch
  2.10.0 + CUDA 13.0, Triton (latest), SageAttention 1.0.6 (RTX 20) / 2.2.0
  (RTX 30–50), Sparge 0.1.0, Flash-Attention 2.8.3, Nunchaku 1.2.1, GGUF
  llama.cpp CUDA 1.0.11, Lightx2v 0.0.2 (RTX 50 FP4), bitsandbytes 0.49.2 (NF4).
  Per-hardware set: RTX 20 → Sage 1.0.6 + Flash + Nunchaku + GGUF; RTX 30/40 add
  Sparge + Sage 2.2.0; RTX 50 add Lightx2v. Documented in README + infographic.
- **`boot.log` + all dotfolders** (`boot.log`, `.electron`, `.py-shim`,
  `.reinstall-backup`, `patches`) now colocate with the repo.

## Also includes (finished in the 2.6 – 2.8.7 line, all in v3.0)

v3.0 builds on top of every recent fix — none of these regressed:

- **No more black/blank screen.** The nested-`.screen` DOM regression (title-bar-only
  blank) was root-caused and fixed in **v2.8.7**; the GPU-compositor first-present
  black-screen (`%USERPROFILE%\.wan2gp-desktop-gpu-off` override) in **v2.8.2/2.8.3**;
  and the in-app-update partial-`app.asar` blank in **v2.8.5**.
- **Clearer HTML structure.** `#installer` / `#dashboard` are siblings under `#app`
  with `.screen{position:absolute;inset:0}` (the v2.8.7 fix) — this is what ended
  the 0×0 collapse.
- **GPU kernel-wheel sync.** GGUF llama.cpp CUDA, Nunchaku, Flash, Sage/Sparge,
  bitsandbytes stay current with `setup_config.json` on every install/update
  (from **v2.8.0** + the v2.8.1 NF4/bnb addition).
- **Clean Desktop ↔ Dashboard switching.** The embedded Wan2GP view no longer
  reloads on window restore (crash-watchdog only), so switching modes never drops
  your in-page input (hardened across **v2.6 – 2.8.x**).

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
