# Wan2GP Desktop

Desktop launcher for [Wan2GP](https://github.com/deepbeepmeep/Wan2GP) — the video generation AI toolkit.

[![Release](https://img.shields.io/github/v/release/GKartist75/wan2gp-desktop?style=flat-square)](https://github.com/GKartist75/wan2gp-desktop/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)]()
[![License](https://img.shields.io/github/license/GKartist75/wan2gp-desktop?style=flat-square)]()

---

## What is this?

Wan2GP Desktop is a **wrapper around Wan2GP** — it doesn't replace or modify Wan2GP itself. All generation, model loading, and UI rendering is done by Wan2GP's own Gradio server. The desktop app adds:

- **Install** — one-click clone, GPU detection, env creation, correct PyTorch/attention kernel selection
- **Maintain** — update, upgrade components, reinstall, auto-restart on crash, backup plugins/finetunes before wipe
- **Use** — embedded webview with Wan2GP's native UI, output file sidebar with preview/metadata/drag-into-settings, real-time terminal output, hardware-tuned default config (attention mode, profile, compile)

Everything Wan2GP does — models, generation, scheduling, LoRAs, finetunes — works exactly as it does when run standalone.

## Features

### Core
- **One-click install** — clones Wan2GP, creates env, detects GPU, installs correct PyTorch/CUDA/ROCm + attention kernels automatically
- **Environment choice** — pick `venv`, `uv` (faster), or `conda` before install
- **Hardware-aware** — auto-detects GPU (NVIDIA RTX 30/40/50, AMD, Apple Silicon) and selects the right wheels from Wan2GP's `setup_config.json`
- **Real-time RAM/VRAM stats** — live memory display in Wan2GP UI, enabled by default
- **Embedded viewer** — runs Wan2GP Gradio UI inside a webview tab in the desktop app
- **External browser** — pick any installed browser (Chrome, Firefox, Edge, Brave, Opera, Vivaldi) with optional default preference
- **Webview crash resilience** — auto-reloads on GPU crash, no more frozen screens
- **Server auto-restart** — Wan2GP process restarts automatically on unexpected exit (up to 3 tries)
- **Live launch progress** — progress bar, status messages, and elapsed timer during startup
- **Model folder config** — set checkpoints and LoRAs paths during install, written to `wgp_config.json`
- **Configurable install path** — choose where the Wan2GP repo lives before installing

### v1.2.8 — Features

#### 🪟 Floating / Dockable Terminal
- Separate floating `BrowserWindow` for live Wan2GP logs
- Dockable top / bottom / floating — position persisted to `desktop-config.json`
- Ring buffer (2,000 lines) — full log history on open
- Follow mode, ANSI stripping, clean monospace display
- Auto-opens on launch; closes cleanly when returning to dashboard
- Mutual exclusion — inline and floating terminal cannot both be open

#### 📋 Metadata Panel (Prompt Manager style)
- **Two-stage reader**: Node.js native (brute-force binary JSON scan) → Python fallback (PIL Exif, ffprobe, Wan2GP `get_settings_from_file`)
- Handles ALL file formats — PNG iTXt, JPEG Exif UserComment, MP4 ©cmt tags, MKV COMMENT, audio ID3
- Zero external dependencies for the primary reader — scans file head/tail for JSON blocks, validates against Wan2GP keys
- Generation settings displayed in an HTML table with per-row copy buttons
- Click any row to send the file to Wan2GP (click-to-inject)
- Inline prompt text in sidebar file rows, batch-loaded 5 at a time
- Metadata is cached — repeated clicks are instant, no Python spawn
- Raw JSON comment dump at the bottom for full data access

#### 📤 Send to Wan2GP
- **Synthetic drop** on Gradio's "Load Settings from Media File" component
- Uses cached metadata → creates inline `.json` file → drops on component (instant, no disk read)
- Falls back to reading the media file via IPC when cache is cold
- Triggers the FULL Wan2GP settings pipeline — model, prompt, seed, steps, guidance, resolution, LoRAs — everything updates
- Three action buttons per file: **Send** (load settings), **Variation** (load + random seed), **Prompt + New Seed**
- Drag-drop from sidebar onto webview uses the same reliable pipeline
- Windows Task Manager button in both dashboard and viewer toolbar

#### 💾 Prompt Library
- Save prompts from within the sidebar
- Click to inject into Gradio textarea
- Capped at 200 saved prompts, persisted in config

#### 🎛️ Sidebar Overhaul
- Sort by name or date (ascending/descending)
- Filter chips: Image / Video / Audio / All
- Date range filter: Today / This Week / This Month / All
- Adjustable thumbnail zoom (24–80px)
- Resize handle — drag sidebar width (180–500px), persisted
- Column dividers — drag to resize prompt / date / filename columns
- Prompt displayed first, then date, then filename
- Prompt increased to 200 chars, bigger font for prompt + date, smaller for filename
- Collapse toggle — hidden sidebar consumes zero resources (watcher stopped)
- Instruction hint at top: "Select image/video and drag & drop..."
- Multi-select with Ctrl+Click
- Context menu: Copy path, Open in Explorer, Delete (fixed — now correctly reports success)

#### ⚙️ Settings Tabs
- Tabbed layout: General / Launch / About
- Launch tab with extra `launchArgs` field — persisted to `desktop-config.json`
- Customize Wan2GP startup flags (e.g. `--server-port`, `--listen`)

#### 🎵 Audio Preview
- Preview audio files inline in the overlay
- Supports `.opus`, `.mp3`, `.wav`, `.ogg`, `.m4a`, `.flac`, `.wma`, `.aac`
- Audio files shown with 🎵 icon in sidebar

#### 🔔 Desktop Notifications
- Notification on new output file generation
- Proper permission request (`Notification.requestPermission()`)
- 1.5s debounce to prevent spam

#### 🔄 Crash Recovery
- **Race condition fix** — stale process exit handlers no longer null the new process reference
- Kill-before-spawn in both `launch` and `restartWan2GP` prevents false auto-restarts
- Guard against concurrent restart loops (`isRestarting` flag)
- Gradio polling — detects when server is back via `window.gradioConfig`
- Restart overlay with status messages per attempt

#### ⚡ Auto Port Detection
- Default port changed from 17861 to **7860** (standard Gradio port)
- `findFreePort()` — if port is occupied, automatically increments until it finds a free one
- Port conflict logged to terminal

#### 🧠 Performance & Reliability
- **ANSI stripping** on all terminal output streams
- **Desktop notifications** with `Notification.requestPermission()`
- **Non-blocking hardware detection** — all queries use async `execAsync` (15s timeout)
- **`_getVersions()`** with system Python fallback
- **`fetchUrl()`** uses global `fetch` + `AbortSignal.timeout(10000)`
- **Disk space** — free space shown on dashboard, "Open App Data folder" button
- **Reinstall backup** — preserves plugins/finetunes/config during reinstall
- **Declarative `PHASES` array** replaces old if-chain
- **Browser picker** auto-checks "Remember", quick-launch via `cfg.defaultBrowser`
- **Config memoization** via `_dataDir` cache
- **Global log buffer** — setup + launch output feeds one buffer → all screens
- **`list-output-files` includes mtime** for date display and filtering

#### 🐛 Bug Fixes
- `stop()` SIGKILL never fires — `wangpProc` nulled too early. Fixed: save ref to local before nulling.
- `readPngComment()` now handles **iTXt/zTXt** chunks (Wan2GP uses iTXt, not tEXt)
- `delete-files` returned bare `true` — renderer checked `r.ok`. Fixed: returns `{ok: true/false}`.
- Restart race condition — stale exit handler nulls new process. Fixed: kill-before-spawn in launch + restart.
- `list-output-files` O(n log n) `statSync` in sort comparator. Fixed: pre-cache `mtimeMs`.
- `runSetup()` double-spawn orphan. Fixed: kill previous `setupProc` first.
- `spawnWangp()` orphaned process. Fixed: kill `wangpProc` before spawn.
- `restartWan2GP()` reset order race. Fixed: guard comment + order.
- `delete-files()` `var` leakage. Fixed: `let`/`const`.
- `open-external` URL allowlist too narrow. Fixed: added `https://huggingface.co/`.
- `_getVersions()` command injection surface. Fixed: `JSON.stringify()`.
- Notification without permission. Fixed: `Notification.requestPermission()`.
- Terminal `style.display = 'none'` prevented re-opening inline terminal. Fixed: removed inline style, toggleTerm clears display.

### Other Features
- **Upstream changelog** — latest 5 Wan2GP commits shown in dashboard with update indicator
- **System info** — CPU, RAM, GPU, VRAM displayed on dashboard
- **Package versions** — 14 core Python packages shown in the environment card
- **Self-updating** — checks GitHub Releases for new versions, downloads and installs with one click
- **Public repo** — no token needed for auto-updates
- **Zero dedicated VRAM** — Electron uses SwiftShader by default, no GPU memory overhead
- **Resizable terminal** — live log panel with auto-scroll follow, pause on manual scroll, drag-to-resize

## Screenshots

| Dashboard | Installer | Viewer |
|---|---|---|
| System info, env card, terminal | Task list with hardware detection | Wan2GP UI with floating terminal |

👉 **[Full visual guide → infographic.html](infographic.html)** — how to install, how it works, app layout, sending files, and all features in one page.

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
├── term-preload.js         # Context bridge for floating terminal window
├── webview-preload.js      # Webview preload — file reading + Gradio upload bridge
├── serve-update.js         # Standalone HTTP server for local update testing
├── renderer/
│   ├── index.html          # UI screens (splash, dashboard, installer, viewer, settings)
│   ├── style.css           # Dark theme, terminal, modal, sidebar styling
│   ├── app.js              # All UI logic — log buffer, state management, event wiring
│   ├── read_metadata.py    # Standalone Python metadata reader (PIL/piexif/ffprobe)
│   ├── send_settings.py    # Python helper for sending settings to Wan2GP
│   └── term-window.html    # Floating terminal window UI
├── electron-builder.yml    # Build config (NSIS, DMG, AppImage + GitHub publish)
├── package.json            # Dependencies (electron, electron-builder, electron-updater)
└── resources/              # App icons
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| **Delegate to setup.py** | Desktop app does not handle GPU detection or wheel installation — runs `setup.py install --env $ENV --auto` which auto-selects correct torch/CUDA/attention kernels |
| **TCP port check** | Uses `net.connect` (not HTTP GET) to detect when Gradio server starts — port opens before HTTP is ready |
| **Global log buffer** | All setup + launch output feeds one buffer → forwarded to dashboard, installer, viewer, and floating terminal |
| **Floating terminal as separate BrowserWindow** | Always-on-top window with its own preload context, receives forwarded IPC logs |
| **electron-updater** | Checks GitHub Releases for new versions, downloads delta/exe, quits and installs |
| **Two-stage metadata reader** | Native JS brute-force JSON scan (all formats, zero deps), Python fallback for Exif/ffprobe/Wan2GP env |
| **Synthetic drop for settings loading** | Creates inline `.json` file from cached metadata and dispatches `DragEvent` on Gradio's file component — triggers full Wan2GP settings pipeline |


## Changelog

### v1.2.8 — 2026-07-07

Major feature release with complete metadata panel (Prompt Manager style), Send-to-Wan2GP via synthetic drop, floating terminal, sidebar overhaul with column resizing, auto port detection, and 14+ critical bug fixes. See features section above for full details.

### v1.2.7 — 2026-07-04

See [CHANGELOG-v1.2.7.md](CHANGELOG-v1.2.7.md) for the full v1.2.7 release notes.

### v1.2.6 — 2026-07-04

**One folder for everything** — no more AppData roaming clutter, install paths simplified.

- **Merged data dir + repo** — Wan2GP install location is one browse button. Repo lives at `Repo_Wan2GP/` inside it automatically.
- **Zero AppData roaming** — Electron runtime data redirected into `.electron/` subfolder under chosen install location.
- **Phase detection fix** — `emit()` now buffers lines before checking for phase markers.

### v1.2.5 — 2026-07-03

**Public repo** — auto-updater works without auth token now.

- Removed `private: true` from publish config. Token is now optional.

### v1.2.4 — 2026-07-03

**Real-time RAM/VRAM stats enabled by default.**

- `display_stats=1` written to `wgp_config.json` on install.

### v1.2.3 — 2026-07-03

**Release build** — v1.2.0 through v1.2.3 fixes shipped.

### v1.2.2 — 2026-07-03

**Zero VRAM for Electron** — all GPU memory reserved for Wan2GP generation.

- `app.disableHardwareAcceleration()` forces Electron to use SwiftShader.

### v1.2.1 — 2026-07-03

**Webview crash fix** — embedded viewer no longer crashes during GPU-intensive generation.

- Removed `setZoomFactor(0.5)`, added webview crash handler with 3x auto-reload.

### v1.2.0 — 2026-07-03

**Bugfix & hardening release** — 10 issues fixed.

- Env dot CSS fix, orphaned env dirs fix, listener leak fix, update banner dismiss race, fetchUrl error handling, process uncaughtException handlers, URL validation, dead code removal.

### v1.1.9 — 2026-07-03

**Live launch progress** — real-time startup status with progress bar and timer.

### v1.1.8 — 2026-07-03

**Model folder configuration** — assign existing ckpts and LoRAs folders during install.

### v1.1.7 — 2026-07-03

**Auto-restart on crash** — Wan2GP server auto-restarts up to 3x with progress shown.

### v1.1.6 — 2026-07-03

**Configurable install paths** — choose where Wan2GP repo lives.

### v1.1.5 — 2026-07-03

**Bug fixes & polish** — VRAM detection, task progress, dots only when installed.

### v1.1.4 — 2026-07-03

**Wan2GP upstream changelog viewer** — latest 5 commits in dashboard card.

### v1.1.0 — 2026-07-02

**Complete visual redesign** — warm monochrome editorial UI with light/dark toggle.

### v1.0.1 — 2026-07-02

**Env selector waits** — user picks env type before install. Task progress fixed.

### v1.0.0 — 2026-07-02

Initial release.

## License

MIT

## Testing & Feedback

Special thanks to everyone who tested beta builds and reported issues that directly shaped each release. Your feedback on freezes, crashes, and usability made the desktop launcher significantly more stable.

Want to help test future builds? Join the [Wan2GP Discord](https://discord.gg/wan2gp).
