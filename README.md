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
- **Launch in Desktop mode.** Click **Launch Wan2GP in Desktop** (green button) — Wan2GP opens inside the launcher with full browser controls (back/forward/reload, zoom 25%–200%) and a popout button to tear it into its own window. The floating terminal follows you; toggle it with Ctrl+` or the topbar button.
- **Launch in Browser mode.** Click **Launch Wan2GP in Browser** (amber button) — Wan2GP runs in a visible cmd window, your browser auto-opens when the server is ready. Or click **Launch in Chrome (no GPU script)** to free VRAM for generation.
- **Running LED & Stop button.** A green LED in the topbar lights up when Wan2GP is running; click the **Stop** button to kill the server.
- **Dockable Console.** The server log is always visible. Toggle it from the topbar **Console** button and dock it to bottom, left, top, or floating. Drag floating mode by the header.
- **Live topbar sparklines.** CPU/GPU/RAM/VRAM usage in the topbar with mini line charts — continuous real-time monitoring without opening anything.
- **Browser detection & default picker.** The launcher detects every installed browser (Chrome, Edge, Firefox, Brave, Opera, Vivaldi) and lets you pick which one to use for browser launches — no more forcing the OS default.
- **Keyboard shortcuts.** Ctrl+\` toggles the floating terminal, Esc or Ctrl+W closes the in-app webview. No menu digging.
- **Floating terminal enhancements.** Search logs by keyword, export the full console to a file, and drag the resize handle to grow/shrink the panel.
- **Refresh button.** One-click refresh for dashboard, hardware detection, and all live metrics — no full restart needed.
- **Stay informed.** Live server log, RAM/VRAM metrics, and a 27-package version overview with one-click installs.

> New in v2.1.7: Fixed a critical **blank/gray-screen on launch** (installer was mis-nested under the dashboard and collapsed to 0×0). Also fixed installer model-folder paths being ignored, live topbar metrics not starting on a fresh install, and the empty installer console. See changelog.

> New in v2.1.5: System tray integration, window state persistence, auto-start with Windows, follow system theme, desktop notifications when server is ready/stops, and an F12 popup picker to choose between inspecting embedded Wan2GP content or the Electron shell. See changelog.

> New in v2.1.3: **Launch in Desktop** is back — Wan2GP runs inside the launcher with full nav controls (back/forward/reload, zoom, popout), plus a dockable console panel, running LED, and stop button.

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
4. **Launch:** Click **Launch Wan2GP in Desktop** (green) to run inside the launcher, or **Launch Wan2GP in Browser** (amber) to open in your browser.
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
- **v2.1.7** — **Bugfix release** — fixes a critical blank/gray-screen on launch (installer mis-nested under the dashboard collapsed to 0×0), installer model-folder paths (ckpts/loras/output) being ignored/defaulted, live topbar metrics (CPU/GPU/RAM/VRAM) not starting on a fresh install, and the empty installer console. See [CHANGELOG-v2.1.7.md](CHANGELOG-v2.1.7.md).
- **v2.1.6** — **Bugfix release** — tray icon properly destroyed on quit, child processes killed reliably via `taskkill /f /t`, single-instance lock prevents duplicate launchers, window close now quits app. See [CHANGELOG-v2.1.6.md](CHANGELOG-v2.1.6.md).
- **v2.1.5** — **System tray** — minimize to tray (close hides to tray, context menu with Show/Hide, Stop Server, Quit). **Window state persistence** — remembers position, size, and maximized state across sessions. **Auto-start with Windows** — toggle in Settings → Desktop via `app.setLoginItemSettings()`. **Follow system theme** — auto-switch dark/light based on Windows theme setting. **Desktop notifications** — native notification when Wan2GP server is ready or stops (toggleable in Settings). **F12 DevTools picker** — popup menu to choose between inspecting embedded Wan2GP content or the Electron shell. **Orphan DevTools cleanup** — DevTools windows closed on quit to prevent orphan renderer processes. **Release automation** — `scripts/release-win.sh` handles the full bump→commit→tag→push→build→API-upload flow. See [CHANGELOG-v2.1.5.md](CHANGELOG-v2.1.5.md).
- **v2.1.4** — **Live topbar sparkline charts** — CPU/GPU/RAM/VRAM usage with mini canvas sparklines in the topbar, updated every poll cycle. **Browser detection + default picker** — detects Chrome, Edge, Firefox, Brave, Opera, Vivaldi; pick your default in Manage → General → Default Browser. **Keyboard shortcuts** — Ctrl+` toggles floating terminal, Esc / Ctrl+W closes the in-app webview. **Floating terminal enhancements** — search by keyword, export full log to file, drag resize handle to grow/shrink. **Refresh button** — one-click re-polls dashboard, hardware, and live metrics. **Developer Tools toggle** in Manage → General (Electron menu is hidden). **Default terminal dock position** — configure where the terminal opens (bottom/left/top/right/minimised). **GPU detection rewrite** — direct `nvidia-smi`/`powershell`/`system_profiler`/`lspci` calls instead of fragile Python `-c` wrapper. **Already-running detection** — port check returns instantly if Wan2GP is already serving (from Desktop or a prior browser launch). **Electron GPU toggle** in Manage → General — disable hardware acceleration to free VRAM for Wan2GP (restart required). **Path panel layout fix** — `\u200B` garbage replaced with real zero-width spaces; layout changed to horizontal row with flex-wrap. **Button colors** — Desktop green, Browser amber, no-GPU muted. **Button renamed** — "Launch in Chrome (no GPU script)" always uses Chrome with GPU-disabling flags; auto-disables with hint when Chrome isn't installed.
- **v2.1.3** — Launch Wan2GP inside the app via **Electron BrowserView** (replaces `<webview>` which is blank on Electron 40; `<iframe>` hits Gradio `manifest.json` 404). BrowserView intercepts `/manifest.json` to serve a stub PWA manifest, fixing the blank-page bug. **Persistent _bv** — the view is kept alive between toggles; no destroy+recreate prevents the blank-paint race on 2nd Desktop launch. **Manage panel** detaches the BrowserView + opaque backdrop so the panel renders IN FRONT of Wan2GP (covers, doesn't shrink). **Back-to-dashboard button** with full reattach flow. Nav controls (back/forward/reload), zoom slider (25%–200%), popout to separate window (returns to dashboard when closed). Dockable console panel (bottom/left/top/floating). Running LED + stop button. Cleaner topbar layout.
- **v2.1.2** — Fix: installer uses Python 3.11 (via uv) instead of falling back to 3.14; resolves `pygame`/kernel build failures. Compacted + ease-of-use focused README.
- **v2.1.1** — HuggingFace token support, remembered tokens, update-button fix.
- **v2.0** — Full rewrite as pure launcher (see [CHANGELOG-v2.0.md](CHANGELOG-v2.0.md)).

## License
MIT
