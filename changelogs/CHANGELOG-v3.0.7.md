# Changelog — v3.0.7

**Topic:** Migration / model-folders reconciliation (#74) and a cross-device clone
fix (#76), plus a dashboard re-location UX overhaul. This is a **test-build** for
the migration work — use it to validate moving your Wan2GP install off roaming
AppData, but **back up your models first** (the migration tool is experimental).

> Bumped to **3.0.7** for the #74 test build (released 3.0.6 is untouched).

## What changed

### 1. #74 Bug 1 — `wgp_config.json` model paths now actually move (#74)
After a migration the checkpoints/LoRAs/outputs keys in `wgp_config.json` were
left pointing at the **old** (roaming) location. `runMigrationMove` now rewrites
`ckpts` / `loras` / `outputs` to the user's chosen destinations, so Wan2GP reads
models from the new drive immediately — no dead config.

### 2. #74 Bug 2 — don't force `C:\Wan2GP` when the install drive isn't C: (#74)
`defaultDataDir()` / `defaultModelsDir()` derived from a hardcoded `C:\`. They now
derive from the **launcher's own drive** (`path.parse(process.execPath).root`), so
a user whose launcher lives on `D:` gets `D:\Wan2GP` + `D:\Wan2GP-Models`, not a
stray `C:\Wan2GP` on first launch. No more unwanted empty folder creation on the
wrong drive.

### 3. #74 — no double `Wan2GP/Wan2GP` nesting
Legacy roaming path was `…\wan2gp-desktop\Wan2GP\Wan2GP`. `flattenRepo` now
unconditionally lifts the nested `Wan2GP` repo folder up to the chosen target, so
the new install is a clean flat `<target>\Wan2GP`, never `<target>\Wan2GP\Wan2GP`.

### 4. #76 — cross-device (EXDEV) clone/migrate no longer crashes
The clone and migrate copy paths used `fs.renameSync`, which throws `EXDEV` across
drives. `mergeDir` now falls back to `fs.cpSync` on rename failure, so cloning from
a different source drive (or migrating across drives) copies instead of erroring.

### 5. Dashboard re-location UX — pencil now moves, doesn't just open
- **Separate icons per row:** 📁 open-folder and ✏️ change (pencil) for the Wan2GP
  install row and for checkpoints/LoRAs/outputs rows.
- **Wan2GP pencil** opens the migration move modal and **moves** the whole install
  to the new location — no reinstall needed.
- **Model-folder pencil** asks *"Move existing files"* vs *"Just point to the new
  location"* (via a confirm dialog) before writing `wgp_config.json`.
- **Context-aware modal copy:** the migrate dialog used to always say *"Move Wan2GP
  out of AppData"* — even when you were already on `D:`. `fromRoaming` now keys off
  your **current** install location, so off-roaming installs get *"Move Wan2GP to a
  new location"* + your actual current path.
- **Startup re-pin guarded:** the launcher no longer creates the default data-dir
  folder on launch when a legacy roaming install already exists (kills the stray
  `C:\Wan2GP` on a `D:` launch).

### 6. Repo + runtime hygiene after a move
- `ensureRepoGit(target)` guarantees `.git` travels with the repo on move (it was
  previously only copied if present).
- `cleanupLegacyRuntime(legacy)` sweeps leftover launcher runtime from the **old**
  location after a move: `boot.log`, `<legacy>/.electron`, and a sibling `.electron`.
- Migration no longer forces a native startup popup — the in-launcher top warning
  banner + **"Migrate to new location"** button is the sole entry point.

## Tests
- `tests/migrate.test.js` +2 regression tests: `.git` travels with the move, and
  the old directory is cleaned of runtime leftovers.
- `npm test` → 123 pass.

## Verification
- Built `Wan2GP-Desktop-Launcher-3.0.7-win-x64.exe` (unsigned dev build) includes
  all of the above — used to validate old-roaming → drive-of-choice migration.
- **Not yet validated on-disk by the user** — this is the test build to confirm
  the migration behaves correctly before a public release.

## Upgrade / use
- **Recommended:** uninstall old, install v3.x fresh (see README §v3.0).
- **Experimental:** use the in-app **"Migrate to new location"** button / dashboard
  pencil to move an existing install. Back up models first; no guarantee.
