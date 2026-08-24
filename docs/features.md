# Features

## 🛠 Setup

- **Prerequisites, auto-installed.** Missing Git, Python 3.11, uv, or conda? One click installs them silently — no PATH editing.
- **Hardware detection.** Reads your GPU (NVIDIA RTX 20/30/40/50, AMD, Apple Silicon) and selects the matching PyTorch + CUDA/ROCm build and attention kernels before installing.
- **Isolated environment.** A Python 3.11 env via uv with pinned deps, so `pygame` and others install from prebuilt wheels.

> **⚡ CUDA 13 stack on modern RTX cards.** Since v2.4.5, RTX 20/30/40/50 installs get **PyTorch 2.10 + CUDA 13** with generation-aware acceleration — SageAttention (2.2 on RTX 30/40, 1.0.6 on RTX 20), FlashAttention 2.8.3, SpargeAttention on 30/40/50, LightX2V kernels on RTX 50, Nunchaku INT4/FP4 + **GGUF llama.cpp CUDA kernels 1.0.8** on modern cards (accurate native BF16, lower VRAM, CUDA-graph-safe Stream-K), plus **bitsandbytes 0.49.2** (NF4 kernels) for 4-bit/NF4 checkpoints since v2.8.1. The launcher installs the correct kernel wheels on **install and every update** — no stale wheels when upstream bumps them.
> GTX 10/16 stay on the legacy **CUDA 12.8** stack (no R580 driver required); every other NVIDIA card needs an **R580+ driver** for the cu130 build, which the launcher checks before installing.

## ⚡ Auto-Tune — profile system

One-click hardware scan (GPU, CUDA, VRAM, attention kernels) that recommends and applies optimal `wgp_config.json` settings. Access via **Manage** → **Auto-Tune** tab or the ⚡ button on the main dashboard.

The **Manage → Settings** tab also holds the **GitHub token** field (used to lift the GitHub API rate limit for update checks — see the [migration guide](migration-v3.md#auto-update--the-github-token)) and the **Desktop → *Auto-update*** toggle (turn off launch-time update checks / silent downloads / install-on-quit).

**How profiles work** — Wan2GP's memory manager (`mmgp`) uses 7 profiles that trade off VRAM usage vs speed. The auto-tune picks one based on your VRAM and system RAM:

| Profile | mmgp name | pinnedMemory | Budgets | Encoder Quant | Best for |
|---------|-----------|-------------|---------|---------------|----------|
| **P1** | HighRAM_HighVRAM | All modules | None | No | ≥24GB VRAM + 64GB+ RAM (max performance) |
| **P2** | HighRAM_LowVRAM | All modules | `{"*": 3000}` | No | 12–23GB VRAM with 64GB+ RAM |
| **P3** | LowRAM_HighVRAM | Transformer only | None | Yes | ≥24GB VRAM with 32–63GB RAM |
| **P3+** | VeryLowRAM_HighVRAM | Transformer only | No reserved mem | Yes | ≥24GB VRAM with <32GB RAM (RAM saver) |
| **P4** | LowRAM_LowVRAM | Transformer only | `{"*": 3000}` | Yes | 12–23GB VRAM with ≥32GB RAM (balanced, recommended) |
| **P4+** | LowRAM_LowVRAM+ | Transformer only | Tighter budgets | Yes | <12GB VRAM with ≥32GB RAM (VRAM saver) |
| **P5** | VerylowRAM_LowVRAM | None | `{"*": 3000, "transformer": 400}` | Yes | <12GB VRAM with <32GB RAM, or failsafe (max compatibility) |

**Profile matrix** (how VRAM × RAM tiers map to profiles):

| VRAM ↓ \ RAM → | high (≥64GB) | low (≥32GB) | very low (<32GB) |
|----------------|-------------|-------------|------------------|
| **high** (≥24GB) | P1 | P3 | P3+ |
| **low** (12–23GB) | P2 | P4 | P5 |
| **tight** (<12GB) | P4 | P4+ | P5 |

**Settings written** — The auto-tune writes these keys to `wgp_config.json`:
- `video_profile`, `image_profile`, `audio_profile` — profile (1, 2, 3, 3.5, 4, 4.5, 5)
- `transformer_quantization` — Scaled Int8 (recommended), FP8, NVFP4, or None
- `vae_config` — always **Auto** (recommended); the runtime picks VAE tiling from real VRAM headroom at generation time
- `vram_safety_coefficient` — 0.80 (≥12GB), 0.70 (<12GB), 0.60 (failsafe)

All three profile dropdowns (video/image/audio) are **editable** before applying, so you can override the recommendation.

**Failsafe preference** — tick *"Prefer failsafe (P5 — maximum compatibility)"* in the recommendation card to force the P5 profile regardless of the matrix — for hardware where the recommended profile still crashes.

**The tuned coefficient is real** — on every launch the launcher forwards the tuned value as `--vram-safety-coefficient`, so what Auto-Tune writes is what generation uses. Explicit values in Extra Launch Args always win.

## 📊 Monitoring & control

- **Dockable console** — live server log, dock to bottom/left/top or float in its own window. Search, export, resize. Toggle with Ctrl+` or the topbar button.
- **Topbar sparklines** — CPU/GPU/RAM/VRAM usage as mini real-time charts.
- **Running LED & Stop** — status light and one-click server stop.
- **System tray** — minimize to tray, auto-start with Windows, notifications on server ready/stop.
- **Keyboard shortcuts** — Ctrl+` terminal, F12 DevTools picker, Esc/Ctrl+W close webview.
- **Maintenance** — update, upgrade, reinstall, switch envs, or uninstall-with-backup from the UI.
- **Renderer-crash watchdog** — a crash auto-reloads the UI (bounded, no loops), restoring your mode and self-healing the embedded view. Generation is never touched — the server runs in its own process.
