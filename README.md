# Wan2GP Desktop

Desktop launcher for [Wan2GP](https://github.com/deepbeepmeep/Wan2GP) — the video generation AI toolkit. Built with Electron + Vue 3 pattern (inspired by ComfyUI Desktop).

[![Release](https://img.shields.io/github/v/release/GKartist75/wan2gp-desktop?style=flat-square)](https://github.com/GKartist75/wan2gp-desktop/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)]()
[![License](https://img.shields.io/github/license/GKartist75/wan2gp-desktop?style=flat-square)]()

---

## Features

- **One-click install** — clones Wan2GP, creates env, detects GPU, installs correct PyTorch/CUDA/ROCm + attention kernels automatically
- **Environment choice** — pick `venv`, `uv` (faster), or `conda` before install
- **Hardware-aware** — auto-detects GPU (NVIDIA RTX 30/40/50, AMD, Apple Silicon) and selects the right wheels from Wan2GP's `setup_config.json`
- **Embedded viewer** — runs Wan2GP Gradio UI inside a webview tab in the desktop app
- **External browser** — pick any installed browser (Chrome, Firefox, Edge, Brave, Opera, Vivaldi) with optional default preference
- **Resizable terminal** — live log panel with auto-scroll follow, pause on manual scroll, drag-to-resize
- **System info** — CPU, RAM, GPU, VRAM displayed on dashboard
- **Package versions** — 14 core Python packages shown in the environment card
- **Self-updating** — checks GitHub Releases for new desktop app versions, downloads and installs with one click
- **Settings/Manage** — update Wan2GP, upgrade components, switch environments, manage git branches

## Screenshots

| Dashboard | Installer | Viewer |
|---|---|---|
| System info, env card, terminal | Task list with hardware detection | Wan2GP UI with terminal overlay |

## Download

Grab the latest installer from [Releases](https://github.com/GKartist75/wan2gp-desktop/releases).

| Platform | Download |
|---|---|
| Windows (x64) | `Wan2GP-Desktop-*-win-x64.exe` |
| macOS (x64) | `Wan2GP-Desktop-*-mac-x64.dmg` |
| macOS (arm64) | `Wan2GP-Desktop-*-mac-arm64.dmg` |
| Linux (x64) | `Wan2GP-Desktop-*-linux-x86_64.AppImage` |

> **Note:** Windows installer is unsigned (shows "unknown publisher" warning). This is normal for OSS projects without a code signing certificate.

## Quick Start

1. **Download & run** the installer for your platform
2. App launches → detects GPU → shows **first-time install** screen
3. Select environment type (`venv` recommended, `uv` for faster installs)
4. Click **Install** — the full setup runs automatically (~5–20 min depending on GPU/deps)
5. Once complete, click **▶ Launch in Desktop** or **↗ Launch in Browser**
6. Wan2GP opens — generate videos!

## Building from Source

```bash
git clone https://github.com/GKartist75/wan2gp-desktop.git
cd wan2gp-desktop
npm install
npm start              # development mode
npm run build:win      # build Windows NSIS installer
npm run build:mac      # build macOS DMG
npm run build:linux    # build Linux AppImage + deb
```

## Architecture

```
wan2gp-desktop/
├── main.js                 # Electron main process — IPC, auto-updater, setup.py wrapper
├── preload.js              # Context bridge — exposes w2gp API to renderer
├── renderer/
│   ├── index.html          # UI screens (splash, dashboard, installer, viewer, settings)
│   ├── style.css           # Dark theme, terminal, modal styling
│   └── app.js              # All UI logic — log buffer, state management, event wiring
├── electron-builder.yml    # Build config (NSIS, DMG, AppImage + GitHub publish)
├── package.json            # Dependencies (electron, electron-builder, electron-updater, fs-extra)
└── icon.png / resources/   # App icons
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| **Delegate to setup.py** | Desktop app does not handle GPU detection or wheel installation — runs `setup.py install --env $ENV --auto` which auto-selects correct torch/CUDA/attention kernels |
| **TCP port check** | Uses `net.connect` (not HTTP GET) to detect when Gradio server starts — port opens before HTTP is ready |
| **Global log buffer** | All setup + launch output feeds one buffer → rendered in 3 terminal views (dashboard, installer, viewer) |
| **electron-updater** | Checks GitHub Releases for new versions, downloads delta/exe, quits and installs |

## Changelog

### v1.0.0 — 2026-07-02

Initial release.

**Install & Setup**
- First-time install with hardware detection and GPU profile display
- Environment type selection: `venv`, `uv`, or `conda`
- Structured task list with live progress (clone → venv → torch → reqs → triton → sage → flash → kernels → finalize)
- Raw terminal tab toggle for full setup.py output
- Post-install `huggingface_hub` fix to avoid Xet storage warning

**Desktop Running**
- Embedded webview viewer with toolbar
- "Launch in Browser" with browser picker modal (detects Chrome, Firefox, Edge, Brave, Opera, Vivaldi)
- Save browser preference to skip picker
- TCP-based server readiness detection (3 min timeout, process death detection)

**Terminal**
- Resizable log panel with drag handle
- Auto-scroll follow mode — pauses on manual scroll, re-enables with ▼ Follow button
- Present on dashboard, installer, and viewer
- Global log buffer (5000 line cap), cleared with Clear button

**System & Env Card**
- CPU, RAM, GPU, VRAM detection (WMI/nvidia-smi on Windows, sysctl on Mac, /proc + lspci on Linux)
- 14 package versions displayed: Python, Torch, CUDA, Triton, Sage Attn, Flash Attn, Diffusers, Transformers, Gradio, Accelerate, onnxruntime, OpenCV, PEFT, huggingface_hub

**Update System**
- Auto-check for updates on startup (5s delay)
- Update banner with Download button and live progress bar
- Install & Restart flow via electron-updater
- GitHub token config in Settings for private repo auto-updates
- Manual "Check Updates" button in sidebar

**Settings / Manage**
- Update Wan2GP (git pull + deps)
- Upgrade PyTorch / attention kernels
- Reinstall environment
- Environment list with activation, deletion
- GitHub token configuration

## License

MIT
