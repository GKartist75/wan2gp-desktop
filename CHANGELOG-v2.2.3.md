# Wan2GP Desktop Launcher v2.2.3

**UX, reliability, and install flow release** — verbose env unlink progress, isolated
Python 3.11 for venv (no global install), user-confirmed backup before reinstall,
working prerequisite help card, and compact Auto-Tune display with 7-profile support,
quantization/VAE dropdowns, and a profile matrix reference table.

## New Features

- **7-profile Auto-Tune** — all 7 Wan2GP profiles (P1, P2, P3, P3+, P4, P4+, P5) with
  correct numeric values. Audio profile no longer capped (same 7 options as video/image).
- **VAE Config & Quantization dropdowns** — editable dropdowns replacing static text labels
  in the Auto-Tune recommendation card.
- **Profile matrix reference table** — small VRAM × RAM lookup table under the recommendation
  so you can see how profiles map to your hardware.
- **Compact hardware display** — horizontal inline chips (GPU, VRAM, RAM, CUDA, Cap) instead
  of stacked vertical rows, saving vertical space.
- **Prerequisite help card** — when Git, Python, uv, or Miniconda are missing, shows a
  help card with a one-click "Download & Install" button and a manual-install link.

## Improvements

- **Verbose env unlink** — instead of a silent `rmdir /s /q`, the launcher now shows each
  top-level item as it's removed, giving real-time progress for large environments.
- **Isolated Python for venv** — when `py -3.11` is not available and the user selects
  `venv` env type, the launcher uses uv's managed Python 3.11 (via a batch shim) instead
  of installing Python globally. No registry entries, no Start Menu shortcuts.
- **Backup confirmation dialog** — reinstalling now asks "Backup & Restore (recommended)"
  or "Skip backup" before wiping the installation. Previously backup was always automatic.
- **xcopy restore fix** — destination directories are now created (`mkdirSync`) before
  `xcopy` runs, fixing the "Command failed" restore warning on fresh clones.
- **Auto-Tune install guard** — checks that Wan2GP is actually installed before showing
  the Auto-Tune tab, with a banner directing users to the Installer tab.

## UI

- **Console scrollbar** — thin custom scrollbar with hover contrast on the floating terminal.
- **Profile dropdown readability** — missing CSS variables (`--bg-secondary`, `--bg-tertiary`,
  `--accent-dim`) added to both light and dark themes.
- **Truncated install path fix** — the install location now shows `p.repo` (the actual
  install directory) and uses `word-break: break-all` to avoid clipping.

## Infrastructure

- **Updated infographic.html** — profile lookup table with 7 profiles and matrix.
- **Updated README** — 7 profiles, matrix, and new features documented.
