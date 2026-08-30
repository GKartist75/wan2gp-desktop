# Changelog

Newest first. Each version links to its full standalone changelog.

## v3.x

- **[v3.1.5](changelogs/CHANGELOG-v3.1.5.md)** — Full 93 MB Desktop update + sha512 verify (no blockmap delta) — fixes `3.1.3→3.1.4` `This app can't run` on auto-update.
- **[v3.1.4](changelogs/CHANGELOG-v3.1.4.md)** — Desktop minimal (BrowserView backgroundThrottling only, no synthetic keepalive), console mirrors Terminal, Desktop auto-check + 5h polling with green dot on both Dashboard and Manage, default autoUpdate on, H3 shim removed for minimal test.
- **[v3.1.3](changelogs/CHANGELOG-v3.1.3.md)** — Manage → Updates tab, Dashboard → Paths non-blocking migrate (no freeze/leftover, cross-drive wgp.py scan), H3 Desktop shim, hardening: atomic config writes, cache invalidation, GH_TOKEN leak fix, redirect limits, async GPU profile, bootstrap TOCTOU, mutating throw, keepFolders Set, async getDirSize, launch args dedupe.
- **[v3.1.2](changelogs/CHANGELOG-v3.1.2.md)** — Ships the OpenCode `spawn EINVAL` fix that v3.1.1 documented but missed. The v3.1.1 tag was cut 11 min before the fix commit `329c095`, so the released 3.1.1 EXE still contained the broken `shell:false` spawn path. v3.1.2 is built from `main` (`8bc15b4`) with `services/spawn-cmd.js` + corrected `main.js` call sites. OpenCode/Codex install + Start server now work on any Node location.
- **[v3.1.1](changelogs/CHANGELOG-v3.1.1.md)** — Fix: the guided **OpenCode / Codex** "Install via npm" button and OpenCode **Start server** failed on Windows. Two bugs, one root: a Node under the default `C:\Program Files\nodejs` (spaced path) was either split unquoted (`'C:\Program' is not recognized`) or, in a naive no-shell attempt, rejected as a `.cmd` (`spawn EINVAL`). New `services/spawn-cmd.js` routes `.cmd`/`.bat` through a **quoted shell** and real `.exe` through a **direct spawn** — fixing both at once on any Node location. 176 tests pass.
- **[v3.0.9](changelogs/CHANGELOG-v3.0.9.md)** — Install-location hardening + user-controlled uv wheel cache. Bare drive-root installs are now rejected with a confirm-to-fill `<drive>:\\Wan2GP` dialog; `safeMkdir` skips the root component (no `EPERM` on fresh drives); `UV_CACHE_DIR` is co-located with the install so the `Failed to hardlink` warning is gone on every drive; Manage → General adds Purge/Remove for the uv cache. 129 tests pass.
- **[v3.0.8](changelogs/CHANGELOG-v3.0.8.md)** — Cross-drive install cleanup hardened (#76 / #73). `moveDirAtomic` now removes the source unconditionally after a successful copy, so installing to a drive other than `%TEMP%` leaves a clean temp clone (no `readdir` error on files). Regression test added.
- **[v3.0.7](changelogs/CHANGELOG-v3.0.7.md)** — Migration & model-folders reconcile (#74) + cross-device clone fix (#76). The "Migrate to new location" flow now rewrites `wgp_config.json` so checkpoints/LoRAs/outputs point at the new drive, derives `C:\Wan2GP`/`…-Models` from the launcher's own drive, and flattens the legacy `Wan2GP\Wan2GP` nesting. Cross-drive clone/migrate no longer crashes. Per-row Open-folder + Pencil(move) icons; context-aware migrate copy. `.git` travels with the move; old-dir runtime swept. *Migration is experimental — back up models first.*
- **[v3.0.6](changelogs/CHANGELOG-v3.0.6.md)** — `setup_config.json` is now the explicit base. Installs exactly what upstream declares per GPU profile; the broken `sage.v220_cu13` wheel is substituted with the cu130-native, fp8-fixed `cu130.post6` wheel (now covers RTX 30/40/50).
- **[v3.0.5](changelogs/CHANGELOG-v3.0.5.md)** — SageAttention self-heal + `accelerate` check now also run in the Launch handler (idempotent), so updating to 3.0.5 alone fixes a broken wheel on next Launch — no manual Sync Kernels.
- **[v3.0.4](changelogs/CHANGELOG-v3.0.4.md)** — Fixes the v3.0.3 swap wheel's import crash (RTX 40/50): targets the CUDA-13.0-native, fp8-fixed `sageattention-2.2.0+cu130torch2.10.0andhigher.post6-cp310-abi3` wheel.
- **[v3.0.3](changelogs/CHANGELOG-v3.0.3.md)** — Critical hotfix for the v3.0.2 SageAttention swap (RTX 40/50): fixes broken release-URL prefix + Python-3.10-only wheel; installs `sageattention-2.2.0+cu128torch2.8.0-cp311-cp311`.
- **[v3.0.2](changelogs/CHANGELOG-v3.0.2.md)** — RTX 40/50 SageAttention fix + RTX 3080 `accelerate` fix + visible install progress (15s heartbeat, red SAGE banner).
- **[v3.0.1](changelogs/CHANGELOG-v3.0.1.md)** — Legacy roaming installs launch again; migration is opt-in + safe; auto-update is now manual-only (toggle defaults OFF).
- **[v3.0.0](changelogs/CHANGELOG-v3.0.0.md)** — Self-contained install layout (folders moved, breaking). Default `C:\Wan2GP` + separate default `C:\Wan2GP-Models` (user-selectable); latest GPU kernels auto-installed per hardware.

## v2.8.x

- **[v2.8.7](changelogs/CHANGELOG-v2.8.7.md)** — Blank-screen ROOT CAUSE fixed (nested `.screen` DOM regression).
- **[v2.8.6](changelogs/CHANGELOG-v2.8.6.md)** — Presentation-class blank screen, attempted (superseded by 2.8.7); stale data-dir override self-heal retained.
- **[v2.8.5](changelogs/CHANGELOG-v2.8.5.md)** — In-app update no longer blanks the launcher (releases handles before swap).
- **[v2.8.4](changelogs/CHANGELOG-v2.8.4.md)** — `boot.log` now lives in the launcher's own folder.
- **[v2.8.3](changelogs/CHANGELOG-v2.8.3.md)** — Black-screen regression fixed (window showed then vanished).
- **[v2.8.2](changelogs/CHANGELOG-v2.8.2.md)** — The launcher no longer black-screens (GPU-compositor first-present fix + watchdog).
- **[v2.8.1](changelogs/CHANGELOG-v2.8.1.md)** — AMD installs now match the AMD guide (and NF4 kernels get installed).
- **[v2.8.0](changelogs/CHANGELOG-v2.8.0.md)** — The queue keeps up with the queue; kernel wheels stay current.

## v2.6.x

- **[v2.6.1](changelogs/CHANGELOG-v2.6.1.md)** — The GUI stops disappearing (renderer-crash watchdog).
- **[v2.6.0](changelogs/CHANGELOG-v2.6.0.md)** — No more install/update/uninstall freezes; VAE on Auto; deeper hardening.
