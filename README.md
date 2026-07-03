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

### v1.1.6 — 2026-07-03

**Configurable install paths** — choose where Wan2GP repo lives.

- **Path picker** — Browse button in installer to set Wan2GP repo directory before install.
- **Paths card** — dashboard shows App data + Wan2GP repo locations.
- **Backend** — `getRepoDir()` reads `repoDir` from config, all git/Python ops follow.
- **Native folder dialog** — `select-folder` IPC handler uses Electron's directory picker.

### v1.1.5 — 2026-07-03

**Bug fixes & polish** — VRAM detection, task progress, dot alignment.

- **VRAM fix** — tries `nvidia-smi` first (accurate), WMI fallback. No more wrong VRAM on modern GPUs.
- **Task progress** — install steps now advance properly: clone → venv → torch → reqs → triton → sage → flash → kernels → done.
- **Dots only when installed** — package indicator hidden when not installed, consistent green `#4ADE80` in both themes.
- **Terminal completion messages** — `[*] Wan2GP update complete` / `[*] Wan2GP upgrade complete` shown after operations.
- **Upstream version number** — Wan2GP version displayed in changelog card header (parsed from README).

### v1.1.4 — 2026-07-03

**Wan2GP upstream changelog viewer** — see latest commits and update status directly in desktop.

- **Upstream commit feed** — latest 5 commits from deepbeepmeep/Wan2GP shown in dashboard card, fetched live from GitHub API.
- **Update indicator** — green dot on "Update Wan2GP" button when local repo is behind upstream HEAD.
- **Changelog link** — "Full changelog on GitHub →" opens upstream CHANGELOG.md in browser.
- **Local commit display** — short hash shows which commit is currently checked out.
- **GitHub API integration** — new IPC handlers fetch upstream commits and compare with local `git rev-parse HEAD`.

### v1.1.0 — 2026-07-02

**Complete visual redesign** — warm monochrome editorial UI with light/dark mode toggle.

- **Light/Dark theme** — sun/moon toggle in topbar, persists to config. Warm charcoal dark variant, all signal colors adapted.
- **Brand update** — splash now reads "GK Artist — Wan2GP Deepbeepmeep".
- **Three-column bento dashboard** — system specs left, action zone center, environment list right.
- **Persistent terminal dock** — always visible on dashboard, no longer hidden behind toggle.
- **Slide-out settings panel** — Manage screen converted to a slide panel with overlay.
- **All-emojis-out** — every icon replaced with inline SVG primitives. No emoji anywhere.
- **Typography system** — Instrument Serif (display) + Geist Sans (UI) + Geist Mono (data).
- **Palette** — warm monochrome (#FBFBFA canvas, #FFFFFF surface, #EAEAEA hairline borders). All gradients, heavy shadows, pill shapes removed.
- **Package versions card** — removed from center column (data already shown in left env card in 2-column grid).
- **Viewer terminal close fix** — stopPropagation prevents click from reaching webview behind overlay.

### v1.0.1 — 2026-07-02

- **Env selector waits** — installer screen shows env type picker (venv/uv/conda) with Install button. User chooses first, then clicks Install. No more auto-start.
- **Env selector disabled during install** — buttons grayed out once install starts.
- **Task progress fixed** — tasks now show ○ (pending) → ◌ (running) → ✓ (done) correctly instead of jumping straight to done.
- **Clone phase wired** — clone task properly marked done via IPC event from main.js.

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

## Development History

This project was built across two development sessions. Here's the full timeline from initial prototype to v1.0.0.

### Session 1 — Initial Prototype

**Goal:** Create a desktop version of Wan2GP using the same installer pattern as ComfyUI Desktop (Electron + Vue 3 architecture).

**Exploration & Architecture**
- Explored both [Wan2GP](https://github.com/deepbeepmeep/Wan2GP) and [ComfyUI Desktop](https://github.com/Comfy-Org/Comfy-Desktop) repositories to understand their architecture
- Wan2GP's `setup.py` handles all GPU detection and hardware-specific wheel selection (NVIDIA CUDA 12.8/13.0, AMD ROCm, Apple Silicon MPS)
- ComfyUI Desktop uses Electron + Vue 3 with a structured installer task list
- Decision: **delegate all hardware detection to Wan2GP's setup.py** — the desktop app runs `python setup.py install --env venv --auto` and displays progress

**Initial Electron Wrapper**
- Created `w2gp-desktop/` with Electron main process, preload IPC bridge, and 5-screen renderer UI
- Screens: splash, dashboard (env card + actions), installer (task list), viewer (webview), settings
- Implemented IPC handlers for: install, launch, stop, update, upgrade, manage environments
- Environment management via `envs.json` (written by setup.py) — tracks active env, type, path
- Windows NSIS installer via electron-builder (first build: 90MB)

**Launch Timeout Bug**
- Original launch used `http.get` to detect Gradio server — timed out because TCP port opens before HTTP is ready
- Fix: replaced with `net.connect` TCP port check, increased timeout to 3 minutes, added process death detection, live launch log, and cancel button

**Browser Launch Fix**
- "Launch in Browser" button was broken after an update
- Fix: separated from desktop launch flow into its own handler, uses `shell.openExternal`, reuses `currentUrl` if already running

**Terminal UI (split turn)**
- Three terminal panels added: dashboard bottom dock, installer tab toggle (Tasks / Terminal), viewer overlay
- Global log buffer (`logBuffer` array, 5000 line cap) — all `setup-output` and `launch-log` events feed in
- All three terminal bodies render from the same buffer
- Dark monospace styling with scrollable body, header, clear button

### Session 2 — Polish & Features (9 commits)

**Terminal Enhancements**
- Resize handle — drag the blue bar to resize terminal (80px min, 70vh max)
- Follow mode — auto-scrolls to bottom by default, pauses when user scrolls up, re-enables with ▼ Follow button
- Works on both dashboard and viewer terminals independently

**System Hardware Card**
- CPU, RAM, GPU, VRAM detection on dashboard
- Windows: WMI (`wmic cpu`, `wmic memorychip`, `wmic path win32_VideoController`) + `nvidia-smi` fallback
- macOS: `sysctl` + `system_profiler`
- Linux: `/proc/cpuinfo`, `free -h`, `lspci`, `nvidia-smi`

**Auto-Updater**
- `electron-updater` wired to GitHub releases at `GKartist75/wan2gp-desktop`
- Auto-checks for updates on startup (5s delay)
- Update banner with Download button and live progress bar
- Install & Restart flow
- GitHub token config in Settings for private repo auto-updates

**Bug Fixes**
- `electron-builder.yml` had `'!node_modules/**/*'` excluding all node_modules — removed
- `extraResources` for `electron-updater` put it outside app asar — removed
- Added `fs-extra` as direct dependency

**Task Progress Fix**
- `detectPhase()` was using `.toLowerCase()` patterns that didn't match actual `setup.py` output
- Rewritten to match exact format: `[1/3] Preparing Environment:`, `[2/3] Installing Torch:`, `>>> Running: ...triton...`, `Automatic Install Complete!`
- Tasks now properly advance from pending → running → done

**Hardware Display During Install**
- CPU, RAM, GPU, VRAM shown in a card above the task list during install
- GPU profile detected and displayed (`RTX_40`, `MPS`, etc.) from setup.py's `Hardware Profile:` output

**Expanded Env Card**
- From 6 to 14 package versions: Python, Torch, CUDA, Triton, Sage Attn, Flash Attn, Diffusers, Transformers, Gradio, Accelerate, onnxruntime, OpenCV, PEFT, huggingface_hub
- All detected via `importlib.metadata.version()` in the active Python environment

**Browser Picker**
- Clicking "↗ Launch in Browser" opens a modal listing all detected browsers
- Detection: Chrome, Firefox, Edge, Brave, Opera, Vivaldi + Yandex (Windows); Safari, Chrome, Firefox, Brave (macOS); google-chrome, chromium-browser, firefox, brave-browser (Linux)
- "Remember my choice" saves browser preference to `desktop-config.json`
- Launches via direct executable path (bypasses OS default)

**Private Repo Auth Handling**
- `electron-updater` fails with 401/403 for private repos without a token
- Error banner shows *"Private repo — need GitHub token in Manage settings"* instead of raw error
- Settings page has GitHub token input with link to create a classic token with `repo` scope

**Environment Type Selector**
- Before install starts, user picks: `venv` (default, bundled with Python), `uv` (faster), or `conda`
- Selection passed as `--env` arg to `setup.py install --env $TYPE --auto`
- Mirrors the same choice from Wan2GP's `install.bat` / `install.sh` scripts

**HuggingFace Fix**
- Warning *"hf_xet package is not installed"* appeared when downloading models from repos with Xet storage enabled
- Fix: post-install step runs `pip install huggingface_hub -q` after setup.py completes
- `huggingface_hub` is a transitive dependency of diffusers/transformers but sometimes gets skipped

**README & Release**
- Full README.md with docs, architecture, changelog
- Version badge `v1.0.0` in app title bar
- Package.json metadata set (author, repo, description)
- GitHub Release v1.0.0 published with installer `.exe` + `.blockmap`

## License

MIT
