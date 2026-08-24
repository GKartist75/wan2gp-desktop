# Wan2GP Desktop Launcher v3.0.8

Maintenance fix hardening the cross-drive install path (issues #76 / #73).

## What changed
- **#76 / #73 — EXDEV install cleanup hardened.** Installing Wan2GP to a drive
  different from `%TEMP%` clones into the system temp folder, then merges into
  the target. On a cross-drive move `rename` throws `EXDEV` and the code falls
  back to a copy. In 3.0.7 the post-copy cleanup gated `fs.rmSync(src)` on
  `readdirSync(src)`, which *throws on a plain file path* — so the source file
  could be left behind (only swept later by the caller) and files could trip a
  readdir error. `moveDirAtomic` now removes the source unconditionally after a
  successful copy, so cross-drive installs leave a clean temp clone and never
  hit that edge.
- Added a regression test that simulates `EXDEV` and proves `mergeDir` merges
  the install clone cross-drive with no throw and a fully emptied source.
- 124 tests pass.

## Note on #76 / #73 status
The original `EXDEV` *failure* (install aborting entirely) was already fixed in
**v3.0.7** via the `moveDirAtomic` rename→copy fallback. v3.0.8 hardens the
cleanup edge of that same path; the user-facing symptom from #76/#73 is
resolved from 3.0.7 onward. No migration or config behavior changed.

## Upgrade
Install over 3.0.7 (or any 3.0.x). Non-disruptive — nothing auto-migrates.

Closes nothing new; re-confirms #76 / #73 fixed.
