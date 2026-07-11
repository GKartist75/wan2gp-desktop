# Wan2GP Desktop Launcher v2.1.3 — Release Notes

## Overview

In-app Desktop mode rewritten from the ground up — Wan2GP now renders inside the launcher via Electron BrowserView instead of `<webview>` or `<iframe>`, fixing multiple blank-page bugs on Electron 40. Persistent view lifecycle eliminates the 2nd-launch black screen. Manage panel covers (doesn't shrink) Wan2GP. Back-to-dashboard, nav controls, zoom, popout. Dockable console panel with 4 positions + floating.

---

## ✨ New Features

### In-App Desktop Mode (BrowserView)
- **Electron BrowserView** replaces `<webview>` (blank on Electron 40) and `<iframe>` (Gradio `manifest.json` 404).
- **Persistent `_bv`** — the view object is kept alive between dashboard/webview toggles. No destroy+recreate means no blank-paint race on the 2nd Desktop launch.
- **Gradio manifest.json stub** — BrowserView's `webRequest.onBeforeRequest` intercepts `/manifest.json` and serves a PWA stub, fixing the Gradio 5.36.x 404 → blank page bug.
- **Back-to-dashboard button** — full reattach flow (removeBrowserView → re-add + reset bounds → reload).
- **Navigation controls** — back, forward, reload buttons in the topbar.
- **Zoom slider** — 25%–200% range, persists across navigation.
- **Popout to separate window** — opens Wan2GP in a standalone `BrowserWindow`; when closed, returns focus to the dashboard.

### Manage Panel Covers
- **Detach BrowserView** when Manage panel opens — BrowserView always composites above DOM, so removing it lets the panel render in front of Wan2GP.
- **Opaque backdrop** (`settings-overlay.opaque`) covers the now-exposed area behind the Manage panel.
- **Reattach on close** — restores the BrowserView frame without reloading the page.

### Dockable Console Panel
- **4 dock positions** — bottom (default), left, top, or floating.
- **Dock buttons** in the panel header — click to switch position instantly.
- **Floating mode** — draggable by the header, sits top-right independently.
- **Follow button** — auto-scrolls to latest log output.
- **Close button** — closes the panel; Wan2GP takes the full area again.

### Running LED + Stop Button
- **Green LED** in the topbar (`Running` label with animated dot) when Wan2GP is active.
- **Stop button** — kills the `_wangpProc` process; LED turns red/stopped.

### Topbar Layout
- Cleaner flex layout with `topbar-left` / `topbar-center` / `topbar-right`.
- `topbar-center` is absolutely positioned to keep the brand+title centered regardless of right-side controls width.

---

## 🔧 Changes

- **`main.js`** — imported `BrowserView` and `os` modules; added `_wangpProc` tracking, `_bv` lifecycle, popout window management, BrowserView resize handler.
- **New IPC handlers:** `create-browser-view`, `show-browser-view`, `hide-browser-view`, `destroy-browser-view`, `detach-browser-view`, `reattach-browser-view`, `bv-navigate`, `bv-set-zoom`, `bv-set-dock`, `launch-webview`, `stop-wangp`, `is-wangp-running`, `popout-webview`, `toggle-devtools`.
- **`preload.js`** — exposed 11 new `w2gp.*` bridge functions for BrowserView lifecycle + webview controls.
- **`renderer/index.html`** — added `#webviewContainer` (placeholder div for BrowserView area), `#floatingTerminal` with dock buttons + server status, `#wvControls` with nav/zoom/popout/terminal-toggle, `#runningLed`, `#stopWangpBtn`. Re-structured topbar from 2-column to 3-column layout.
- **`renderer/style.css`** — added styles for `.floating-term` (4 dock positions + floating), `.dock-btn`, `.wv-controls`, `.zoom-slider`, `.running-led`, `.topbar-metrics`, `.launch-overlay`, `.ft-search`, `.ft-search-row`, `.floating-term-resize`, `.settings-overlay.opaque`.
- **`renderer/app.js`** — full rewrite of in-app launch flow: `toggleWebview()`, `launchDesktop()`, `closeWebview()`, `popoutWebview()`, `toggleFloatingTerm()` with all dock/state logic. Keyboard shortcuts. BrowserView lifecycle functions: `updateNavBtns()`, `updateZoomLabel()`, log streaming via `launch-log` IPC, server exit detection.

## 🐛 Bug Fixes

- **Blank page on 2nd Desktop launch** — root cause: destroying + recreating BrowserView races async C++ compositor teardown. Fixed by keeping `_bv` alive forever; re-add + reload instead of destroy + create.
- **Blank page on first Desktop launch** — root cause: Gradio 5.36.x fails to load its PWA manifest (`/manifest.json` 404) in embedded contexts, showing a blank page. Fixed by intercepting the manifest request and serving a stub.
- **Manage panel hidden behind Wan2GP** — BrowserView always composites above DOM, so `z-index` had no effect. Fixed by detaching the BrowserView when Manage opens, showing an opaque backdrop, and reattaching on close.

## 📋 Changelog

See [README.md](README.md) for the full feature list.
