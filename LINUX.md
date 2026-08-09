# Wan2GP Desktop Launcher — Linux

> ⚠️ **Linux support is in development and can change.** The launcher runs, but
> features, packaging, and behavior may shift between releases. The primary,
> fully supported platform is **Windows** — see the [main README](README.md).

[← Back to the main README](README.md)

## Download

<p align="center">
  <code>Wan2GP-Desktop-Launcher-*-linux-amd64.deb</code> / <code>*.AppImage</code><br>
  <small>≈ 115 MB — Debian/Ubuntu (incl. WSL) / all other Linux distros</small>
</p>

Grab the latest `.deb` or `.AppImage` from the
[Releases page](https://github.com/GKartist75/wan2gp-desktop/releases).

> 🏷️ Linux releases are tagged **`linux-vX.Y.Z`** and marked **Pre-release** —
> the stable `vX.Y.Z` releases are Windows-only. The newest Linux build is the
> latest pre-release with a `linux-v` prefix.

## Install (Debian/Ubuntu, incl. WSL)

Download the `.deb` from the
[Releases page](https://github.com/GKartist75/wan2gp-desktop/releases)
(right-click → *Copy link address* on the latest `*-linux-amd64.deb`), then
install the local file:

```bash
# replace <version> with the version you downloaded (e.g. 2.4.1):
sudo apt install -y ./Wan2GP-Desktop-Launcher-<version>-linux-amd64.deb
wan2gp-desktop
```

(`./` = the file is already on your machine — apt does not fetch it. You can
also point apt straight at the release URL, e.g. for v2.4.1:

```bash
sudo apt install -y https://github.com/GKartist75/wan2gp-desktop/releases/download/v2.4.1/Wan2GP-Desktop-Launcher-2.4.1-linux-amd64.deb
```

> 💡 Paste the **raw URL**. If you copy the link from a chat app that wraps
> it in `@url:`...`, strip the wrapper first — otherwise apt reports
> `Unable to locate package @url:...`.)

The Electron runtime dependencies are pulled automatically. For other
distributions, download the AppImage, `chmod +x` it, and run it. Under WSL
the launcher only applies WSLg fallback switches on the legacy WSL line
(kernel < 6.12); modern WSLg (Windows 11, WSL 2.8+) runs clean with none —
software rendering kicks in automatically when no GPU passthrough exists.

## Troubleshooting (WSL)

- **No window appears (WSL, Windows 10)** — the WSL 2.7.x release line (the
  final WSL version for Windows 10) has a WSLg kernel regression: the kernel
  refuses to seal memfds (`F_ADD_SEALS` returns `Operation not permitted` even
  with `MFD_ALLOW_SEALING`, verified by direct syscall probes), so Chromium's
  shared-memory escape hatch is dead and the renderer never boots — the window
  opens blank. (Pre-2.4.2 the log showed a hard FATAL on `/dev/shm: No such
  process (3)`; 2.4.2+ logs a `/tmp` ESRCH line, but that same line also
  appears on healthy Linux with `--disable-dev-shm-usage` and is benign — the
  real WSL-only breakage is the memfd sealing EPERM.) The launcher detects
  this legacy line (`/proc/sys/kernel/osrelease` < 6.12) and applies the
  workarounds automatically (`--no-sandbox`, `--disable-dev-shm-usage`,
  SwiftShader), but the kernel-level memory breakage cannot be fixed from the
  app — it survives `wsl --shutdown` and `wsl --update` reports no newer
  version is available for Windows 10:
  ```powershell
  wsl --update      # try first (PowerShell, admin)
  wsl --shutdown    # sometimes restores the display stack
  ```
  If both fail, the WSLg layer on that Windows 10 machine cannot run
  Chromium renderers at all — use a real Linux desktop or Windows 11's WSL.
- **No window appears (WSL, Windows 11)** — make sure WSL is up to date
  (`wsl --update` from an admin PowerShell, reboot if prompted) and the
  distro is a recent Ubuntu (`wsl --install -d Ubuntu`). On modern WSLg
  (kernel ≥ 6.12) the launcher applies no fallback switches — verified
  rendering on Ubuntu 26.04 / kernel 6.18.33.2 (2026-08-09). The old blanket
  switches are *not* applied there because `--disable-dev-shm-usage` forces
  Chromium onto the `/tmp` shm path, which fails (ESRCH) on WSLg and kills
  the renderer; the default `/dev/shm` path is healthy.
- **`Unable to locate package @url:`...`** — you pasted a link wrapped by a
  chat app (the `@url:`...` wrapper). Strip the wrapper, or download the
  `.deb` and run `sudo apt install -y ./file.deb` (`./` means a local file —
  apt does not fetch URLs by itself).
