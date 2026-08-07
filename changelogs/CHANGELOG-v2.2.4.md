# Wan2GP Desktop Launcher v2.2.4

**Uninstall, progress bars, and install-flow hardening** — a first-class Uninstall
feature (with the option to keep your checkpoints, LoRAs, and outputs), the invisible
console progress bar fixed, a robust removal engine that survives locked files and
antivirus scans, uv-managed Python auto-repair, live install progress, and UTF-8
console output everywhere.

## New Features

- **Uninstall Wan2GP** — Manage → General → *Uninstall Wan2GP*. Always asks what to
  keep: **Uninstall (keep my files)**, **Uninstall (delete everything)**, or **Cancel**.
  Keeping files preserves your checkpoints, LoRAs, and output folders in place —
  nothing is moved or backed up, and a later reinstall reuses them automatically.
  Folders outside the installation (custom `C:\MODELS\...` paths) are never touched.
- **Launch buttons gate on install state** — after uninstalling (or if Wan2GP is
  missing), all launch buttons are disabled with a *"Wan2GP is not installed — restart
  the Desktop launcher to install"* hint. The state re-checks on every dashboard
  refresh, so it catches manual deletions too.

## Fixes

- **Invisible console progress bar** — the launcher set `TQDM_DISABLE=0` intending to
  force bars on, but tqdm treats the string `"0"` as truthy and disabled every bar
  (`Generating:`/`Denoising:` progress in the console). The variable is gone; per-step
  progress now streams live again.
- **Uninstall `EPERM` failures** — uninstalling while Wan2GP was running (or right
  after install, while antivirus scans the fresh venv) failed with
  *"Permission denied"*. The removal engine now kills all Wan2GP processes and *waits*
  for Windows to release their directory handles, deletes children before the root,
  defers the large `env_uv` folder until last, retries for up to 20 seconds per item,
  re-sweeps for escaped processes, and reports actionable guidance (close terminals /
  antivirus exclusion) instead of a bare error.
- **"Reinstall (fresh)" silently kept the old install** — the 3-option dialog
  (*Reinstall (fresh) / Update & keep files / Use existing*) used a `rmdir` whose
  failure was swallowed, so the old tree survived and the fresh clone broke. It now
  uses the same robust removal engine and aborts with a clear message if removal fails.
- **uv-managed Python broken (0xc0e90002)** — a corrupted Python 3.11 install made
  setup fail with a DLL-load error. The launcher now verifies the uv-managed Python
  actually runs and auto-repairs it (`uv python install --reinstall 3.11`) before
  aborting with actionable steps.
- **"Installing uv — nothing happens"** — the prerequisite step had no error handling
  and a bare 60s await, so failures froze the UI. It now streams live output, verifies
  the install, and waits up to 120s, with a toast on failure.
- **`UnicodeEncodeError: 'charmap'` server crashes (Exit 1)** — all Python spawn
  sites (and the terminal-mode batch file) now set UTF-8 console encoding, so
  non-ASCII paths and output no longer crash the server on startup.
- **Missing Prompt Enhancer "Write" button** — when the config lacked
  `enhancer_mode`, the enhancer dropdown defaulted to nothing and the button never
  appeared. The launcher now defaults it to *Automatic*.
- **Silent clone failures** — `git clone` is wrapped so timeouts (e.g. under
  antivirus load) produce a clear error with manual-clone instructions and AV
  exclusion advice instead of a frozen install.

## Improvements

- **Live install progress** — install-prerequisite output streams into the installer
  console in real time (no more frozen "Installing…" with no feedback).
- **Upgrade-safe backup dialog** — reinstalling asks *Backup & Restore (recommended)*
  or *Skip backup* before wiping, and the restore path is fixed.
- **Honest uninstall reporting** — every kept folder is listed, leftover locked
  folders are called out with exact paths, and failures say *why* and *what to do*.

## Infrastructure

- **Updated README** — version badge and release notes for v2.2.4.
- **Full changelog history** in [changelogs/](changelogs/).
