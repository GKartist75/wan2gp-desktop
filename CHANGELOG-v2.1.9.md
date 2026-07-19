# Wan2GP Desktop Launcher v2.1.9

**Feature + security + quality release** — new **Auto-Tune** hardware detection & settings
optimizer, **Xet Storage** integration for faster model downloads, live progress bars in the
console, alongside critical security hardening and deep code quality improvements.

## New

- **Auto-Tune tab** (Manage → Auto-Tune) — detects your GPU, CUDA, VRAM, attention-kernel
  support (triton / flash_attn / sageattention), and recommends optimal `wgp_config.json`
  settings (attention backend, compile mode, memory profile, hierarchy). One-click **Detect**
  scans your system; one-click **Apply** writes the recommendation to disk. Detection also
  runs automatically during installation.
- **Xet Storage (hf_xet)** — new UI section in Manage settings to install/uninstall the
  `hf_xet` package (delta-compression for HuggingFace model downloads, 2–10× faster).
  Auto-installed during initial setup. Status indicator shows installed/not-installed.
- **Live progress bars in the console** — the bootstrap script patches Python's stdout/stderr
  to fake a TTY, so `tqdm` / rich progress bars render inline in the launcher console during
  model downloads and kernel builds. Environment variables `TQDM_DISABLE`, `TQDM_MININTERVAL`,
  `HF_HUB_DISABLE_PROGRESS_BARS` are forced off to surface progress that was previously hidden.
- **Real CPU utilization metric** — the topbar sparkline now shows live CPU usage (deltas
  between successive samples) instead of the boot-cumulative average, matching what Task
  Manager reports.
- **GPU detection cache** — `nvidia-smi` results are cached for 30 seconds, eliminating
  redundant subprocess calls across the GPU detection and hardware-defaults handlers.

## Security (critical)

- **Shell injection fix** — bat-file construction in the `launch` and `create-desktop-shortcut`
  handlers now escapes all shell metacharacters (`^`, `&`, `|`, `>`, `<`, `%`, `"`) via
  `escapeBat()` and `escapeBatCmdArg()` helpers, preventing crafted env-names or launch args
  from injecting arbitrary commands.
- **Path traversal fix** — `manage-delete` and `uninstall-env` now validate that the resolved
  environment path is inside the repo directory via `ensureInsideRepo()`, blocking attempts to
  delete arbitrary directories via `../` sequences.
- **Code injection fix** — `check-package` uses a strict whitelist (18 known packages) and
  writes a Python helper script to disk instead of constructing inline `python -c "..."` code
  from user-supplied package names.
- **URL validation fix** — `open-external` now parses the URL with `new URL()` and rejects any
  protocol other than `http:` or `https:`, preventing `file:`, `javascript:`, or custom
  protocol-handler abuse.

## Other fixes

- **Auto-Tune `detect()` repoDir bug** — the `detect()` function now takes `repoDir` as a
  parameter; it was calling `getActiveEnv()` without it, causing `envs.json` to read from CWD
  instead of the repo directory, silently disabling all Python-import checks (triton,
  flash_attn, sageattention).
- **Empty catch blocks → structured logging** — added `logError(context, err)` helper and
  applied it to critical paths (config loading, data-dir init, GPU detection, settings write),
  replacing silent `catch {}` with contextual `console.error()`.
- **Data-dir init timing** — `app.setPath('userData', ...)` moved from module-level execution
  (which can fail before `app.whenReady()`) into the `app.whenReady()` callback.
- **killProcessTree Linux fix** — replaced `process.kill(-pid, 'SIGKILL')` (broken since
  Node's default `spawn` doesn't set process-group leadership) with `pkill -P <pid>` to kill
  children, then `process.kill(pid, 'SIGKILL')` for the parent.
- **Terminal .bat timeout** — the launch `.bat` and desktop-shortcut `.bat` scripts now have
  a 120-second retry counter (60 × 2 s); if the server doesn't respond within 2 minutes,
  the window shows an error and pauses instead of hanging indefinitely.
- **Settings panel memory leak** — `openSettings()` reassigned `onchange` handlers on every
  open; moved to `initSettingsToggles()` with `addEventListener` registered once.
- **`var` → `const`/`let`** — ~50 variable declarations in `renderer/app.js` changed from
  function-scoped `var` to block-scoped `const`/`let` to prevent hoisting bugs.
- **Duplicate CSS selectors** — removed duplicate `.topbar-right`, `.args-table td:first-child`,
  and `.args-table td:last-child` declarations from `style.css`.
- **Stale release version** — `package.json` `release:win` script updated from 2.1.5 → 2.1.9.

## v2.1.8 fixes carried forward

- Grey field on terminal close
- Wan2GP always visible in floating-terminal mode
- Floating console resizes with its window
- White flash / freeze when switching to the floating terminal
- Double log replay
- "Back to menu" left Wan2GP on top of the dashboard
- Browser-mode Stop/Restart UI shared with External Terminal mode

## Notes

- The bootstrap script (`wan2gp-bootstrap.py`, written to `os.tmpdir()`) patches Python's
  streams so that `tqdm` progress bars are visible through the piped stdout/stderr of the
  launcher. It also wraps target scripts via `runpy.run_path()` so they can be launched from
  inside Electron's `app.asar` virtual filesystem.
- The desktop shortcut (`Launch Wan2GP.bat`) now includes the same server-port and launch-args
  handling as the in-app launch paths.
