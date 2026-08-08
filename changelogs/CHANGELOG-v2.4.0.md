# Wan2GP Desktop Launcher v2.4.0

**Auto-update control** — you can now turn off automatic updates so the launcher
never checks, downloads, or installs a new version on its own. Updates only
happen when you explicitly ask for them.

## New Features

- **Auto-update toggle** — Manage → Desktop → *Auto-update*. When **off**:
  - no update check runs 5 seconds after launch;
  - an available update is not downloaded silently — the banner shows
    *"vX.Y.Z available"* with a **Download** button instead;
  - a downloaded update is **never installed on quit** (the previous default
    behavior that could surprise you with an update + restart later).
  When **on** (the default), everything works exactly as before.
- **Manual update flow preserved** — the *Check for updates* button still
  works with auto-updates off: check → download → *Install & Restart* are
  three explicit steps you control.

## Fixes

- **Surprise install on quit** — electron-updater's default
  `autoInstallOnAppQuit` installed a silently-downloaded update at the next
  app exit, then restarted with the new version. The policy is now
  config-driven and `autoInstallOnAppQuit` is only enabled when auto-updates
  are on.
- **No restart needed for the toggle** — saving the setting re-applies the
  update policy immediately via the config-save IPC handler.

## Improvements

- **Policy centralized** — `applyAutoUpdatePolicy()` reads
  `autoUpdateEnabled` once and drives `autoDownload` +
  `autoInstallOnAppQuit` together, so the launcher can never drift into
  half-auto-update states.
- **Banner adapts to mode** — the update banner renders the manual Download
  button when auto-download is off, instead of showing a progress bar that
  would never fill.

## Infrastructure

- **CI** — unchanged: syntax checks + 18 unit tests on push/PR, installer
  build (exe + blockmap + latest.yml) on version tags.
- **Updated README** — version badge and release notes for v2.4.0.
- **Full changelog history** in [changelogs/](changelogs/).
