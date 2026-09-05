# v3.4.1

## ✨ DLSS5 panel shows all 8 files

The Dashboard DLSS5 card now always lists every runtime file (`host/nr-depth-worker.exe`, `host/nvngx.dll`, `dlssg/dlssg-worker.exe`, `host/dxgi.dll`, `host/renodx-dlss5.addon64`, `host/nvngx_dlssnr.dll`, `dlss/nvngx_dlss.dll`, `dlssg/nvngx_dlssg.dll`) with its package version and expected SHA-256 — green ✓ when present, red "not installed" when missing. Previously the rows only appeared mid-install from live script output, and the Workers label was stuck at v1.1.2.

The pinned versions/SHAs now live in the backend (`services/dlss5.js`, mirroring upstream `scripts/install_dlss5.ps1`), so the panel can't go stale again. The installer script itself still owns integrity; the panel only mirrors it.
