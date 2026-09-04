# v3.3.0

## 🧩 Plugin Manager — Status Pro included

**Manage → Plugins** tab: list/enable/install/update/uninstall Wan2GP plugins. Catalog (`plugins.json`) merged with your installed `plugins/` folder (system vs community grouping), search + Name/Latest/Author sort, per-plugin enable checkboxes.

- **Status Pro** is a default plugin: installed automatically on fresh setup and kept enabled (locked checkbox), still uninstallable — one click reinstalls it.
- **★ Favourites** auto-install on fresh setup (`desktop-config.json` → `favoritePlugins`).
- Install from git URL (clone + `requirements.txt` + auto-enable), per-plugin ↻ update check, 🗑 uninstall (locked files → deleted on next Wan2GP start), library refresh from GitHub, check-all-updates — all with console progress.
- Update badges (⇪) persist across restarts. Changes apply on next Wan2GP launch.

## ✨ DLSS5 installer — optional NVIDIA upsamplers

Dashboard card (below Deepy) runs Wan2GP's own `scripts/install_dlss5.ps1` (workers v1.1.2, ReShade 6.8.0, RenoDX 4.70, DLSSNR 310.8.SF-v2, DLSS 310.8.0, Frame Generation 310.7.0) into `dlss5/` with a live per-component checklist — downloading → SHA-256 ✓ → installed — plus console progress. Strict `I ACCEPT` consent modal, Force (backup + replace) option. **Stop Wan2GP first.** Needs Windows 11 + RTX 30+ / RTX 40+ + HAGS.

## Deepy catch-up

- Local **Qwen3.8 VL 27B** Prime engine (auto-raises 32k context + Summarize + repetition penalty).
- `deepy_repetition_penalty` in Zero and Prime presets.
- Claude bridge pin → **0.1.66**; serve button shows real running state (port probe); per-engine npm labels.
- Opencode server stop kills the process tree (was orphaning the server behind the `.cmd` wrapper).

## Auto-Tune

- **Int8 Kernels** default-on (experimental, ~10% faster with INT8 checkpoints, needs Triton) in recommendation + adjuster + writer.

## Launcher updates

- Update check runs once shortly after boot (5h poll alone left fresh releases unknown for hours).
- **Stop** sweeps orphaned processes scoped to our repo's `wgp.py` — no blanket Python kill, no left-behind servers.
