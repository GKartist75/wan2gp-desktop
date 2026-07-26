# Wan2GP Desktop Launcher v2.1.4 — Release Notes

## Overview

Live system monitoring in the topbar (CPU/GPU/RAM/VRAM sparklines), full browser detection + default picker, keyboard shortcuts, floating terminal search/export/resize, Electron GPU toggle, GPU detection rewrite (no more Python-wrapper fragility), already-running detection, and the no-GPU Chrome launch button.

---

## ✨ New Features

### Live Topbar Sparklines
- **CPU/GPU/RAM/VRAM** mini canvas line charts in the topbar, updated every metrics poll cycle.
- Real-time percentage readings next to each sparkline.
- Hover tooltips show the metric name.

### Browser Detection + Default Picker
- **Detects** Chrome, Edge, Firefox, Brave, Opera, Vivaldi installations on all platforms (Windows, macOS, Linux).
- **Shows detected browsers** in Manage → General → Default Browser with radio-button selection.
- **"Launch in Browser"** uses the chosen default (or the OS default if "System" is selected).
- **"Launch in Chrome (no GPU script)"** always uses Chrome regardless of the default setting — the no-GPU flags are Chrome-specific.

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| Ctrl + `` ` `` | Toggle floating terminal |
| Escape | Close in-app webview / return to dashboard |
| Ctrl + W | Close in-app webview |

### Floating Terminal Enhancements
- **Search bar** — filter log entries by keyword (case-insensitive, live filtering).
- **Export button** — downloads the full log buffer as `wan2gp-console.log`.
- **Resize handle** — drag the bottom edge of a docked terminal (top/bottom position) to resize; range 80px–60% of window height.
- **Server status dot** — green/red indicator in the floating terminal header.

### Refresh Button
- One-click button in the topbar re-polls: dashboard data, hardware detection, and system metrics (RAM/VRAM free numbers + sparkline tick).

### Developer Tools Toggle
- Manage → General → "Toggle Developer Tools" button.
- Opens Chromium DevTools on the BrowserView (when Wan2GP is embedded) or on the main window (when on dashboard).
- Rescue path since the Electron menu (File/Edit/View/Window) is hidden.

### Default Terminal Dock Position
- Manage → General → Floating Terminal Default: radio buttons for bottom, left, top, right, or minimised.
- When set to "minimised", the terminal stays closed until you manually toggle it.

### Already-Running Detection
- `checkPort('localhost', port)` performs a TCP socket connect before spawning a new Wan2GP process.
- If Wan2GP is already serving (from a prior Desktop launch or an external launch), the UI connects immediately without starting a duplicate process.
- Applies to both browser launch and in-app Desktop launch.

### Electron GPU Toggle
- Manage → General → "Enable GPU acceleration" checkbox.
- Calls `app.disableHardwareAcceleration()` at startup when unchecked.
- Requires restart to take effect. Frees VRAM for Wan2GP generation.

### Button Colors & Naming
- **Desktop mode** — green button (`launch-green`).
- **Browser mode** — amber button (`launch-amber`).
- **No-GPU Chrome** — muted/grey button (`launch-muted`).
- Button label: "Launch in Chrome (no GPU script)".
- Auto-disables with a hint message when Chrome is not installed.

---

## 🔧 Changes

### GPU Detection Rewrite (`detect-gpu`)
- **Before:** a fragile `python -c "..."` one-liner via `sysPython()` that broke when the first `python` on PATH was an unrelated venv (e.g. a bundled agent venv) whose multi-line `-c` quoting failed, yielding `{vendor: ''}`.
- **After:** direct shell commands per platform:
  - **Windows:** `nvidia-smi` → `powershell Get-CimInstance Win32_VideoController` fallback.
  - **macOS:** `system_profiler SPDisplaysDataType | grep "Chipset Model"`.
  - **Linux:** `nvidia-smi` → `lspci | grep "VGA\|3D"` fallback.
- Cleaner vendor classification (NVIDIA/AMD/APPLE/INTEL/UNKNOWN).

### No-GPU Chrome Launch
- Three-tier fallback:
  1. Wan2GP repo's canonical script (`scripts/start-chrome-no-gpu.{bat,sh}`).
  2. Vendored script in the launcher's own `scripts/` directory.
  3. Inline Chrome launch with `--disable-gpu --disable-gpu-compositing --disable-accelerated-2d-canvas --disable-accelerated-video-decode --use-angle=swiftshader --enable-unsafe-swiftshader --disable-webgpu`.
- Uses `spawn` + `detached` + `unref()` (not `exec` + `start`) to avoid Windows quoting errors.

### Config Changes
- New config keys (defaults):
  ```json
  { "defaultBrowser": "system", "termDockDefault": "bottom", "electronGpu": true }
  ```

### Paths Panel
- Layout changed from `flex-direction: column` to horizontal `flex-direction: row` + `flex-wrap: wrap` — paths stay on one line when short.
- Literal `\u200B` garbage strings replaced with real zero-width space characters.
- Path buttons redesigned (smaller, transparent background, no border).

### main.js
- Added `os` module import.
- Added `WELL_KNOWN_BROWSERS` constant (6 browsers with multi-platform paths).
- New functions: `expandEnv()`, `findChrome()`, `checkPort()`.
- New IPC handlers: `detect-browsers`, `launch-browser`, `launch-browser-no-gpu`, `chrome-available`, `launch-webview`, `popout-webview`, `toggle-devtools`, `bv-set-dock`.
- `loadConfig()` returns new defaults (`defaultBrowser`, `termDockDefault`, `electronGpu`).
- Startup reads `electronGpu` from config and calls `app.disableHardwareAcceleration()` when false.

### renderer/app.js
- Added: `loadBrowserList()`, `toggleFloatingTerm()`, `_resizeMove`/`_resizeEnd` for terminal resize, keyboard event listener (Ctrl+`` ` ``, Esc, Ctrl+W).
- `refreshBtn` handler re-polls dashboard + hardware + metrics.
- `devToolsBtn` handler.
- `browserRefreshBtn` handler.
- Terminal dock radio button handlers (persist to config).
- Log search (`logSearch input`) and export (`logExportBtn`).
- Server status indicator update on `wangp-exit` event.

### renderer/index.html
- Settings panel: Default Browser section with dynamic radio list, Floating Terminal Default section, Developer Tools button, Electron GPU toggle.
- Topbar: `#topbarMetrics` section with 4 sparkline canvases + value spans, `#wvControls` with nav/zoom/popout/ft-toggle, `#stopWangpBtn`, `#refreshBtn`.
- Right column: three launch buttons (amber Browser, muted no-GPU, green Desktop), `#noGpuHint` message.
- Floating terminal: added `#ftServerStatus` (green/red dot), `#logSearch` input, `#logExportBtn` button, `.floating-term-resize` handle.

### renderer/style.css
- Added: `.launch-btn.launch-green/launch-amber/launch-muted` (light + dark theme), `.topbar-metrics`, `.metric`, `.metric-spark`, `.metric-val`, `.wv-controls`, `.zoom-slider`, `.zoom-label`, `.running-led`, `.led-dot`, `.led-running`, `.led-stopped`, `.browser-list`, `.browser-opt`, `.toggle-row`, `.floating-term` (5 dock variants), `.floating-term-header`, `.floating-term-actions`, `.ft-status`, `.ft-status-dot`, `.ft-search-row`, `.ft-search`, `.floating-term-resize`, `.settings-overlay.opaque`.
- Refactored `.path-btn` and `.spec-row-path` styles for the new horizontal layout.

---

## 🐛 Bug Fixes

- **GPU detection silent failure** — when `sysPython()` returned a python from an unrelated venv, the multi-line `-c` quoting would break silently, returning `{vendor: ''}`. Fixed by replacing the Python wrapper with direct shell commands.
- **Windows quoting errors** in `exec` + `start` shell commands for browser and no-GPU launches. Fixed by using `spawn` + `detached` + `unref()`.
- **Path panel `\u200B` garbage** — literal backslash-u escape sequences rendered instead of real zero-width spaces. Fixed by replacing the strings with actual Unicode zero-width space characters.
- **Duplicate Wan2GP processes** — when toggling between Desktop and browser launch, both attempted to start Wan2GP. Fixed by adding `checkPort()` before spawning.

## 📋 Changelog

See [README.md](README.md) for the full feature list.
