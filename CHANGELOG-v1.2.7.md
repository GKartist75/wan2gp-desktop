# Wan2GP Desktop v1.2.7 — Release Notes

## Overview
Desktop launcher for [Wan2GP](https://github.com/deepbeepmeep/Wan2GP) — the video generation AI toolkit.

---

## Changes & Fixes

### Installer & Build System
- **NSIS installer redesigned** — Welcome page shows app description, no license/agreement page required
- **Installer layout** — no Tasks/Terminal tabs, task list in 200px left column, terminal always visible on right
- **Install button white text fix** — dark accent color changed from `#FFFFFF` to `#666666`
- **Reinstall choice UI** — three buttons instead of raw `confirm()`: Reinstall / Update & keep files / Use existing
- **autoDownload enabled** — `autoUpdater.autoDownload = true`, updates auto-download in background
- **Shift+click for local update testing** — passes `{ local: true }` to `check-update` IPC for testing against `http://localhost:8888`

### Dashboard
- **Desktop App info card** — shows version, commit hash, repo link
- **Model Folders card** — shows checkpoints + LoRAs paths with ✎ (change) button
- **Button labels clarified** — "Launch Wan2GP in Desktop" (blue primary), "Launch Wan2GP in Browser", "Check Desktop Updates"
- **Removed redundant Refresh** from Environments card
- **Check Updates button moved** from right column to center action grid
- **Desktop App card restyled** — matches Wan2GP Updates card format (`changelog-card`)
- **Dark theme default** — `loadConfig()` returns `theme: 'dark'`, `<html>` has `data-theme="dark"` for white-flash prevention

### Manage Panel
- **Reordered** — Reinstall → Uninstall Environment → Uninstall Wan2GP → Upgrade PyTorch/Attention Kernels → Log → GitHub Token
- **Uninstall Environment** — removes venv only, keeps repo and data intact
- **Uninstall Wan2GP** — removes everything Wan2GP. Uses native Windows dialogs for:
  - Backup prompt (plugins/finetunes)
  - Keep/delete prompts (output/checkpoint/lora folders)
  - Cancel at any step
- **Upgrade Components** — moved back to Manage panel from Dashboard

### Webview / Wan2GP Integration
- **h265 video + WebSocket stability fixed** — removed `app.disableHardwareAcceleration()` which was causing connection drops and hardware decode issues
- **`disablewebsecurity partition="persist:wan2gp"`** — added to `<webview>` tag for cross-origin file access
- **Native right-click context menu** — via `app.on('web-contents-created')` using Electron's `Menu`/`MenuItem` API. Removed broken `executeJavaScript` forwarder approach
- **Python subprocess fixes** — all spawn calls now use `-u` + `PYTHONUNBUFFERED=1` + `HF_HUB_DISABLE_PROGRESS_BARS=1` for stable output
- **Auto-restart** — Wan2GP process auto-restarts on crash with drop handler re-injection after 2.5s delay
- **Keep process alive** — "Back to Dashboard" no longer calls `stop()`. "Launch Wan2GP in Desktop" checks `isRunning()` first to avoid duplicate launches
- **`is-running` IPC handler** — exposed in preload for renderer use
- **Viewer terminal panel** — WanGP stdout/stderr piped to a resizable terminal panel, opens automatically
- **Removed "Open in Browser" button** from viewer toolbar
- **Window opens maximized** — `mainWin.maximize()` on `ready-to-show`

### Output Sidebar (New Feature)
- **Collapsible left panel** with toggle button
- **Folder navigation** — browse subdirectories, parent folder entry to go up
- **File list with thumbnails**
  - Images: loaded via IPC → decoded to blob URL
  - Videos: show 🎬 icon (no frame extraction to keep it fast)
  - Event delegation on container — no per-item listeners (no memory leak on re-render)
- **Auto-poll removed** — no more `setInterval(refreshSidebar, 3000)`. Replaced with:
  - `fs.watch` on output directory (main.js, 500ms debounce) → sends `output-files-changed` IPC
  - Manual ⟳ Reload button (currently hidden)
  - Folder navigation also triggers refresh
- **Thumbnail load throttled** — 5 files at a time, 100ms apart to prevent IPC flood and UI freeze
- **Thumbnail LRU cache** — max 20 entries, blob URLs (lower memory overhead), evicted entries properly revoked
- **File selection** — click to select (highlighted), double-click to open preview overlay
- **Metadata display** — collapsible JSON section in preview, from:
  1. PNG iTXt chunk binary parse (zero dependencies)
  2. JSON sidecar file
  3. Python `get_settings_from_file()` via async subprocess (fallback)
- **Bottom buttons (currently hidden)** — Delete, Load in WanGP, Reload, Dropzone

### Preview Overlay
- **File preview** — images and videos via double-click on sidebar file
- **Zoom in/out/reset** — buttons + keyboard shortcuts
- **Pan by dragging** — click and drag to pan zoomed images
- **Close via X button or backdrop click**
- **Metadata display** — collapsible `pre` section with full JSON from WanGP settings

### Freeze Fixes (Critical Bugs)

#### Bug 1: Preview close freeze — `execSync` blocking main process
- **Symptom**: Closing preview overlay froze the entire app for 1-2 seconds, overlay became transparent
- **Root cause**: `read-file-metadata-python` IPC handler used `execSync()` to run Python → blocked main process event loop for 500ms-2s while Python started up. No IPC responses, no UI updates, no event processing during this time
- **Fix**: Replaced `execSync` with `exec()` wrapped in a Promise (`await new Promise`). Main process stays responsive during Python execution

#### Bug 2: Preview close freeze — async callbacks applying after user closed
- **Symptom**: Even after overlay was hidden, later async callbacks set `img.src` to a 13MB data URL string, freezing Chromium's render thread while decoding
- **Root cause**: Race condition — `readLocalFile` IPC response arrived after user closed preview → `.then()` callback ran anyway → set massive `data:` URL on hidden element → Chromium blocked parsing it
- **Fix**: Added `_previewAlive` flag. Set `false` in `closePreview()`. All async `.then()` callbacks check `_previewAlive` before touching DOM. Stale responses silently dropped

#### Bug 3: Preview close freeze — massive data URLs
- **Symptom**: 13MB base64 data URLs in `img.src` caused render thread blocking
- **Root cause**: `data:` URLs embed entire file as base64 inline. Chromium must parse the entire string synchronously to render
- **Fix**: Switched to `URL.createObjectURL(blob)` for both images and videos. Blob URLs are instant to create and free. Tracked via `_previewFileUrl` for proper cleanup on close

#### Bug 4: Memory leak — unbounded thumbnail cache
- **Symptom**: App RAM usage grew over time, stayed high
- **Root cause**: `thumbCache` stored full `data:` base64 URLs for every file ever seen. Each AI-generated image was 5-10MB as base64. 50+ files = 250-500MB permanently retained JS strings
- **Fix**: 
  - `data:` URLs → `blob:` URLs (lower memory overhead, properly freeable)
  - Cache capped at 20 entries (LRU eviction)
  - Evicted entries have blob URLs `URL.revokeObjectURL()`'d

### Drag-Drop (Code Implemented, Disabled for Investigation)
- **Synthetic drop approach**: Both "Load in WanGP" button and sidebar drag-drop create `new DragEvent('drop', { dataTransfer: dt })` on Gradio's native `<button[aria-dropeffect="copy"]>` element
- **Gradio Upload pipeline**: Synthetic drop triggers Gradio's Upload.svelte handler → reads `e.dataTransfer.files` → POSTs to `/upload` → emits `load` → FileUpload sets value → fires `change`/`upload` → backend calls `load_settings_from_file`
- **IPC drag path bridge**: Sidebar `dragstart` stores path via `setPendingDragPath` IPC → webview `__getPendingDragPath()` retrieves it when `getData('text/plain')` fails cross-context
- **`dragover` fix**: Uses `e.dataTransfer.types` array instead of `dataTransfer.getData()` (which returns empty during dragover per security spec)
- **`stopImmediatePropagation()`**: Prevents Gradio from seeing the raw `text/plain` dataTransfer, then dispatches synthetic drop on the actual button with a proper File object
- **Currently disabled** — both `injectWebviewDropHandler` calls commented out. Re-enable when drag-drop behavior is ready for testing

### Hardware & Configuration
- **Hardware-tuned defaults**: `getHardwareDefaults()` detects GPU/RAM/VRAM on first launch, sets:
  - Attention backend (sdpa/flash_attn/xformers)
  - Torch compile mode
  - Profile (fast/high_quality)
  - Model hierarchy (teacache/cache)
- **20+ WanGP config keys** set via `setdefault` in `write-wgp-config`
- **Data directory pinned**: `~/.wan2gp-desktop-data-dir` written on first `app.whenReady()`

### IPC Handlers (Complete List)
- `read-local-file` — reads file from disk, returns base64 + name + size + mime
- `read-file-metadata` — parses PNG iTXt comment chunk or JSON sidecar
- `read-file-metadata-python` — async Python subprocess via WanGP's `get_settings_from_file()`
- `copy-files-to-output` — copies dropped files to output dir with rename-on-conflict
- `list-output-files` — directory listing sorted by mtime, filtered to image/video
- `delete-files` — deletes with sidecar cleanup (.json, .txt)
- `set-output-path` — change output directory
- `get-model-paths` — reads checkpoint/LoRA paths from `wgp_config.json`
- `is-running` — checks if WanGP child process is alive
- `set-pending-drag-path` / `get-pending-drag-path` — IPC drag bridge for cross-context
- `get-desktop-git-info` — returns git commit hash, date, message
- `upload-to-gradio` — POSTs file to WanGP's internal `/upload` endpoint
- `detect-hardware` — GPU model/VRAM, total RAM detection
- Plus all standard install/manage/update/uninstall handlers

## Files Changed
```
README.md           — updated description, removed "0 MB VRAM"
main.js             — hardware accel removal, webview flags, IPC handlers, async Python reader, fs.watch, context menu, auto-restart, config defaults
preload.js          — exposed new IPC handlers (readLocalFile, onOutputFilesChanged, copyFilesToOutput, isRunning, setPendingDragPath)
webview-preload.js  — new file: __readLocalFile + __getPendingDragPath via IPC
renderer/app.js     — sidebar, preview overlay, event delegation, thumbnail cache (LRU+blob), freeze fixes, auto-poll removal, _previewAlive guard
renderer/index.html — sidebar HTML, preview overlay, preview close/meta, test badges, layout
renderer/style.css  — sidebar styles, preview overlay styles, dark theme
package.json        — version bump to 1.2.7, electron-builder config
electron-builder.yml — NSIS installer with nsis.nsh, include patterns for preload/webview-preload
resources/nsis.nsh  — new file: custom NSIS Welcome page text
```

## Known Disabled Features (Code Exists, Not Active)
- **Drag-drop into Wan2GP** — `injectWebviewDropHandler` calls commented out. Synthetic drop approach implemented but needs investigation
- **Sidebar bottom buttons** — Delete, Load in WanGP, Reload, dropzone hidden with `display:none`. Ready to re-enable when tested
