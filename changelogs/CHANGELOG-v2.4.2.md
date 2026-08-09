# Wan2GP Desktop Launcher v2.4.2

**WSLg renderer crash fixed** — the launcher now works under WSL on Windows 10
(WSL 2.7.x), where a broken shared-memory channel made Chromium's renderer
FATAL on `/dev/shm` (`No such process (3)` / `Unable to access(W_OK|X_OK)
/dev/shm`) right at startup — no window, or an invisible zombie process.

## Fixes

- **WSLg: shared-memory crash** — under WSL the launcher now also passes
  `--disable-dev-shm-usage`, so Chromium uses `/tmp` for shared memory instead
  of the broken `/dev/shm` channel (same WSL 2.7.x regression family as the
  GPU-passthrough failure: wslg#1456). Real Linux desktops are untouched.

## Infrastructure

- CI: syntax checks + 18 unit tests on push/PR; installer builds (Windows
  exe, Linux AppImage/deb + update manifests) on version tags.
- Full changelog history in [changelogs/](changelogs/).
