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

**In short: Wan2GP is the engine. This launcher is the garage, the mechanic, and the fuel pump** — so you spend your time generating, not debugging environments.

---

## Key features

- 🚀 **One-click install** — detects your GPU, shows exactly what it will install, then sets up Git, Python, PyTorch + CUDA, and every attention kernel for you.
- 🎯 **Always the right kernels** — pulls the per-GPU wheel set from Wan2GP's own `setup_config.json` and re-syncs on every update. No stale wheels, no manual matching.
- 📂 **Clean data layout** — install lives in `C:\Wan2GP` (default) and your multi-GB models in a separate `C:\Wan2GP-Models` (default), out of roaming AppData. **Both are just pre-filled defaults — you can put them on any drive/folder you like at install time.**
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

## Screenshots

![Launcher plugin screenshot](screenshots/launcher-plugin.png)
![Launcher screenshot](screenshots/launcher-screenshot-2.png)
![Launcher screenshot](screenshots/launcher-screenshot-3.png)

---

## Remote LLM engines (Deepy Prime)

The Dashboard's **Remote LLMs / Deepy Prime** section has guided cards for three engines. They are **not** all free:

- 🟢 **OpenCode — easiest & free.** Local models only (Llama.cpp / LM Studio / etc.). No Anthropic or OpenAI account, no credits, no API key. Install via the card's **Install via npm** button, click **Start server**, and point Wan2GP at `http://127.0.0.1:4096`. **Zero cost.**
- 💲 **Claude Code — paid.** Either a **Max/Pro subscription** (sign in via `claude auth login --claudeai`) **or** an **Anthropic Console API key with credits** (Settings → "Claude / Anthropic API Key", injected as `ANTHROPIC_API_KEY`). The API key replaces the subscription but is **not free** — it requires API credits / billing in the Console (pay-as-you-go, billed per token).
- 💲 **OpenAI Codex — paid.** Its own npm CLI plus an OpenAI account / API access.

> New to this? **Start with OpenCode** — it's the only zero-cost option and needs no external account.

---

## Activating Deepy

The Dashboard's **Deepy** panel (Settings → Deepy, or the Dashboard card) lets you turn Wan2GP's built-in AI agent on and pick how it runs — all without touching `wgp_config.json` by hand. It has three modes:

- **Disabled** — Deepy stays off. The launcher keeps your chosen **local Prompt Enhancer** model (Florence 2 + Llama 3.2 3B, or Florence 2 + Llama Joy 8B) so Wan2GP's image understanding works.
- **Deepy Zero** — runs Deepy **locally** with a Qwen3.5/3.8 VL model (no external account, no API key). Pick the local model in the **Local model (Prompt Enhancer)** selector: Qwen3.5 VL Abliterated 4B (recommended), 9B, or Qwen3.8 VL Uncensored 27B.
- **Deepy Prime** — connects Deepy to a **remote LLM engine** (OpenCode / Claude Code / Codex, see above). Only Prime exposes Wan2GP's MCP tools. The **LLM Engines** card appears under Prime so you can pick and configure the engine.

Switching the mode **live-re-renders** the local-model selector; nothing is written until you press **Apply**. On Apply the launcher writes a consistent `wgp_config.json` (both `enhancer_enabled` and `llm_engines.deepy`, plus the full working Deepy preset) and backs up the previous file.

> You can also change these settings any time **inside Wan2GP itself** (Configuration → Prompt Enhancer / Deepy).

![Deepy panel — Disabled mode with local Prompt Enhancer selector](screenshots/deepy-panel-1.png)
![Deepy panel — Deepy Zero with Qwen local-model selector](screenshots/deepy-panel-2.png)
![Deepy panel — Deepy Prime showing the LLM Engines card](screenshots/deepy-panel-3.png)
![Deepy — active environment / running state](screenshots/deepy-active-env.png)

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
