# v2.4.4 — WSLg: only apply legacy fallback switches on legacy kernels

**Fix**

- The WSLg fallback switches (`--no-sandbox`, `--disable-dev-shm-usage`, and the
  swiftshader/X11 GPU cascade) are now applied **only on the legacy WSLg line**
  (WSL ≤ 2.7.x, kernel < 6.12) that actually needs them — detected via
  `/proc/sys/kernel/osrelease`.
- On modern WSL (2.8+, kernel ≥ 6.12, e.g. Ubuntu 24.04/26.04 WSLg) the old
  blanket switches were **actively harmful**: `--disable-dev-shm-usage` forces
  Chromium onto the `/tmp` shared-memory path, which fails with ESRCH on WSLg
  and kills the renderer — while the default `/dev/shm` path is healthy and the
  seccomp sandbox works. Verified 2026-08-09 on Ubuntu 26.04 / kernel
  6.18.33.2-microsoft-standard-WSL2: the app renders cleanly with no switches.
- Real Linux desktops are untouched (the block only ever ran under
  `WSL_DISTRO_NAME`).

**Verification**

- CI linux-smoke matrix (plain + simulated-WSL modes) green on the v2.4.4 tag.
- Renderer + painted window confirmed on a live Ubuntu 26.04 WSLg host.
