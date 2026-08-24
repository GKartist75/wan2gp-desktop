# Wan2GP Desktop Launcher

> The easiest way to run **Wan2GP** — the open-source generative-video toolkit — on Windows. One installer. One click to launch. Zero Python/CUDA setup.

[![Release](https://img.shields.io/github/v/release/GKartist75/wan2gp-desktop?style=flat-square&label=release)](https://github.com/GKartist75/wan2gp-desktop/releases)
[![Platform](https://img.shields.io/badge/platform-Windows-blue?style=flat-square)](<>)
[![License](https://img.shields.io/github/license/GKartist75/wan2gp-desktop?style=flat-square)](<>)

---

## What is Wan2GP?

Wan2GP turns **images, text, or audio into video** (plus image-to-image, upscaling, and more) using generative-AI models. It's powerful — but running it the normal way means wrangling a fragile Python + CUDA environment by hand.

## Why this launcher exists

Wan2GP's **manual setup is the hard part**. To run it you must clone the repo, install a specific Python (3.11) build, pick a PyTorch + CUDA version that matches *your* exact GPU, then build or fetch attention kernels (SageAttention, Flash-Attention, Triton, Nunchaku, GGUF, bitsandbytes…) — a different correct set for every GPU generation.

**Miss one version and you get silent black frames, CUDA context corruption, or a launcher that won't even start.** That's a lot of brittle, repetitive environment wrangling standing between you and actually making videos.

**The launcher removes all of it.** It detects your GPU, installs the exact kernel wheels it needs, wraps Wan2GP in a managed Python environment, and keeps everything current with a one-click update.

### The two problems users hit most — now solved

- **Models in the wrong place.** Older versions stuffed multi-GB checkpoints into roaming `AppData` (OneDrive sync, AV locks, OS-disk competition). **v3.0 moves the install to a dedicated `C:\Wan2GP` + `C:\Wan2GP-Models`, out of roaming for good** — with an in-app migrate flow.
- **Updates that break.** Auto-update is **manual-only and version-aware**, so a bad build never force-installs itself.

**In short: Wan2GP is the engine. This launcher is the garage, the mechanic, and the fuel pump** — so you spend your time generating, not debugging environments.

---

## Key features

- 🚀 **One-click install** — detects your GPU, shows exactly what it will install, then sets up Git, Python, PyTorch + CUDA, and every attention kernel for you.
- 🎯 **Always the right kernels** — pulls the per-GPU wheel set from Wan2GP's own `setup_config.json` and re-syncs on every update. No stale wheels, no manual matching.
- 📂 **Clean data layout** — install lives in `C:\Wan2GP`, your multi-GB models in a separate `C:\Wan2GP-Models`. Out of roaming AppData.
- ⚡ **Auto-Tune** — one-click hardware scan recommends the best memory profile (VRAM/RAM tiers) and writes it to `wgp_config.json`.
- 🖥️ **Flexible launch** — Desktop (in-app), Browser, or External Terminal modes; pop-out, zoom, browser picker.
- 📊 **Live monitoring** — dockable console, CPU/GPU/RAM/VRAM sparklines, running LED + stop, system tray.
- 🔄 **Safe updates** — manual-only, version-aware; nothing downloads or installs without your action.
- 🛡️ **Crash-proof UI** — renderer-crash watchdog, no blank-screen regressions, GPU-off recovery override.

---

## Download

### 🪟 Windows — primary platform

<p align="center">
  <a href="https://github.com/GKartist75/wan2gp-desktop/releases/latest" style="display:inline-block;padding:14px 36px;background:#2ea043;color:#fff;border-radius:8px;font-size:1.1rem;font-weight:600;text-decoration:none">
    ⬇ Download Wan2GP Desktop Launcher for Windows
  </a>
</p>

<p align="center">
  <code>Wan2GP-Desktop-Launcher-*-win-x64.exe</code><br>
  <small>≈ 90 MB — Windows 10/11</small>
</p>

> ⚠️ **Unsigned installer** — the "unknown publisher" warning is normal for open-source software without a code-signing certificate.

**Upgrading from v2.8.x?** v3.0 changed where Wan2GP lives on disk — read the [v3.0 migration guide](docs/migration-v3.md) first.

👉 **[Visual walkthrough infographic](https://htmlpreview.github.io/?https://github.com/GKartist75/wan2gp-desktop/blob/main/infographic.html)** — install steps, hardware profiles, dashboard, Auto-Tune, launch modes, every feature on one page.

---

## Documentation

| Page | What's inside |
|------|---------------|
| [Getting started](docs/getting-started.md) | Install, first launch, launch modes, where everything lives on disk |
| [Features](docs/features.md) | Setup, Auto-Tune memory profiles, monitoring & control |
| [v3.0 — folders moved](docs/migration-v3.md) | The v3.0 location change, how to upgrade, auto-update & GitHub token |
| [GPU kernel wheels](docs/gpu-kernels.md) | What gets installed per GPU, 1-click mapping, version matrix |
| [Troubleshooting](docs/troubleshooting.md) | Z-Image crash fix, blank-window recovery, prerequisites |
| [Build from source](docs/build-from-source.md) | Clone, `npm install`, build the installer |
| [Changelog](docs/changelog.md) | Full version history (newest first) |

---

## Credits & License

Wan2GP Desktop Launcher wraps [Wan2GP](https://github.com/deepbeepmeep/Wan2GP) by deepbeepmeep. Released under the same [License](LICENSE).
