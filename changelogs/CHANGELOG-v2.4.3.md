# v2.4.3 — Linux packaging fix

**Fix**

- The Linux `.deb` now declares its full Electron dependency set explicitly
  (`libasound2`, `libgbm1`, plus the previously implicit GTK/NSS/X11 stack).
  electron-builder's default Depends omitted ALSA, so on fresh/minimal Ubuntu
  installs the launcher failed to start with
  `error while loading shared libraries: libasound.so.2`. The AppImage is
  unaffected (bundles everything).

**Notes**

- `libasound2` is a transitional package on Ubuntu 24.04+/26.04 (pulls the
  t64 rename), so the dependency resolves on both old and new Ubuntu lines.
- Shipped artifacts: `Wan2GP-Desktop-Launcher-2.4.3-linux-amd64.deb`,
  `Wan2GP-Desktop-Launcher-2.4.3-linux-amd64.AppImage`, Windows installer
  (unchanged).
