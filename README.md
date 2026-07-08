# Wan2GP Desktop Launcher

Desktop launcher for [Wan2GP](https://github.com/deepbeepmeep/Wan2GP) — install, maintain, and start Wan2GP from one place. That's it.

[![Release](https://img.shields.io/github/v/release/GKartist75/wan2gp-desktop?style=flat-square)](https://github.com/GKartist75/wan2gp-desktop/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey?style=flat-square)]()
[![License](https://img.shields.io/github/license/GKartist75/wan2gp-desktop?style=flat-square)]()

---

## What is this?

Wan2GP Desktop Launcher is a **wrapper** around Wan2GP — it does not replace or modify Wan2GP itself. All generation, model loading, and UI rendering is done by Wan2GP's own Gradio server running in your browser. The launcher just handles the boring setup:

- **Install** — one-click clone, GPU detection, env creation, correct PyTorch/CUDA/attention kernel selection based on your hardware (mirrors Wan2GP's `setup_config.json` profiles 1:1)
- **Maintain** — update Wan2GP, upgrade components, reinstall, manage environments, uninstall with backup
- **Launch** — click a button, a terminal window opens running `wgp.py`, your browser opens to the Wan2GP UI
- **Monitor** — live server log in the dashboard console, automatic detection when the process stops

Everything Wan2GP does — models, generation, scheduling, LoRAs, finetunes — works exactly as it does when run standalone. The launcher gets out of the way.

## Features

- **One-click install** — clones Wan2GP, creates venv, detects GPU (NVIDIA RTX 30/40/50, AMD, Apple Silicon), installs correct PyTorch + CUDA/ROCm + attention kernels automatically
- **Hardware-aware** — matches Wan2GP's GPU profiles: shows exactly what will be installed (Python version, Torch variant, Triton, Sage Attention, Flash Attention, nunchaku, GGUF, lightx2v) before you click Install
- **Quick package install** — type any pip package name into the Active Environment card to install it (`triton`, `bitsandbytes`, `flash-attn`, etc.)
- **Restore pinned versions** — click the **restore** button to reinstall all packages from `requirements.txt` after a failed upgrade
- **Package version overview** — 27 key packages shown with green/red status dots, missing packages get a `+` install button
- **Per-package upgrade** — Click Check Updates to see what's outdated, upgrade individual packages (real-time pip output streams to console)
- **Launch in visible terminal** — Wan2GP runs in its own cmd window (not hidden), you see real-time Python output, auto-opens browser when ready via PowerShell HTTP check
- **Auto browser launch** — opens in your system default browser, no picker modal
- **Launch progress bar** — pulsing amber progress bar during first-time startup
- **Launch info banner** — shows "first launch loads models + compiles CUDA kernels — this will take some extra time" while starting
- **Live free RAM/VRAM** — real-time system metrics update every 5s on the dashboard
- **Multi-GPU display** — all GPUs listed if you have more than one
- **Output path** — configurable in both installer and dashboard (Browse / ✕), saved to `wgp_config.json`
- **Environment management** — switch between envs, unlink with a red text button
- **Desktop shortcut** — creates a standalone `.bat` that activates the env, starts Wan2GP, polls with `netstat`/PowerShell, and opens your browser automatically
- **Desktop self-update** — checks GitHub Releases, downloads and installs with one click
- **Wan2GP changelog** — latest commits from `deepbeepmeep/Wan2GP` shown in dashboard, plus HuggingFace models link
- **Configurable launch args** — extra flags passed to `wgp.py` on startup
- **Configurable server port** — default 7860 (standard Gradio port), changeable in settings
- **YouTube channel link** — small link in the Desktop App card footer
- **Dark/light theme** — toggle in the topbar

## What is NOT included (removed in v2.0)

The original v1.x had an embedded webview, output file sidebar with thumbnails/metadata/preview, floating terminal, drag-drop file injection into Gradio, prompt library, and a launch splash screen. All of that was removed in v2.0 because the browser does it better. The launcher now focuses purely on lifecycle management.

## Download

Grab the latest installer from [Releases](https://github.com/GKartist75/wan2gp-desktop/releases).

| Platform | Download |
|---|---|
| Windows (x64) | `Wan2GP-Desktop-Launcher-*-win-x64.exe` |

> **Note:** Windows installer is unsigned (shows "unknown publisher" warning). This is normal for OSS projects without a code signing certificate.

## Quick Start

1. **Download & run** the installer
2. App launches → detects GPU → shows **first-time install** screen with expected packages
3. Optionally change install location and model folders, select environment type (`venv` recommended)
4. Click **Install** — the full setup runs automatically (~5–20 min depending on GPU/deps)
5. Once complete, click **Launch Wan2GP**
6. A terminal window opens running Wan2GP — your browser opens to `http://localhost:7860`

### Two ways to start Wan2GP

- **From the launcher dashboard** — click the **Launch Wan2GP** button. A terminal window opens, Wan2GP starts, and your browser opens automatically when ready.
- **From a desktop shortcut** — click **Desktop Shortcut** on the dashboard. A `Launch Wan2GP.bat` file is created on your desktop. Double-click it anytime (even without the desktop launcher) — it activates the correct Python environment, starts Wan2GP in a terminal window, and opens your browser when the server is ready. This is useful if you just want to run Wan2GP without opening the desktop app.

## Building from Source

```bash
git clone https://github.com/GKartist75/wan2gp-desktop.git
cd wan2gp-desktop
npm install
npm start              # development mode
npm run build:win      # build Windows NSIS installer
```

## Architecture

```
wan2gp-desktop/
├── main.js                 # Electron main process — IPC, install/launch, auto-updater
├── preload.js              # Context bridge — exposes w2gp API to renderer
├── renderer/
│   ├── index.html          # Screens (splash, dashboard, installer, settings)
│   ├── style.css           # Dark/light theme, cards, terminal, buttons
│   └── app.js              # All UI logic — log buffer, state, event wiring
├── electron-builder.yml    # Build config (NSIS + GitHub publish)
├── package.json            # Dependencies (electron, electron-builder, electron-updater)
└── resources/              # App icons
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| **Delegate to setup.py** | Launcher runs `setup.py install --auto` which auto-selects correct Torch/CUDA/attention kernels for detected GPU |
| **TCP port check** | Uses `net.connect` (not HTTP GET) to detect when Gradio server starts |
| **Temp .bat launch** | Creates a temporary batch script and opens it in a new cmd window — user sees Python output, process is independent |
| **Port monitoring** | Every 8s checks if the server port is still open; logs when Wan2GP stops |
| **electron-updater** | Checks GitHub Releases for new versions, downloads and installs |
| **Zero GPU usage** | Electron falls back to SwiftShader (CPU rendering), all GPU memory reserved for Wan2GP |

## Changelog

### v2.0 — 2026-07-08

**Complete rewrite as pure launcher.** See [CHANGELOG-v2.0.md](CHANGELOG-v2.0.md) for the full release notes.

Summary:
- **Product renamed** to "Wan2GP Desktop Launcher"
- **All browser-duplicating features removed** — webview, sidebar, metadata reader, floating terminal, prompt library, drag-drop injection, launch splash screen
- **New** temp `.bat` launch with visible cmd terminal, auto browser open, PowerShell port polling
- **New** live free RAM/VRAM metrics, configurable output path, quick pip install, restore button, per-package install buttons
- **New** install phase logging, pulsing progress bar, process monitor, conda availability check
- **Changed** default port 7860, `localhost` everywhere, folder name `Wan2GP`
- **Dropped** 3 dead IPC handlers, `log()` function, 100+ lines dead CSS, 4 dead variables
- **Fixed** CSS layout corruption, restoreBtn scope, upstream API double-parse, triton detection, install button order
- **Package tracking** increased from 14 to 27

## License

MIT
