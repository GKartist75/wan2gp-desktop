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

### v1.2.6 — 2026-07-04

**One folder for everything** — no more AppData roaming clutter, install paths simplified.

- **Merged data dir + repo** — Wan2GP install location is one browse button. Repo lives at `Repo_Wan2GP/` inside it automatically. Removed separate repo path picker.
- **Zero AppData roaming** — Electron runtime data (Cache, blob_storage, etc.) redirected into `.electron/` subfolder under chosen install location. Nothing left in `%APPDATA%`.
- **Renamed "App data" → "Wan2GP install location"** — clearer label in installer and dashboard.
- **Renamed `repo/` → `Repo_Wan2GP/`** — more descriptive subfolder name.
- **Phase detection fix** — `emit()` now buffers lines before checking for phase markers. Fixes tasks stuck on "pending" when stdout chunks split across data events.

### v1.2.5 — 2026-07-03

**Public repo** — auto-updater works without auth token now.

- Removed `private: true` from publish config and `setFeedURL` calls.
- Token is now optional (avoids rate limits, not required for auth).
- Error message updated from "Private repo" to "GitHub rate limited".
- Settings label/hint updated to reflect public repo.

### v1.2.4 — 2026-07-03

**Real-time RAM/VRAM stats enabled by default** — Wan2GP now shows live memory stats out of the box.

- `display_stats=1` written to `wgp_config.json` on install and config writes.
- Only set if not already disabled by user (respects explicit opt-out via Wan2GP UI).
- Works alongside model folder configuration (checkpoints_paths, loras_root).

### v1.2.3 — 2026-07-03

**Release build** — all fixes from this session shipped.

- v1.2.0: 10 bugfixes (env dot, manage-delete paths, fetchUrl errors, listener leak, etc.)
- v1.2.1: Webview crash fix (removed setZoomFactor, added crash handler)
- v1.2.2: Zero VRAM for Electron (app.disableHardwareAcceleration)
- v1.2.3: Release packaging

### v1.2.2 — 2026-07-03

**Zero VRAM for Electron** — all GPU memory reserved for Wan2GP generation.

- `app.disableHardwareAcceleration()` forces Electron to use SwiftShader (CPU software rendering).
- Electron + webview use software rendering — no GPU VRAM overhead for the desktop shell itself.
- Webview rendering is imperceptibly slower (Gradio UI is mostly static between generations).

### v1.2.1 — 2026-07-03

**Webview crash fix** — embedded viewer no longer crashes during GPU-intensive generation.

- **Root cause** — `setZoomFactor(0.5)` forced a non-standard GPU compositing path that crashed under GPU memory pressure during generation.
- **Removed** `setZoomFactor(0.5)` from all three locations (launch, restart, auto-restart).
- **Added** webview crash handler — auto-reloads up to 3x with log, then shows restart overlay.
- External browser and standalone were never affected because Chrome has its own GPU process with proper OOM handling.

### v1.2.0 — 2026-07-03

**Bugfix & hardening release** — 10 issues fixed across main, renderer, preload.

- **Env dot fix** — environment list indicator was invisible (CSS class mismatch `env-list-dot` vs `env-dot`).
- **Orphaned env dirs** — `manage-delete` now resolves relative env paths against repo dir before cleanup (was checking CWD).
- **Listener leak** — `doLaunch()` registered a new `onLaunchLog` listener per launch without cleanup. Now cleaned in `finally`.
- **Update banner dismiss** — race condition could leave update banner stuck after re-check.
- **fetchUrl error handling** — rejects on non-2xx HTTP responses instead of silently parsing 404/403 bodies.
- **uncaughtException handlers** — added process-level error handlers for crash resilience.
- **URL validation** — `open-external` IPC validates URL format before opening.
- **Dead code removed** — unused `#browserModal` DOM (~40 lines), `fs-extra` dependency (200KB), `nul` artifact.
- **package.json** — trailing comma fix, fs-extra removed.

### v1.1.9 — 2026-07-03

**Live launch progress** — real-time startup status with progress bar and timer.

- **Progress bar** — fills as Python process reports milestones (loading models, starting server).
- **Live status** — shows current step: "Initializing engine", "Loading models", "Starting server", "Ready".
- **Elapsed timer** — counts up so user knows how long startup takes.
- **First-run notice** — explains that initial model load + CUDA compilation is normal.
- **Pattern parsing** — reads actual Python stdout to drive progress instead of fixed steps.

### v1.1.8 — 2026-07-03

**Model folder configuration** — assign existing ckpts and LoRAs folders during install.

- **Checkpoints path** — browse + clear button to set folder with existing model ckpts/safetensors.
- **LoRAs path** — browse + clear button to set root folder for LoRA subdirectories (wan/, hunyuan/, etc.).
- **wgp_config.json** — paths written to Wan2GP config after install so existing models are reused.
- **Persistent** — paths saved in desktop config, restored on page load.

### v1.1.7 — 2026-07-03

**Auto-restart on crash** — Wan2GP server stays alive after generation inside desktop webview.

- **Auto-restart** — if Wan2GP process exits while viewer active, auto-restarts up to 3x with progress shown.
- **Restart overlay** — shows "Server stopped" overlay instead of immediately dumping to dashboard.
- **Manual fallback** — if all retries fail, user can click "Try Again" or "Dashboard".
- **Exit tracking** — distinguishes user-initiated stop (clicking Dashboard) from unexpected crash.

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
