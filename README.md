# Wan2GP Desktop Launcher

A desktop launcher for [Wan2GP](https://github.com/deepbeepmeep/Wan2GP) that installs,
updates, and runs it from one window — handling Git, Python, CUDA, and PyTorch setup
so you don't have to configure them manually.

[![Release](https://img.shields.io/github/v/release/GKartist75/wan2gp-desktop?style=flat-square&label=v2.2.4)](https://github.com/GKartist75/wan2gp-desktop/releases)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey?style=flat-square)](<>)
[![License](https://img.shields.io/github/license/GKartist75/wan2gp-desktop?style=flat-square)](<>)

## Download

<p align="center">
  <a href="https://github.com/GKartist75/wan2gp-desktop/releases/latest" style="display:inline-block;padding:14px 36px;background:#2ea043;color:#fff;border-radius:8px;font-size:1.1rem;font-weight:600;text-decoration:none">
    ⬇ Download Wan2GP Desktop Launcher
  </a>
</p>

<p align="center">
  <code>Wan2GP-Desktop-Launcher-*-win-x64.exe</code><br>
  <small>≈ 90 MB — Windows 10/11 only</small>
</p>

> ⚠️ **Unsigned installer** — the "unknown publisher" warning is normal for open-source software without a code-signing certificate.

Alternatively, grab the latest `.exe` from the
[Releases page](https://github.com/GKartist75/wan2gp-desktop/releases).

## Screenshots

![Launcher plugin screenshot](screenshots/launcher-plugin.png)
![Launcher screenshot](screenshots/launcher-screenshot-2.png)

## Why a launcher

Wan2GP's manual setup involves cloning the repo, installing Python 3.11, selecting a
PyTorch + CUDA/ROCm build that matches your GPU, and building attention kernels.
The launcher automates those steps and manages the environment for you.

## Getting started

1. **Run the installer** — no prior tooling required.
2. **It sets up the environment** — detects your GPU and lists the packages it will install before proceeding.
3. **Click Launch** — Wan2GP opens, ready to use.

## Features

### 🛠 Setup

- **Prerequisites, auto-installed.** Missing Git, Python 3.11, uv, or conda? One click installs them silently — no PATH editing.
- **Hardware detection.** Reads your GPU (NVIDIA RTX 30/40/50, AMD, Apple Silicon) and selects the matching PyTorch + CUDA/ROCm build and attention kernels before installing.
- **Isolated environment.** A Python 3.11 env via uv with pinned deps, so `pygame` and others install from prebuilt wheels.

### ⚡ Auto-Tune — profile system

One-click hardware scan (GPU, CUDA, VRAM, attention kernels) that recommends
and applies optimal `wgp_config.json` settings. Access via **Manage** → **Auto-Tune**
tab or the ⚡ button on the main dashboard.

**How profiles work** — Wan2GP's memory manager (`mmgp`) uses 7 profiles
that trade off VRAM usage vs speed. The auto-tune picks one based on your
VRAM and system RAM:

| Profile | mmgp name | pinnedMemory | Budgets | Encoder Quant | Best for |
|---------|-----------|-------------|---------|---------------|----------|
| **P1** | HighRAM_HighVRAM | All modules | None | No | ≥24GB VRAM or 16GB+VRAM + 64GB+ RAM |
| **P2** | HighRAM_LowVRAM | All modules | `{"*": 3000}` | No | 16GB+ VRAM with ≤32GB RAM |
| **P3** | LowRAM_HighVRAM | Transformer only | None | Yes | 10–16GB VRAM with 64GB+ RAM (CPU offload) |
| **P3+** | VeryLowRAM_HighVRAM | Transformer only | No reserved mem | Yes | ≥24GB VRAM with <32GB RAM (RAM saver) |
| **P4** | LowRAM_LowVRAM | Transformer only | `{"*": 3000}` | Yes | ≥16GB VRAM with ≥32GB RAM (balanced) |
| **P4+** | LowRAM_LowVRAM+ | Transformer only | Tighter budgets | Yes | ≥16GB VRAM with <32GB RAM (VRAM saver) |
| **P5** | VerylowRAM_LowVRAM | None | `{"*": 3000, "transformer": 400}` | Yes | <10GB VRAM (max compatibility) |

**Profile matrix** (how VRAM × RAM tiers map to profiles):

| VRAM ↓ \ RAM → | high (≥64GB) | mid (≥32GB) | low (<32GB) |
|----------------|-------------|-------------|------------|
| **very_high** (≥24GB) | P1 | P3 | P3+ |
| **high** (≥16GB) | P2 | P4 | P4+ |
| **mid** (≥10GB) | P4 | P5 | P5 |
| **low** (<10GB) | P5 | P5 | P5 |

**Settings written** — The auto-tune writes these keys to `wgp_config.json`:
- `video_profile`, `image_profile`, `audio_profile` — profile (1, 2, 3, 3.5, 4, 4.5, 5)
- `transformer_quantization` — Scaled Int8 (recommended), FP8, NVFP4, or None
- `vae_config` — Auto (recommended), Tiling, Split-Tiling, or No Encode
- `vram_safety_coefficient` — 0.50–0.80 depending on profile

All three profile dropdowns (video/image/audio) are **editable** before applying,
so you can override the recommendation.

### 🚀 Launch modes

- **Desktop mode** (green) — Wan2GP runs inside the launcher with browser controls (back/forward/reload, zoom 25–200%) and a popout to a separate window.
- **Browser mode** (amber) — runs in a visible console and auto-opens your browser when the server is ready.
- **External Terminal mode** (blue) — launches the server in a real Windows Terminal / cmd window using a generated `Launch Wan2GP.bat`-style script (env activation + your port and extra args from Manage). In-app Running LED + Stop kills the server accurately by PID; closing the window also stops it.
- **No-GPU Chrome script** — launch in Chrome with GPU disabled to free VRAM for generation.
- **Browser picker** — detects Chrome, Edge, Firefox, Brave, Opera, Vivaldi; choose your default.

### 📊 Monitoring & control

- **Dockable console** — live server log, dock to bottom/left/top or float in its own window. Search, export, resize. Toggle with Ctrl+` or the topbar button.
- **Topbar sparklines** — CPU/GPU/RAM/VRAM usage as mini real-time charts.
- **Running LED & Stop** — status light and one-click server stop.
- **System tray** — minimize to tray, auto-start with Windows, notifications on server ready/stop.
- **Keyboard shortcuts** — Ctrl+` terminal, F12 DevTools picker, Esc/Ctrl+W close webview.
- **Maintenance** — update, upgrade, reinstall, switch envs, or uninstall-with-backup from the UI.

> **New in v2.2.4** — **Uninstall Wan2GP** with the option to keep your checkpoints/LoRAs/outputs (launch buttons disable with a "restart to install" hint), the invisible console progress bar fixed, a removal engine that survives locked files and antivirus scans, uv-managed Python auto-repair, live install progress, and UTF-8 console output. [Full changelog →](changelogs/CHANGELOG-v2.2.4.md)

## ⚠️ Temporary fix: Z-Image crash on generation

If Z-Image generation crashes right after sampling starts with:

```
RuntimeError: Input type (struct c10::BFloat16) and bias type (struct c10::Half) should be the same
```

that's a known Wan2GP core bug. The Z-Image pipeline casts the sampled latents to the
**transformer's** dtype (bf16 for bf16-quantized checkpoints like `ZImageTurbo_quanto_bf16_int8`),
but Wan2GP loads the **VAE** as fp16 by default — and `F.conv2d` requires both to match.
Setting `vae_precision="32"` does **not** help (fp32 VAE + bf16 latents fails identically).

**v2.2.4+ applies a temporary workaround automatically at every launch:** the launcher's
bootstrap forces the Z-Image VAE to load as **bf16** (the checkpoint's native precision) to
match the latents, so Z-Image generation works out of the box. You'll see
`[bootstrap] z-image VAE dtype fix APPLIED (bf16)` in the console — no action needed.

The permanent fix is upstream: **[PR #2095](https://github.com/deepbeepmeep/Wan2GP/pull/2095)**
(`latents.to(self.vae.dtype)` at the VAE decode boundary). Once it's merged, the workaround
becomes a harmless no-op — nothing to uninstall or configure.

## 🗺️ Visual Guide

👉 **[Open the infographic](https://htmlpreview.github.io/?https://github.com/GKartist75/wan2gp-desktop/blob/main/infographic.html)** — a single-page visual walkthrough covering install steps, hardware profiles, the dashboard layout, Auto-Tune, launch modes, and every feature.

## Prerequisites

No need to pre-install anything — the launcher sets up Git, Python 3.11, uv, and
Miniconda for you automatically. To actually run Wan2GP you'll need an NVIDIA GPU

- driver (CUDA 12.8+) and an internet connection. The launcher itself is about
  90 MB to download and 250 MB installed.

For manual installation or troubleshooting of any prerequisite, see
[PREREQUISITES.md](PREREQUISITES.md).

## Quick Start

1. Run the installer → it detects your GPU and shows expected packages
2. Pick install location / env type (`uv` recommended, `venv` default)
3. Click **Install** (~5–20 min)
4. **Launch:** **Launch Wan2GP in Desktop** (green) to run inside the launcher, or
   **Launch Wan2GP in Browser** (amber) to open in your browser.
5. Monitor server output in the **Console** panel (topbar button, dockable to bottom/left/top/floating).

Optional: **Desktop Shortcut** creates `Launch Wan2GP.bat` to run without the launcher.

## Build from source

```bash
git clone https://github.com/GKartist75/wan2gp-desktop.git
cd wan2gp-desktop
npm install
npm start          # dev
npm run build:win  # Windows NSIS installer
```

## Changelog

- **v2.2.4** — **Uninstall + progress-bar + install-flow hardening** — **Uninstall Wan2GP** (keep checkpoints/LoRAs/outputs or delete everything; launch buttons disable with a restart-to-install hint), invisible console progress bar fixed (tqdm env-var truthiness bug), robust removal engine that survives locked files/antivirus scans, "Reinstall (fresh)" no longer silently keeps the old install, uv-managed Python auto-repair, live install progress, UTF-8 console output, Prompt Enhancer button default, AV-aware clone errors. See [CHANGELOG-v2.2.4.md](changelogs/CHANGELOG-v2.2.4.md).
- **v2.2.3** — **UX, reliability, and install flow** — verbose env unlink progress, isolated Python for venv (no global install), backup confirmation dialog, 7-profile Auto-Tune with VAE/quant dropdowns and matrix table, compact hardware display, prerequisite help card, console scrollbar, xcopy restore fix, profile dropdown readability fix. See [CHANGELOG-v2.2.3.md](changelogs/CHANGELOG-v2.2.3.md).
- **v2.2.2** — **Bugfix + security + quality** — green dot fix (git state tracking, `git reset --hard` over unreliable merge), command-injection fixes, async system metrics, unified package lists, UI layout compaction, plus platform guards and code quality improvements. See [CHANGELOG-v2.2.2.md](changelogs/CHANGELOG-v2.2.2.md).
- **v2.2.1** — **Feature + bugfix release** — **Share Link toggle** for proxy/VPN users, **Auto-Tune dashboard shortcut**, Gradio localhost error fixed, helpful error logging, refactored settings tab navigation. See [CHANGELOG-v2.2.1.md](changelogs/CHANGELOG-v2.2.1.md).
- **v2.2.0** — **Feature + security + quality** — **Auto-Tune** hardware detection & settings optimizer, **Xet Storage (hf_xet)** integration, **live tqdm progress bars**, **real CPU metric**, **GPU detection cache**, plus **critical security fixes** (shell injection, path traversal, code injection, URL validation) and deep code quality improvements. See [CHANGELOG-v2.2.0.md](changelogs/CHANGELOG-v2.2.0.md).
- **v2.1.9** — **Pre-release** — External Terminal mode, terminal/UI reliability fixes. Superseded by v2.2.0. See [CHANGELOG-v2.1.9.md](changelogs/CHANGELOG-v2.1.9.md).
- **v2.1.8** — **Bugfix release** — terminal docking/floating reliability. Closing the console always restores Wan2GP to full size (no grey gap), floating mode keeps Wan2GP visible with the console in its own movable window, and the floating console now resizes with its window. See [CHANGELOG-v2.1.8.md](changelogs/CHANGELOG-v2.1.8.md).
- **v2.1.7** — **Bugfix release** — fixes a critical blank/gray-screen on launch (installer mis-nested under the dashboard collapsed to 0×0), installer model-folder paths (ckpts/loras/output) being ignored/defaulted, live topbar metrics (CPU/GPU/RAM/VRAM) not starting on a fresh install, and the empty installer console. See [CHANGELOG-v2.1.7.md](changelogs/CHANGELOG-v2.1.7.md).
- **v2.1.6** — **Bugfix release** — tray icon properly destroyed on quit, child processes killed reliably via `taskkill /f /t`, single-instance lock prevents duplicate launchers, window close now quits app. See [CHANGELOG-v2.1.6.md](changelogs/CHANGELOG-v2.1.6.md).
- **v2.1.5** — **System tray** — minimize to tray, window state persistence, auto-start with Windows, follow system theme, desktop notifications, F12 DevTools picker, release automation. See [CHANGELOG-v2.1.5.md](changelogs/CHANGELOG-v2.1.5.md).
- **v2.1.4** — **Live topbar sparkline charts**, browser detection + default picker, keyboard shortcuts, floating terminal enhancements, refresh button, GPU detection rewrite, already-running detection, Electron GPU toggle, path panel layout fix, button colors/renames. See [CHANGELOG-v2.1.4.md](changelogs/CHANGELOG-v2.1.4.md).
- **v2.1.3** — Launch Wan2GP inside the app via Electron BrowserView (back/forward/reload, zoom, popout, dockable console, running LED, stop button). See [CHANGELOG-v2.1.3.md](changelogs/CHANGELOG-v2.1.3.md).
- **v2.1.2** — Fix: installer uses Python 3.11 (via uv) instead of falling back to 3.14; resolves `pygame`/kernel build failures.
- **v2.1.1** — HuggingFace token support, remembered tokens, update-button fix.
- **v2.0** — Full rewrite as pure launcher. See [CHANGELOG-v2.0.md](changelogs/CHANGELOG-v2.0.md).

## License

MIT
