# Wan2GP Desktop Launcher v2.4.1

**Linux packages are here** — the launcher now ships installable Linux builds
(.deb and AppImage) attached to the release, and the Linux auto-update channel
(latest-linux.yml) is live for the first time.

## Fixes

- **WSLg: invisible window fixed** — when the launcher detects it is running
  inside WSL (Linux under Windows), it now applies the Chromium switches
  required for WSLg's software-rendered display: `--no-sandbox` always, and
  when no GPU is available (`/dev/dri` missing — broken passthrough, VMs)
  also `--disable-gpu --in-process-gpu --ozone-platform=x11
  --use-gl=swiftshader`. Previously the renderer could fail to initialize and
  the window never appeared. Real Linux desktops with a working GPU are
  untouched — the fallback only activates under WSL.

## Infrastructure

- **CI** — unchanged: syntax checks + 18 unit tests on push/PR, installer
  builds (Windows exe + Linux AppImage/deb + update manifests) on version
  tags.
- **First Linux release artifacts** — `.deb` (Debian/Ubuntu, incl. WSL) and
  AppImage (all other distributions) plus `latest-linux.yml` for the
  auto-updater, built for the v2.4.1 tag.
- **Full changelog history** in [changelogs/](changelogs/).
