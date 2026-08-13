# v2.5.5 — Data-dir hardening, setup-timeout guard, dead-code removal

Three robustness fixes from a codebase review, plus a regression test for the
new data-dir validation. All main-process sources pass `node --check`; the full
suite is **50/50 green** (was 46/46).

## Fixed / Changed

- **`set-data-dir` now validates before it persists.** The IPC handler used to
  write whatever string the renderer sent straight to the override file and
  always returned `true` — a bad path (relative, traversal, or non-writable)
  would silently break the next launch, and the UI reported success either way.
  It now rejects non-string / empty / relative / `..` traversal / non-normalized
  paths, verifies the directory is actually writable (`fs.accessSync`), only
  then writes the canonical absolute path, and returns `false` on any failure.
  The guard was extracted into a pure, Electron-free module
  (`services/validate-data-dir.js`) so it can be unit-tested directly — 4 new
  tests cover accept / reject cases.
- **`runSetup` now has a hard timeout.** A hung `setup.py` (or a stuck child
  spawned by it) used to wedge the install/update handler with no overall
  deadline. `runSetup` now rejects after 30 minutes, logging a clear message and
  killing the child process tree (`killProcessTree` + `SIGKILL`). A `settled`
  flag prevents double-resolve and the timer is cleared on normal exit/error.
- **Removed the empty `services/director/` directory.** It shipped in the repo
  with zero files and was never imported — dead/abandoned scaffolding.

## Not touched

- `services/escape.js` was flagged as possibly-unused during review; it is in
  fact live (loaded via `<script src>` in `index.html` and used by the
  renderer). Left as-is.
- The `execSync`-in-IPC refactor and the deferred `C1`/`C4` items from the
  Windows-optimization plan remain out of scope (documented follow-ups).

Tests: 50/50 green.
