# Wan2GP Desktop

Desktop launcher for [Wan2GP](https://github.com/deepbeepmeep/Wan2GP) — the video generation AI toolkit.

[![Release](https://img.shields.io/github/v/release/GKartist75/wan2gp-desktop?style=flat-square)](https://github.com/GKartist75/wan2gp-desktop/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)]()
[![License](https://img.shields.io/github/license/GKartist75/wan2gp-desktop?style=flat-square)]()

---

> **Pre-release / Test version** — Hi all, thanks for all your feedback. Even though I've tested this thoroughly and it has been running without issues for the past few days, some users are still bumping into a few bugs or points of confusion in practice. Therefore, I'm marking this as a pre-release / test version first. If you'd like to test it out and find any issues, please let me know!

## ⚠ Disclaimer

This is a **test build** intended for development and testing purposes only. It may contain bugs, incomplete features, or stability issues. Not recommended for production use. Use at your own risk.

## What is this?

Wan2GP Desktop is a **wrapper around Wan2GP** — it doesn't replace or modify Wan2GP itself. All generation, model loading, and UI rendering is done by Wan2GP's own Gradio server. The desktop app adds:

- **Install** — one-click clone, GPU detection, env creation, correct PyTorch/attention kernel selection
- **Maintain** — update, upgrade components, reinstall, auto-restart on crash, backup plugins/finetunes before wipe
- **Use** — embedded webview with Wan2GP's native UI, output file sidebar with preview/metadata/drag-into-settings, real-time terminal output, hardware-tuned default config (attention mode, profile, compile)

Everything Wan2GP does — models, generation, scheduling, LoRAs, finetunes — works exactly as it does when run standalone.

## Features

- **One-click install** — clones Wan2GP, creates env, detects GPU, installs correct PyTorch/CUDA/ROCm + attention kernels automatically
- **Environment choice** — pick `venv`, `uv` (faster), or `conda` before install
- **Hardware-aware** — auto-detects GPU (NVIDIA RTX 30/40/50, AMD, Apple Silicon) and selects the right wheels from Wan2GP's `setup_config.json`
- **Real-time RAM/VRAM stats** — live memory display in Wan2GP UI, enabled by default
- **Zero VRAM** — Electron uses 0 MB GPU memory via `app.disableHardwareAcceleration()`. All VRAM reserved for generation.
- **Embedded viewer** — runs Wan2GP Gradio UI inside a webview tab in the desktop app
- **External browser** — pick any installed browser (Chrome, Firefox, Edge, Brave, Opera, Vivaldi) with optional default preference
- **Webview crash resilience** — auto-reloads on GPU crash, no more frozen screens
- **Server auto-restart** — Wan2GP process restarts automatically on unexpected exit (up to 3 tries)
- **Live launch progress** — progress bar, status messages, and elapsed timer during startup
- **Model folder config** — set checkpoints and LoRAs paths during install, written to `wgp_config.json`
- **Configurable install path** — choose where the Wan2GP repo lives before installing
- **Upstream changelog** — latest 5 Wan2GP commits shown in dashboard with update indicator
- **Resizable terminal** — live log panel with auto-scroll follow, pause on manual scroll, drag-to-resize
- **System info** — CPU, RAM, GPU, VRAM displayed on dashboard
- **Package versions** — 14 core Python packages shown in the environment card
- **Self-updating** — checks GitHub Releases for new desktop app versions, downloads and installs with one click
- **Public repo** — no token needed for auto-updates

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

### v1.2.7 — 2026-07-04

#### Issues Solved
- **Preview close freeze** — execSync Python spawn blocked main process for 1-2s. Fixed: replaced with async exec() wrapped in Promise. Main process stays responsive during metadata loading
- **Async callback race condition** — After user closed preview, late IPC responses set img.src to 13MB data URL, freezing Chromium render thread. Fixed: _previewAlive flag drops all stale callbacks after close
- **Massive data URLs** — data: URLs embedded entire file as base64 inline (13MB), causing synchronous parsing freeze. Fixed: switched to URL.createObjectURL(blob) for both images and videos
- **Unbounded thumbnail memory leak** — thumbCache stored full data: URLs for every file. 50+ AI images = 250-500MB permanently retained. Fixed: LRU cache capped at 20 entries, blob URLs instead of data URLs, evicted entries properly revoked
- **h265 video / WebSocket crashes** — app.disableHardwareAcceleration() disabled GPU decode and caused connection drops. Fixed: removed the flag
- **Thumbnail load storm** — 200 concurrent fs.readFileSync IPC calls on each sidebar refresh froze main process. Fixed: throttled to 5 at a time, 100ms apart
- **Sidebar auto-poll** — setInterval(refreshSidebar, 3000) caused 3s flash and 200x IPC flood. Fixed: removed auto-poll entirely, replaced with fs.watch + manual Reload button
- **dragover getData() blocked** — Security spec returns empty string during dragover. Fixed: use e.dataTransfer.types array instead

#### Installer Improved
- NSIS Welcome page shows app description, no license/agreement page
- Layout redesigned: tasks in left column, terminal always visible on right
- Install button white text fix
- Reinstall choice UI with three buttons instead of raw confirm()
- autoDownload enabled — updates auto-download in background
- Shift+click for local update testing
- Uninstall Wan2GP with native dialogs for backup + keep/delete prompts, cancel at any step
- Uninstall Environment removes venv only, keeps repo/data

#### Dashboard Improved
- Desktop App info card with version, commit hash, repo link
- Model Folders card with checkpoint + LoRA paths and edit buttons
- Clearer button labels: Launch Wan2GP in Desktop, Launch Wan2GP in Browser, Check Desktop Updates
- Removed redundant Refresh from Environments card
- Check Updates moved to center action grid
- Desktop App card restyled to match Wan2GP Updates format
- Dark theme default with white-flash prevention

#### Enhanced Functionality
- **Output sidebar** — collapsible left panel with folder navigation, file list with thumbnails, folder browse
- **Preview overlay** — double-click to preview images/videos, zoom/pan/reset, close via X or backdrop click
- **Metadata viewer** — collapsible JSON section from PNG iTXt chunk (zero deps), JSON sidecar, or async Python get_settings_from_file()
- **Async Python metadata reader** — no more main process blocking during metadata extraction
- **fs.watch on output directory** — sidebar refreshes automatically when new files are generated (500ms debounce)
- **Keep Wan2GP process alive** — Back to Dashboard no longer kills the generation process
- **Native right-click context menu** in webview
- **Hardware-tuned defaults** — auto-detects GPU/RAM/VRAM, sets optimal attention/compile/profile/hierarchy
- **Maximized window** on launch
- **Drag-drop prep** — synthetic DragEvent('drop') on Gradio native Upload component (code ready, disabled for later testing)

## License

MIT

## Testing & Feedback

Special thanks to everyone who tested v1.2.6 beta builds and reported issues that directly shaped the v1.2.7 release. Your feedback on freezes, crashes, and usability made the desktop launcher significantly more stable.

Want to help test future builds? Join the [Wan2GP Discord](https://discord.gg/wan2gp).
