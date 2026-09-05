# v3.4.0

## ✨ DLSS5 status counts all 8 runtime files

**Dashboard DLSS5 card**: the installed/complete check now counts `host/nvngx.dll` (legacy no-depth worker) alongside the other 7 binaries — 8 files total, matching what Wan2GP's own `scripts/install_dlss5.ps1` installs. Previously a machine missing only that file could read "complete" while the script would still install one more file, and partial installs read x/7 instead of x/8.

README tracks workers bundle **v1.1.3** (upstream `33eb156`: fixes x3 Neural Rendering for portrait outputs taller than 4320px). The card runs the upstream script itself, so installs were already correct — only the version text and the file count were stale.
