# Wan2GP Desktop Launcher v2.1.5 — Release Notes

## Overview

System tray integration, window state persistence, auto-start with Windows, follow system theme, desktop notifications when the server is ready/stops, and improved DevTools experience with F12 popup picker.

---

## ✨ New Features

### System Tray
- **Minimize to tray** — closing the window hides it to the system tray instead of quitting the app.
- **Tray context menu** — Show/Hide window, Stop Wan2GP server (when running), and Quit.
- **Background operation** — Wan2GP keeps running in the tray even after closing the launcher window.

### Window State Persistence
- **Remembers position and size** across sessions — window x, y, width, height, and maximized state are saved to config on every resize/move.
- **Restored on next launch** — opens exactly where you left it.

### Auto-Start with Windows
- **Toggle in Settings → Desktop** — `app.setLoginItemSettings({ openAtLogin: true })`.
- Adds the launcher to Windows startup programs automatically.
- One-click disable in the same toggle.

### Follow System Theme
- **Toggle in Settings → Desktop** — when enabled, the launcher automatically switches between dark and light themes based on your Windows theme setting.
- Registers a `nativeTheme.on('updated')` listener that sends the current theme to the renderer.
- Overrides manual theme toggle when active.

### Desktop Notifications
- **Server Ready** — native Windows notification appears when Wan2GP finishes loading (in both browser mode and Desktop mode).
- **Server Stopped** — notification when the Wan2GP process exits, showing the exit code.
- **Toggle in Settings → Desktop** — opt out entirely with one checkbox.

### Improved DevTools Experience
- **F12 popup picker** — when Wan2GP is embedded (Desktop mode), pressing F12 shows a popup menu to choose between inspecting the embedded Wan2GP content or the Electron shell.
- **No more single-pane DevTools button** — the dual-picker is more discoverable and matches how developers actually debug.
- **DevTools lifecycle cleanup** — DevTools renderer processes are cleaned up on close and on app quit, preventing orphan processes.

### Before-Quit Cleanup
- **Orphan process prevention** — DevTools windows are explicitly closed in `before-quit` to prevent lingering renderer processes.
- `app.isQuitting` flag properly guards all close-to-tray logic.

---

## 🔧 Changes

### main.js
- Added `Tray`, `nativeTheme`, `Notification` module imports.
- `createWindow()` now reads `windowState` from config for position/size/maximized.
- Window close handler hides to tray (unless `app.isQuitting`).
- Window state saved to config on `resize`/`move`.
- New IPC handlers: `set-auto-start`, `set-theme-follow-system`, `set-notifications-enabled`, `quit-app`.
- `toggleDevTools(wc)` helper function extracted.
- `before-input-event` listener routes F12/Ctrl+Shift+I to the DevTools popup picker.
- `devtools-closed` event listener prevents orphan DevTools processes.
- `createTray()` + `updateTrayMenu()` for system tray lifecycle.
- Desktop notifications on server ready/stop in both `launch` and `launch-webview` IPC handlers.
- `nativeTheme.on('updated')` listener registered when `themeFollowSystem` is set.
- `before-quit` handler now sets `app.isQuitting`, kills subprocesses, and closes DevTools.

### preload.js
- New bridge methods: `setAutoStart`, `setThemeFollowSystem`, `setNotificationsEnabled`, `quitApp`, `onSystemThemeChange`.

### renderer/app.js
- Settings panel wired for Auto-start, Follow system theme, and Desktop notifications toggles.
- `onSystemThemeChange` listener calls `applyTheme()` on native theme changes.
- DevTools UI button removed (replaced by F12 popup picker — the IPC handler remains in `main.js`).

### renderer/index.html
- Removed "Developer Tools" section from Settings.
- Added "Desktop" section with three toggle-row controls: Auto-start with Windows, Follow system theme, Desktop notifications.

### package.json
- Version bumped 2.1.4 → 2.1.5.
- `publish:win` changed from `--publish onTag` to `--publish always`.
- `release:win` now delegates to `scripts/release-win.sh 2.1.5`.

### scripts
- New `scripts/release-win.sh` — automates the full release flow (bump → commit → tag → push → build → API upload to GitHub Release draft).

---

## 🐛 Bug Fixes

- **Orphan DevTools processes** — undocked DevTools windows could leave renderer processes alive in the background after closing. Fixed by adding `devtools-closed` event listener and explicit DevTools cleanup in `before-quit`.

## 📋 Changelog

See [README.md](README.md) for the full feature list.
