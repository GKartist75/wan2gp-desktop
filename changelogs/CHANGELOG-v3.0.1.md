# Changelog — v3.0.1

**Topic:** Bug-fix release for the **v3.0.0 launch failure on legacy roaming installs**,
plus a safer, opt-in migration and **manual-only updates**. No layout change.

## 🐞 Bug: v3.0.0 wouldn't start for some users coming from an old roaming install

### Symptom
Users who upgraded from an older Wan2GP Desktop Launcher whose data lived in the
roaming AppData profile (`%APPDATA%\wan2gp-desktop`, or `...\wan2gp-desktop\Wan2GP`)
reported that **v3.0.0 showed no window at all** — not even a blank one. The only
thing that helped was **deleting `Roaming\wan2gp-desktop`** and reinstalling.

### Root cause
v3.0.0's one-time migration of the legacy AppData data dir ran
**synchronously, before the first window paint**. On a roaming-source install that
move could stall/throttle (AV scanning a large AppData tree, locked files handled
late, etc.), and because it blocked the pre-paint path, the renderer never got its
first frame — so the app appeared to "not start." The fact that removing the
roaming folder fixed it confirms the migration was the culprit: without the legacy
source, the migration was a no-op and the window painted normally.

### Fix (v3.0.1)
- **Migration is now deferred and opt-in.** The app starts first; the migration is
  offered as an explicit **"Migrate to new location"** dialog (triggered from the
  startup prompt, the dashboard `MODELS` banner, or Manage). Nothing blocks the
  first paint anymore, so legacy roaming users always get a window.
- **Full control over where data goes.** The dialog lets you choose the data dir,
  checkpoints, LoRAs, and outputs folders — preferred defaults pre-filled
  (`C:\Wan2GP` + `C:\Wan2GP-Models`), all editable. Nothing is hard-coded.
- **Clean move.** The move flattens the repo (no `C:\Wan2GP\Wan2GP` doubling),
  rewrites `wgp_config.json` model paths to the chosen locations, and removes the
  now-empty roaming wrapper. Locked files are skipped, not fatal.
- **Progress feedback.** A live progress bar shows on the slow copy-fallback path
  (cross-volume moves or files the FS refused to rename) so a big model folder
  never looks frozen.
- **Auto-update is now manual-only.** The Manage toggle is renamed
  **"Check for updates on launch"** and **defaults OFF**. `autoDownload` and
  `autoInstallOnAppQuit` are forced off in code, so **closing the app never
  installs an update** — only the explicit *Check for updates → Download → Install
  & Restart* flow does. (This also fixes the older "it still installs on close"
  behavior some users saw with previous versions.)

## What changed

- `lib/migrate.js` (NEW) — pure, testable migration helpers: `getDirSize`,
  `mergeDirContents` (instant rename on same volume, byte-accounted copy fallback
  with progress), `flattenRepo`, `rewriteModelPaths`.
- `main.js` — `runMigrationMove` now calls the module, flattens the doubled repo,
  rewrites config at the real (flat/nested) location, removes the empty roaming
  wrapper, and reports progress via `migration-progress`. `applyAutoUpdatePolicy`
  forces `autoDownload = false` + `autoInstallOnAppQuit = false`. Migration is no
  longer run synchronously at startup.
- `preload.js` — exposes `migrateChoose`, `onOpenMigration`, `onMigrationProgress`.
- `renderer/index.html` — "Migrate to new location" button (banner + installer +
  startup); migration folder-chooser modal with progress bar; "Check for updates on
  launch" toggle; MODELS banner now mentions the Wan2GP main folder too.
- `renderer/app.js` — migration modal controller, progress listener, config-path
  rewrite wiring.
- `renderer/style.css` — `.models-warn-actions`, `.modal-overlay`,
  `.migrate-progress` styles.
- `tests/migrate.test.js` (NEW) — simulates a legacy roaming install → 3.0.1 move
  (flatten, config rewrite, wrapper cleanup, copy-fallback progress). All pass.
- `package.json` — version 3.0.0 → 3.0.1.

## GPU kernel wheels (same set as v3.0.0, auto-installed per hardware)

The v3.0.1 installer ships the **current** attention/quant wheels matched to your
GPU, re-synced on every update. v3.0.1 pins:

| Wheel | Version (v3.0.1) | Notes |
|-------|------------------|-------|
| **Python** (uv) | `3.11.14` (RTX 20–50) / `3.10.9` (GTX 10) | venv interpreter |
| **PyTorch + CUDA** | `2.10.0` + CUDA 13.0 | base tensor + GPU runtime |
| **Triton** | `latest` (~3.7.1) | JIT compiler for custom kernels on Windows |
| **SageAttention** | `1.0.6` (RTX 20) / `2.2.0` (RTX 30–50) | fused attention |
| **Sparge Attention** | `0.1.0` | sparsity-aware attention |
| **Flash-Attention** | `2.8.3` | exact attention |
| **Nunchaku** | `1.2.1` | SVD/NF4/FP4 quantized runtime |
| **GGUF llama.cpp CUDA** | `1.0.11` | CUDA GGUF kernels (Stream-K) |
| **Lightx2v** | `0.0.2` | FP4 — RTX 50xx / sm120+ only |
| **bitsandbytes** | `0.49.2` | NF4 dequant |

Per-hardware set: RTX 20 → Sage 1.0.6 + Flash 2.8.3 + Nunchaku + GGUF 1.0.11.
RTX 30/40 → add Sparge 0.1.0 + Sage 2.2.0. RTX 50 → add Lightx2v 0.0.2.
All profiles also get bitsandbytes 0.49.2. GTX 10/16 stay on the legacy CUDA 12.8
stack. Versions track `setup_config.json` and update automatically.

## Verification

- `node --check main.js` / `preload.js` / `renderer/app.js` → syntax OK.
- `npm test` → 113 tests pass (incl. 4 new `tests/migrate.test.js` cases that
  simulate a legacy roaming → 3.0.1 migration: flat repo, config rewrite, wrapper
  cleanup, and the copy-fallback progress path).
- Built `Wan2GP-Desktop-Launcher-3.0.1-win-x64.exe`.

## Upgrade guidance

- **From v3.0.0:** just install v3.0.1 over it. No automatic data move — use the
  in-app **Migrate to new location** (Manage / `MODELS` banner) if you still keep
  models in AppData.
- **From an old roaming install (the v3.0.0-stuck case):** install v3.0.1. It will
  now open normally; then run **Migrate to new location** (or, if you prefer,
  uninstall → close → delete `Roaming\wan2gp-desktop` → reinstall).

## Credits

- **[DeepBeepMeep](https://github.com/deepbeepmeep)** — creator of
  [Wan2GP](https://github.com/deepbeepmeep/Wan2GP).
- **Tophness / Steve Jabz** — original Wan2GP install scripts the launcher's
  pipeline is built on.
- **All Wan2GP Desktop Launcher users** — thank you for the bug reports that
  surfaced the v3.0.0 launch failure.
