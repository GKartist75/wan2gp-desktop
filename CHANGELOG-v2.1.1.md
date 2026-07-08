# Wan2GP Desktop Launcher v2.1.1 — Release Notes

## Overview

HuggingFace token support, remembered tokens, and update button fix.

---

## ✨ New Features

- **Temp `.bat` launch** — Wan2GP runs in its own visible cmd window, not a hidden background process. You see real-time Python output.
- **Auto browser on Launch** — no more browser picker modal. Click Launch → terminal opens → browser opens automatically when server is ready.
- **PowerShell HTTP port polling** — shortcut `.bat` and temp launch script wait for a real HTTP 200 response (via `Invoke-WebRequest`), not just a TCP socket open.
- **Pulsing progress bar** — amber animated bar below the Launch button during first-time startup.
- **Live free RAM/VRAM** — real-time system metrics update every 5 seconds on the dashboard.
- **Multi-GPU display** — all GPUs listed if you have more than one.
- **Configurable output path** — set where generated files are saved, in both installer and dashboard. Persisted to `wgp_config.json`.
- **Quick pip install** — type any package name in the Active Environment card to install it.
- **Restore pinned versions** — click **restore** button to reinstall all packages from `requirements.txt` after a failed upgrade.
- **Per-package install buttons** — missing packages show a `+` button to install them.
- **Real-time pip streaming** — `upgrade-package` and `install-package` switched from `exec` (buffered) to `spawn` (streaming). Progress bars visible in console.
- **Hardware-aware package display** — installer shows exactly what will be installed (Python, Torch, Triton, Sage, Flash, kernels) based on detected GPU.
- **Phase-based console logging** — each install step (`Creating Python venv`, `Installing PyTorch`, etc.) logged to console as it starts.
- **Desktop shortcut auto-browser** — `Launch Wan2GP.bat` now activates the correct environment, polls for the server, and opens your browser automatically.
- **Process monitor** — every 8 seconds checks if the Wan2GP port is still open. Logs when the process stops (terminal closed / crash).
- **YouTube channel link** — small link in the Desktop App card footer.
- **Consistent brand color** — "GK Artist" now uses a single color throughout.
- **Conda availability check** — installer validates conda is installed before attempting a conda install.
- **Default paths shown on clear** — clearing a model folder now shows the actual default path instead of just "(default)".

## 🔧 Changes

- **Default port**: `17861` → `7860` (standard Gradio port)
- **All URLs**: `127.0.0.1` → `localhost`
- **Default repo folder**: `Repo_Wan2GP` → `Wan2GP`
- **Manage panel**: removed broken Reinstall/Uninstall/Upgrade buttons. Kept GitHub Token + Launch config.
- **Settings Log panel**: removed. All feedback converted to `showToast` notifications.
- **`log()` function**: removed (was only used by removed settings Log panel).
- **Dead CSS**: removed `.settings-actions`, `.settings-divider`, `.settings-action`, `.log`, `#launchLog`, `.env-list-del`.
- **Dead IPC handlers**: removed `is-running`, `stop`, `check-api-status`, `findFreePort`, `open-in-browser`, `get-wangp-changelog`, `uninstall-wangp`, `upgrade`.
- **Dead variables**: removed `wangpProc`, `userStoppedProcess`, `_termLogBuffer`, `buf` in `runSetup()`.
- **Ponytail comments**: replaced with clean descriptions.
- **`webviewTag`**: removed from `BrowserWindow` config.
- **`createWindow`**: simplified to `show: true` + `maximize()` (no more flash-of-white).
- **Install console output**: all env types (venv, conda, uv) now show phase progress in the console.

## 🐛 Bug Fixes

- **Python auto-install URL** — `python-3.11.14-amd64.exe` returned 404 (that version was never published as a standalone installer). Fixed to `python-3.11.9-amd64.exe`, the latest available 3.11 installer on python.org. Profile version labels still show `3.11.14` — that's the version string `setup.py` requests for env creation, not a download URL.
- **CSS broken layout** — `.brand-mark-small` was missing its closing `}` (from a bad patch), which ate all subsequent CSS rules — entire dashboard was invisible. Fixed.
- **restoreBtn ReferenceError** — `restoreBtn` handler was placed outside `refreshEnvUnlink()` scope where the `var` wasn't accessible. Moved inside.
- **Upstream GitHub API double-parse** — `getWangpUpstreamInfo` called `JSON.parse(body)` on already-parsed data, silently failing the changelog.
- **Triton version detection** — added package alias `triton → triton-windows` (and similar for `spas-sage-attn`, `huggingface-hub`).
- **Install button cleanup order** — `.pkg-install-btn` cleanup ran AFTER `setSpec` created the buttons, instantly deleting them. Moved cleanup before creation.
- **First-launch message** — updated in both terminal .bat and dashboard banner to say "this will take some extra time" instead of "this is normal".

## 📦 Package Tracking

Status check increased from **14 to 27 packages**:
```
Added: bitsandbytes, numpy, sentencepiece, open_clip_torch,
       imageio, einops, librosa, soundfile, tokenizers, av
Aliases: triton → triton-windows, opencv-python → opencv,
         spas_sage_attn → spas-sage-attn, huggingface_hub → huggingface-hub
```

## 📋 Full Changelog

See the [README](README.md) for the complete feature list and architecture documentation.
