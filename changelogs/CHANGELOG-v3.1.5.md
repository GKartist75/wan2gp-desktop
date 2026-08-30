# v3.1.5

## Full Desktop update + sha512 verify

**Desktop auto-update:** `autoUpdater.disableDifferentialDownload=true` before `downloadUpdate()` — always downloads the full `Wan2GP-Desktop-Launcher-3.1.5-win-x64.exe` (93 MB, `96,506,xxx` bytes) and verifies `sha512` vs `latest.yml` before `quitAndInstall`. No `blockmap` delta patch in `C:\Program Files`, so `3.1.3 → 3.1.4` `This app can't run on your PC` (truncated `blockmap` patch, Defender lock, `dev` base) can’t happen. Same as manual GitHub download.

Progress still via `updateBanner` `progressFill` + `Manage → Updates` `Downloading 45%` (now for 93 MB).

176 tests pass.
