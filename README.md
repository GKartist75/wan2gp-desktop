# Wan2GP Desktop Launcher

The easiest way to run [Wan2GP](https://github.com/deepbeepmeep/Wan2GP) on your machine — install, update, and launch it from one window. No terminal, no manual dependency hell.

[![Release](https://img.shields.io/github/v/release/GKartist75/wan2gp-desktop?style=flat-square)](https://github.com/GKartist75/wan2gp-desktop/releases)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey?style=flat-square)]()
[![License](https://img.shields.io/github/license/GKartist75/wan2gp-desktop?style=flat-square)]()

## It just works — three clicks

1. **Run the installer** — no need to pre-install anything.
2. **It sets up everything for you** — see below.
3. **Click Launch** — your browser opens to Wan2GP.

That's the whole user journey. The launcher does the boring, error-prone parts.

## What it handles for you

- **Prerequisites, installed automatically.** Missing Git, Python 3.11, uv, or conda? The installer downloads and installs them silently with one click — no manual downloads, no PATH editing.
- **Hardware detection.** It reads your GPU (NVIDIA RTX 30/40/50, AMD, Apple Silicon) and picks the correct PyTorch + CUDA/ROCm build and attention kernels *before* you install. You see exactly what will be set up.
- **One environment, done right.** Creates an isolated Python env on the correct interpreter (Python 3.11 via uv) so pinned deps like `pygame` install from prebuilt wheels — no compile errors.
- **Keep it alive.** Update Wan2GP, upgrade components, reinstall, switch environments, or uninstall with backup — all from the UI.
- **Launch with a real terminal.** Wan2GP runs in a visible cmd window (you see live Python output) and your browser auto-opens when the server is ready.
- **Stay informed.** Live server log, RAM/VRAM metrics, and a 27-package version overview with one-click installs.

> New in v2.1.2: the installer now resolves **Python 3.11 via uv** instead of falling back to a newer system Python — this fixes a `pygame` build crash on machines with Python 3.14.

## Prerequisites

The launcher installs these for you if absent, but your system needs:

| Tool | Needed for | Auto-install | Manual |
|------|-----------|-------------|--------|
| **Git** | Clone repo | ✅ | [git-scm.com](https://git-scm.com/downloads) |
| **Python 3.11** | env creation | ✅ via uv | [python.org](https://www.python.org/downloads) |
| **uv** (optional) | Faster installs | ✅ | [docs.astral.sh/uv](https://docs.astral.sh/uv/#installation) |
| **Miniconda** (optional) | `conda` envs | ✅ | [docs.anaconda.com/miniconda](https://docs.anaconda.com/miniconda/) |
| **NVIDIA GPU + driver** | Running Wan2GP (CUDA 12.8+) | ❌ | [nvidia.com/drivers](https://www.nvidia.com/drivers) |
| **~50 GB free** + **Internet** | Repo + models + deps | — | — |

## Download
Grab `Wan2GP-Desktop-Launcher-*-win-x64.exe` from [Releases](https://github.com/GKartist75/wan2gp-desktop/releases).
> Unsigned installer — the "unknown publisher" warning is normal for OSS without a code-sign cert.

👉 **[Visual guide → infographic](https://htmlpreview.github.io/?https://github.com/GKartist75/wan2gp-desktop/blob/main/infographic.html)** — how to install, hardware profiles, dashboard layout, and all features in one page.

## Quick Start
1. Run the installer → it detects your GPU and shows expected packages
2. Pick install location / env type (`uv` recommended, `venv` default)
3. Click **Install** (~5–20 min)
4. Click **Launch Wan2GP** — terminal opens, browser opens at `http://localhost:7860`

Optional: **Desktop Shortcut** creates `Launch Wan2GP.bat` to run without the launcher.

## Build from source
```bash
git clone https://github.com/GKartist75/wan2gp-desktop.git
cd wan2gp-desktop
npm install
npm start          # dev
npm run build:win  # Windows NSIS installer
```

## Changelog
- **v2.1.2** — Fix: installer uses Python 3.11 (via uv) instead of falling back to 3.14; resolves `pygame`/kernel build failures. Compacted + ease-of-use focused README.
- **v2.1.1** — HuggingFace token support, remembered tokens, update-button fix.
- **v2.0** — Full rewrite as pure launcher (see [CHANGELOG-v2.0.md](CHANGELOG-v2.0.md)).

## License
MIT
