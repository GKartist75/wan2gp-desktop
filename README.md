# Wan2GP Desktop Launcher

A desktop launcher for [Wan2GP](https://github.com/deepbeepmeep/Wan2GP) that installs,
updates, and runs it from one window — handling Git, Python, CUDA, and PyTorch setup
so you don't have to configure them manually.

[![Release](https://img.shields.io/github/v/release/GKartist75/wan2gp-desktop?style=flat-square)](https://github.com/GKartist75/wan2gp-desktop/releases)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey?style=flat-square)](<>)
[![License](https://img.shields.io/github/license/GKartist75/wan2gp-desktop?style=flat-square)](<>)

## Why a launcher

Wan2GP's manual setup involves cloning the repo, installing Python 3.11, selecting a
PyTorch + CUDA/ROCm build that matches your GPU, and building attention kernels.
The launcher automates those steps and manages the environment for you.

## Getting started

1. **Run the installer** — no prior tooling required.
2. **It sets up the environment** — detects your GPU and lists the packages it will install before proceeding.
3. **Click Launch** — Wan2GP opens, ready to use.

## Features

### 🛠 Setup

- **Prerequisites, auto-installed.** Missing Git, Python 3.11, uv, or conda? One click installs them silently — no PATH editing.
- **Hardware detection.** Reads your GPU (NVIDIA RTX 30/40/50, AMD, Apple Silicon) and selects the matching PyTorch + CUDA/ROCm build and attention kernels before installing.
- **Isolated environment.** A Python 3.11 env via uv with pinned deps, so `pygame` and others install from prebuilt wheels.

### 🚀 Launch modes

- **Desktop mode** (green) — Wan2GP runs inside the launcher with browser controls (back/forward/reload, zoom 25–200%) and a popout to a separate window.
- **Browser mode** (amber) — runs in a visible console and auto-opens your browser when the server is ready.
- **No-GPU Chrome script** — launch in Chrome with GPU disabled to free VRAM for generation.
- **Browser picker** — detects Chrome, Edge, Firefox, Brave, Opera, Vivaldi; choose your default.

### 📊 Monitoring & control

- **Dockable console** — live server log, dock to bottom/left/top or float in its own window. Search, export, resize. Toggle with Ctrl+` or the topbar button.
- **Topbar sparklines** — CPU/GPU/RAM/VRAM usage as mini real-time charts.
- **Running LED & Stop** — status light and one-click server stop.
- **System tray** — minimize to tray, auto-start with Windows, notifications on server ready/stop.
- **Keyboard shortcuts** — Ctrl+` terminal, F12 DevTools picker, Esc/Ctrl+W close webview.
- **Maintenance** — update, upgrade, reinstall, switch envs, or uninstall-with-backup from the UI.

> **New in v2.1.8** — terminal docking/floating reliability: closing the console restores Wan2GP to full size, floating mode keeps Wan2GP visible with the console in its own window, and the floating console resizes with its window. [Full changelog →](CHANGELOG-v2.1.8.md)

## Prerequisites

No need to pre-install anything — the launcher sets up Git, Python 3.11, uv, and
Miniconda for you automatically. To actually run Wan2GP you'll need an NVIDIA GPU

- driver (CUDA 12.8+) and an internet connection. The launcher itself is about
  90 MB to download and 250 MB installed.

For manual installation or troubleshooting of any prerequisite, see
[PREREQUISITES.md](PREREQUISITES.md).

## Download

Grab `Wan2GP-Desktop-Launcher-*-win-x64.exe` from
[Releases](https://github.com/GKartist75/wan2gp-desktop/releases).

> Unsigned installer — the "unknown publisher" warning is normal for OSS without a code-sign cert.

👉 **[Visual guide → infographic](https://htmlpreview.github.io/?https://github.com/GKartist75/wan2gp-desktop/blob/main/infographic.html)** — install steps, hardware profiles, dashboard layout, and every feature on one page.

## Quick Start

1. Run the installer → it detects your GPU and shows expected packages
2. Pick install location / env type (`uv` recommended, `venv` default)
3. Click **Install** (~5–20 min)
4. **Launch:** **Launch Wan2GP in Desktop** (green) to run inside the launcher, or
   **Launch Wan2GP in Browser** (amber) to open in your browser.
5. Monitor server output in the **Console** panel (topbar button, dockable to bottom/left/top/floating).

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

- **v2.1.8** — **Bugfix release** — terminal docking/floating reliability. Closing the console always restores Wan2GP to full size (no grey gap), floating mode keeps Wan2GP visible with the console in its own movable window, and the floating console now resizes with its window. See [CHANGELOG-v2.1.8.md](CHANGELOG-v2.1.8.md).
- **v2.1.7** — **Bugfix release** — fixes a critical blank/gray-screen on launch (installer mis-nested under the dashboard collapsed to 0×0), installer model-folder paths (ckpts/loras/output) being ignored/defaulted, live topbar metrics (CPU/GPU/RAM/VRAM) not starting on a fresh install, and the empty installer console. See [CHANGELOG-v2.1.7.md](CHANGELOG-v2.1.7.md).
- **v2.1.6** — **Bugfix release** — tray icon properly destroyed on quit, child processes killed reliably via `taskkill /f /t`, single-instance lock prevents duplicate launchers, window close now quits app. See [CHANGELOG-v2.1.6.md](CHANGELOG-v2.1.6.md).
- **v2.1.5** — **System tray** — minimize to tray, window state persistence, auto-start with Windows, follow system theme, desktop notifications, F12 DevTools picker, release automation. See [CHANGELOG-v2.1.5.md](CHANGELOG-v2.1.5.md).
- **v2.1.4** — **Live topbar sparkline charts**, browser detection + default picker, keyboard shortcuts, floating terminal enhancements, refresh button, GPU detection rewrite, already-running detection, Electron GPU toggle, path panel layout fix, button colors/renames. See [CHANGELOG-v2.1.4.md](CHANGELOG-v2.1.4.md).
- **v2.1.3** — Launch Wan2GP inside the app via Electron BrowserView (back/forward/reload, zoom, popout, dockable console, running LED, stop button). See [CHANGELOG-v2.1.3.md](CHANGELOG-v2.1.3.md).
- **v2.1.2** — Fix: installer uses Python 3.11 (via uv) instead of falling back to 3.14; resolves `pygame`/kernel build failures.
- **v2.1.1** — HuggingFace token support, remembered tokens, update-button fix.
- **v2.0** — Full rewrite as pure launcher. See [CHANGELOG-v2.0.md](CHANGELOG-v2.0.md).

## License

MIT
