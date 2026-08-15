# v2.6.0 — No more install/update freezes, VAE on Auto, deeper hardening

Installing, updating, and uninstalling never freeze the app anymore (the
minute-long main-process stalls are gone), Auto-Tune now recommends the VAE
config **Auto** for every hardware tier, prerequisite installs actually work
again, and a batch of shell-injection and path-safety holes were closed.
51 tests green.

## Faster — the app never freezes during setup anymore

- **Installs, updates, and uninstalls no longer lock up the whole app.**
  `installPython` (up to 4 minutes of `uv python install`), the git clone,
  `git fetch`/`reset`, `git diff`, the pip dependency pins, the xcopy/cp
  backups, and the environment removals all ran as *blocking* `execSync`
  calls in the main process — every one of them froze the window for the
  duration (up to minutes during a clone or an AV-throttled uninstall). All
  of these now run async through one argv-based helper, so the UI stays
  responsive while setup does its work.
- **Uninstall/reinstall stalls eliminated.** The removal engine used
  `Atomics.wait` busy-loops (up to ~10s per wait) while a killed Wan2GP
  process released its directory handles; those are now real async sleeps,
  and the per-PID `tasklist` probes run off the main thread.
- **Auto-Tune probes run in parallel.** The two `nvidia-smi` calls in
  detection are concurrent, GPU/CUDA import checks are memoized per
  interpreter, and the multi-GPU list reports every card (no more
  `head -1` truncation).

## Auto-Tune — VAE is now always **Auto** (recommended)

- `vae_config` is recommended as **Auto** for every VRAM tier (previously
  `1` on high, `3` on tight). Auto defers the tiling decision to Wan2GP's
  runtime, which picks from the *real* memory headroom at generation time —
  a "high" card busy decoding a long video can still OOM on untiled VAE,
  while a "tight" card generating a small image wastes time on aggressive
  tiling. The dropdown stays editable for users who know better.
- The failsafe (P5) path and the no-CUDA fallback also use Auto instead of
  aggressive tiling.

## Fixed — real bugs, verified against the code

- **Prerequisite installs (Git / Python / Miniconda) were completely dead** —
  they called a `downloadFile` helper that existed nowhere and an
  `asyncExec` scoped to another handler; every click failed with a swallowed
  `ReferenceError`. The helpers are now module-level and redirect-aware.
- **`Reset data directory` orphaned your install.** The Electron userData
  redirect nested the app under `<dataDir>/.electron/Wan2GP/.electron/Wan2GP`,
  hiding the real install; the original path is now captured before the
  redirect.
- **Failed launches no longer leak an orphaned server.** If the port never
  came up, the spawned python kept running and held the port; it is now
  killed with its whole process tree.
- **Double exit events/notifications** in browser/webview mode (the port
  monitor now only runs in terminal mode), and a stale port that made the
  LED/tray say "running" after the in-app server closed.
- **`Ctrl+\`` opened and instantly closed the console** — two duplicate
  keydown handlers fired on the same keypress; the duplicate is removed.
- **Fresh installs were shown as "Update instead of fresh install…"** with
  the clone task marked done before it ran; the mode handling is explicit
  now.
- **"Open in Chrome (no GPU)" relaunched WITH GPU** on re-open; it stays
  no-GPU now.
- **Renderer bug batch:** the dashboard console flushed empty after install,
  stale spec-dot states after re-checks, NumPy/Tokenizers missing from the
  update check, crash guards on changelog/status paths, `serverMode` not
  reset on webview close, error-styled normal stops, RAM 0 rendered as "—",
  leaked object URLs on log export, and dead code removed.
- **Settings repair:** files with a UTF-8 BOM were rejected as invalid JSON,
  and the nested-path repair was case-sensitive (lowercase `./wan2gp/...`
  slipped past the issue-#18 fix on Windows). Both fixed.

## Hardened

- **Shell injection closed in launch paths.** Browser launches validated
  URLs with a `startsWith('http')` check only — a value like
  `http://x && calc` flowed into shell strings. URLs are now strictly
  validated (scheme + parse + metacharacter rejection) and re-serialized.
- **Pip option injection closed.** `install/upgrade/uninstall-package`
  accepted arbitrary pip option strings (e.g. `-r https://evil/...`); every
  package name is now checked against the known package list.
- **`manage-delete` containment.** The environment deletion path is verified
  to resolve inside the repo before `rm -rf` (the uninstall-env guard was
  already there; this one was missing).
- **Mutation guard.** Install/reinstall/update/uninstall/launch are now
  serialized — two rapid IPC calls previously interleaved (double
  `setup.py` spawns clobbered the shared process handle, a second launch
  could spawn a second server on the same port). The second call is
  rejected with a clear message instead.
- **`fetchUrl` hardened** (redirects, stream-error handling, 16 MB cap) and
  the update path validates the git branch name before it reaches `git`.

## Release tooling

- **Release scripts now build BEFORE pushing the version tag.** Previously a
  failed build still pushed `vX.Y.Z`, bricking every re-run; and the
  release-upload parsing used `python3` (missing in stock git-bash on
  Windows).
- **SignPath hook hardened:** per-request timeouts with retry/backoff, the
  artifact download no longer sends the Bearer token (presigned S3/Azure
  URLs reject it — every signed download previously failed), and the
  downloaded bytes are validated as a real PE (`MZ` header) before
  replacing the exe.
- **CI:** the POSIX external-terminal smoke test now runs on every PR and
  push to `main`.

Tests: 51/51 green (was 46) — 5 new: `recommend(null)` fallback, `apply()`
write/no-op/atomic, BOM repair, case-insensitive nested repair, plus the
signpath happy path updated for PE validation.
