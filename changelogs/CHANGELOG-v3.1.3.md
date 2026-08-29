# v3.1.3

## Manage → Updates + Dashboard → Paths polish + hardening

**Manage → Updates tab** — Wan2GP core and Desktop Launcher updates also available in **Manage** (same IPCs as Dashboard). Status mirrors the Dashboard banner (`Checking…` → `vX.Y.Z available` → `Downloading` → `Up to date`).

**Dashboard → Paths migrate** — non-blocking `mergeDirContentsAsync` / `reconcileModelFoldersAsync` with `setImmediate` yields and `fsp.cp` threadpool, plus recursive directory merge (no leftover `ckpts`/`loras` when target exists) and async `getDirSizeAsync`. Cross-drive scan now prefers an existing install with `wgp.py` (C/D/E/F/G) over an empty same-drive pref, so unpacked dev builds on `E:` correctly see `C:\Wan2GP`.

**H3 shim** — `renderer/bv-shim.js` preload at `document_start` shims missing `Element/ShadowRoot.prototype.getElementById` → `querySelector`, fixing `root(...).getElementById is not a function` spam in Desktop (BrowserView) on stale `Blocks-*` JS.

**Hardening:**
- **Atomic writes** — `atomicWriteFile` (tmp+rename) for `desktop-config.json` + `DATA_DIR_OVERRIDE` pin
- **Cache invalidation** — `invalidateDefaultDataDirCache()` on set/reset/migrate
- **GH_TOKEN leak** — feed token only via `autoUpdater.setFeedURL`, no `process.env.GH_TOKEN`
- **Redirect limits** — `fetchUrl`/`downloadFile` capped at 5 redirects
- **Async GPU profile** — `get-hardware-profile` via `autoTune.detectGpuInfo` (no blocking `execSync`)
- **Bootstrap TOCTOU** — `wan2gp-bootstrap-<pid>-<rand>.py` in app-owned `getDataDir()` (fallback `os.tmpdir()`)
- **Mutating contract** — `mutating()` now `throw`s on concurrent op (was silent `{error}`)
- **keepFolders** — `Set` lowercased (robust on Linux)
- **Launch dedupe** — `buildCommonLaunchArgs()` single source for `--server-port/name/share/gpu/advanced/multiple-images/coeff`

176 tests pass.
