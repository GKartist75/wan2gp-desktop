# Wan2GP Desktop Launcher

A desktop launcher for [Wan2GP](https://github.com/deepbeepmeep/Wan2GP) that installs,
updates, and runs it from one window — handling Git, Python, CUDA, and PyTorch setup
so you don't have to configure them manually.

[![Release](https://img.shields.io/github/v/release/GKartist75/wan2gp-desktop?style=flat-square&label=release)](https://github.com/GKartist75/wan2gp-desktop/releases)
[![Platform](https://img.shields.io/badge/platform-Windows-blue?style=flat-square)](<>)
[![License](https://img.shields.io/github/license/GKartist75/wan2gp-desktop?style=flat-square)](<>)

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

Alternatively, grab the latest `.exe` from the
[Releases page](https://github.com/GKartist75/wan2gp-desktop/releases).

## Screenshots

![Launcher plugin screenshot](screenshots/launcher-plugin.png)
![Launcher screenshot](screenshots/launcher-screenshot-2.png)
![Launcher screenshot](screenshots/launcher-screenshot-3.png)

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

> **⚡ CUDA 13 stack on modern RTX cards.** Since v2.4.5, RTX 20/30/40/50
> installs get **PyTorch 2.10 + CUDA 13** with generation-aware acceleration —
> SageAttention (2.2 on RTX 30/40, 1.0.6 on RTX 20), FlashAttention 2.8.3,
> SpargeAttention on 30/40/50, and LightX2V kernels on RTX 50, alongside
> Nunchaku INT4/FP4 + **GGUF llama.cpp CUDA kernels 1.0.8** on modern cards
> (accurate native BF16, lower VRAM, CUDA-graph-safe Stream-K), plus
> **bitsandbytes 0.49.2** (NF4 kernels) for 4-bit/NF4 checkpoints since
> v2.8.1. The launcher
> installs the correct kernel wheels on **install and every update** — no stale
> wheels when upstream bumps them.
> GTX 10/16 stay on the legacy **CUDA 12.8** stack (no R580 driver required);
> every other NVIDIA card needs an **R580+ driver** for the cu130 build, which
> the launcher checks before installing.

### ⚡ Auto-Tune — profile system

One-click hardware scan (GPU, CUDA, VRAM, attention kernels) that recommends
and applies optimal `wgp_config.json` settings. Access via **Manage** → **Auto-Tune**
tab or the ⚡ button on the main dashboard.

**How profiles work** — Wan2GP's memory manager (`mmgp`) uses 7 profiles
that trade off VRAM usage vs speed. The auto-tune picks one based on your
VRAM and system RAM:

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

All three profile dropdowns (video/image/audio) are **editable** before applying,
so you can override the recommendation.

**Failsafe preference** — tick *"Prefer failsafe (P5 — maximum compatibility)"* in
the recommendation card to force the P5 profile (with a 0.60 safety coefficient
and VAE on Auto) regardless of the matrix — for hardware where the
recommended profile still crashes. Toggling re-renders live; Apply writes
whatever is shown.

**The tuned coefficient is real** — on every launch the launcher forwards the
tuned value as `--vram-safety-coefficient`, so what Auto-Tune writes is what
generation uses. Explicit values in Extra Launch Args always win.

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

> **New in v2.8.2** — **The launcher no longer black-screens.** A blank window on first launch (title bar only, content never appears) was a GPU-compositor first-present failure, not a setup problem. The window now shows the instant the HTML is parsed, a 4s watchdog force-shows it with a diagnostic if paint still fails, and a home-directory override file (`%USERPROFILE%\.wan2gp-desktop-gpu-off` on Windows, `~/.wan2gp-desktop-gpu-off` on macOS/Linux) disables hardware acceleration at module load so a black-screened user can recover without even opening Settings.
> [Full changelog →](changelogs/CHANGELOG-v2.8.2.md)

> **New in v2.8.1** — **AMD installs now match the AMD guide (and NF4 kernels
> get installed).** An audit against upstream's `INSTALLATION.md` /
> `AMD-INSTALLATION.md` found doc-covered situations that neither Wan2GP's setup
> script nor the launcher handled: AMD machines now get the full ROCm session
> environment at **every launch** (HSA override per GPU family read from the
> repo's own `setup_config.json`, ROCM_HOME/llvm PATH forwarded from ROCM_ROOT,
> and the guide's `clang-cl`/AOTriton/MIOpen flags) — no more custom `.bat`
> needed. RX **9060/9070** detect as gfx1201 and RX 890M/Strix Halo as gfx1151
> (previously missed → wrong/no HSA override). And **bitsandbytes==0.49.2** (NF4
> kernels) is now installed for the modern NVIDIA stack on install/update — it
> was in the docs but in neither `requirements.txt` nor `setup_config.json`, so
> NF4 checkpoints silently ran slow CPU dequant.
> ℹ️ **AMD testing note:** the author has no AMD machine — the AMD path was
> implemented from the upstream docs, not from on-hardware testing. **Feedback
> from AMD users is welcome** (what card you have + the launch-log HSA override
> line) so the installer can be adjusted.
> [Full changelog →](changelogs/CHANGELOG-v2.8.1.md)

> **New in v2.8.0** — **The queue keeps up with the queue, and kernel wheels
> stay current.** A big queue finishing while the launcher window was hidden
> used to look "still running" forever — Chromium throttles timers in the
> embedded Wan2GP page when the window is in the background, so the queue panel
> froze even though the server kept processing. The embedded page is no longer
> throttled while hidden, and the queue panel re-syncs automatically when you
> restore the window (only when a queue was actually running — it never reloads
> over a page you're typing into). Upstream kernel-wheel bumps (like the GGUF
> llama.cpp CUDA kernels **1.0.8** — accurate native BF16, lower VRAM,
> CUDA-graph-safe Stream-K) are now pulled automatically on **install and
> update**, so the correct wheels are always installed.
> [Full changelog →](changelogs/CHANGELOG-v2.8.0.md)

> **New in v2.6.1** — **The GUI stops disappearing.** A Chromium renderer crash
> (GPU/driver TDR under heavy load — a generation saturating the card) used to
> blank the launcher window mid-generation with no recovery. A watchdog on
> `render-process-gone` now auto-reloads the UI (bounded, no reload loops),
> restores Desktop or Browser mode exactly where you were, self-heals the
> embedded Wan2GP view and floating consoles, and after repeated crashes points
> you to disabling GPU acceleration. Generation is never touched — the server
> runs in its own process.
> [Full changelog →](changelogs/CHANGELOG-v2.6.1.md)

> **New in v2.6.0** — **No more install/update/uninstall freezes.** Setup,
> git, pip, and env-removal steps all ran as blocking main-process calls —
> a clone or an AV-throttled uninstall froze the window for minutes. The
> whole pipeline is async now; the UI stays responsive while setup works.
> Prerequisite installs (Git/Python/Miniconda) work again, Auto-Tune
> recommends the VAE config **Auto** for every tier, and launch/pip paths
> are hardened against shell and option injection.
> [Full changelog →](changelogs/CHANGELOG-v2.6.0.md)

> **New in v2.5.4** — **No more phantom "local changes" backups.** That
> `[!] Local changes... backup saved` warning on update used to fire for
> any untracked file (like `envs.json`) and saved an empty 0-byte patch —
> `git reset --hard` never touches untracked files, so nothing was ever at
> risk. The warning (and real backup) now only triggers for actual edits to
> tracked files.
> [Full changelog →](changelogs/CHANGELOG-v2.5.4.md)

> **New in v2.5.3** — **Self-healing updates.** Updates used to fail forever
> with `fatal: not a git repository` when the install's `.git` was broken
> (antivirus quarantine / interrupted clone — I had it myself). The launcher
> now detects that state before every update and rebuilds the repository
> automatically; a failed `setup.py` no longer strands the update either.
> [Full changelog →](changelogs/CHANGELOG-v2.5.3.md)

> **New in v2.5.2** — **No frozen startup, no "can't save" walls, no lost
> edits.** Hardware detection is fully async — probing your GPU no longer locks
> up the window. Model paths in `wgp_config.json` that point *inside* the repo
> are auto-repaired, fixing "Error in getting the location" model downloads
> (issue #18). Updates back up any local edits before resetting the repo.
> Everything rendered from repository content (commit messages, authors, env
> names) is now HTML-escaped through one tested helper. Auto-Tune self-detects
> on first visit, console rendering is coalesced to one paint per frame, and
> 11 new tests bring the suite to 46.
> [Full changelog →](changelogs/CHANGELOG-v2.5.2.md)

> **New in v2.5.0** — **Auto-Tune overhaul**. The tuned VRAM safety
> coefficient is now actually forwarded to Wan2GP on every launch (it was
> previously written but silently ignored — generation always ran at 0.8).
> Detection is async (no more ~30s UI freeze), a **failsafe preference** forces
> the max-compatibility P5 profile on demand, audio no longer crawls on
> 12–23GB cards (profile 3 engages the fast LM decoders), 12GB/32GB machines
> keep P4 instead of being downgraded to P5, RTX 30 gets the right attention
> backend, fresh installs auto-tune once at setup, and Detect scans without
> writing (Apply applies, and tells you to restart).
> [Full changelog →](changelogs/CHANGELOG-v2.5.0.md)

> **New in v2.4.5** — **Wan2GP update checks, now periodic + manual**, plus
> **update-flow hardening and a driver pre-check**. The dashboard re-checks the
> upstream Wan2GP repo every 30 minutes while open (silent, skipped while the
> dashboard is hidden) and the Wan2GP Updates card has a **↻ Check for updates**
> link for on-demand re-checks. Updates no longer skip requirement bumps: if
> upstream's `requirements.txt` changed, the new pins are force-installed after
> the update. Install/update also warns when the NVIDIA driver is below R580
> (unless GTX 10/16), and all launch paths now enable `--advanced
> --multiple-images` automatically. Upstream lookups are cached 5 minutes so the
> polling never hits the unauthenticated GitHub API rate limit.
> [Full changelog →](changelogs/CHANGELOG-v2.4.5.md)

> **New in v2.4.0** — **Auto-update control**. Turn automatic updates off from
> Manage → Desktop → *Auto-update*: no launch-time update check, no silent
> download, and no surprise install on quit. Updates then only happen through
> the explicit *Check for updates → Download → Install & Restart* flow.
> [Full changelog →](changelogs/CHANGELOG-v2.4.0.md)

> **New in v2.3.0** — **Repair Settings** (one-click fix for the "Value is not in the
> list of choices" save error), a **multi-GPU device picker** (`--gpu cuda:N` for any
> detected GPU), a **report-an-issue bundler** (system info + launch log + error queue
> zipped with a pre-filled GitHub issue), the first **test suite** (18 tests) and **CI**,
> plus a fixed release script that can no longer drift from the app version.
> [Full changelog →](changelogs/CHANGELOG-v2.3.0.md)

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

- **v2.8.3** — **Black-screen regression fixed (window showed then vanished).** v2.8.2's change to show the window on `did-finish-load` (instead of only on `ready-to-show`) caused a show/hide race that black-screened fresh installs on some GPUs/drivers — issue #45 (RTX 5050/4090, 9070XT, Win10/11). Reverted to the v2.6 show-on-`ready-to-show` path. Added a per-launch `<dataDir>/boot.log` tracing the exact show/hide/paint timeline (so black-screen reports are self-diagnosing without the blank UI), and the About → "Report an issue" bundle now includes `windowState` + the boot-log tail. The v2.8.2 GPU-off override remains the fix for the *compositor/present* class (issue #39); this release fixes the separate *show-path* regression. See [CHANGELOG-v2.8.3.md](changelogs/CHANGELOG-v2.8.3.md).
- **v2.8.2** — **The launcher no longer black-screens** — a blank/black window on first launch (title bar only, content never appears) was a GPU-compositor first-present failure, not a setup problem. The window now shows the moment the HTML is parsed (no waiting on the compositor), a 4s watchdog force-shows it with a diagnostic if paint still fails, and a home-directory override file (`%USERPROFILE%\.wan2gp-desktop-gpu-off` on Windows, `~/.wan2gp-desktop-gpu-off` on macOS/Linux) disables hardware acceleration at module load so a black-screened user can recover without even opening Settings. Git reachability was ruled out as a cause — tested three ways with a deliberately broken git, the launcher painted every time. See [CHANGELOG-v2.8.2.md](changelogs/CHANGELOG-v2.8.2.md).
- **v2.8.1** — **AMD installs now match the AMD guide (and NF4 kernels get installed)** — an audit against upstream's `INSTALLATION.md`/`AMD-INSTALLATION.md` found doc-covered situations neither Wan2GP's setup script nor the launcher handled: AMD machines now get the full ROCm session environment at every launch (HSA `HSA_OVERRIDE_GFX_VERSION` per GPU family read from the repo's own `setup_config.json` — upstream `setup.py` declares but never applies the field; ROCM_HOME/llvm PATH forwarded from ROCM_ROOT; the guide's `CC=CXX=clang-cl`, `DISTUTILS_USE_SDK=1`, `FLASH_ATTENTION_TRITON_AMD_ENABLE=TRUE`, `TORCH_ROCM_AOTRITON_ENABLE_EXPERIMENTAL=1`, `MIOPEN_FIND_MODE=FAST` flags), applied in-app, browser mode, external-terminal scripts and desktop shortcuts. AMD GPU-family detection fixed: RX 9060/9070 → AMD_GFX1201, RX 890M/Strix Halo → AMD_GFX1151 (previously fell back to GFX110X with no override). bitsandbytes==0.49.2 (NF4 kernels) now installs on the modern NVIDIA stack on install/update — it was in the docs but in neither `requirements.txt` nor `setup_config.json`, so NF4 checkpoints silently ran slow CPU dequant. ℹ️ The author has no AMD machine — the AMD path was implemented from the docs, so **AMD user feedback is welcome** to refine the installer. See [CHANGELOG-v2.8.1.md](changelogs/CHANGELOG-v2.8.1.md).
- **v2.8.0** — **The queue keeps up with the queue, and kernel wheels stay current** — a big queue finishing while the launcher window was hidden used to look "still running": Chromium throttles timers in the embedded Wan2GP page whenever the window is in the background, so the queue panel froze while the server kept processing. The embedded BrowserView (and pop-out window) no longer throttle while hidden, so queue updates keep flowing, and on window restore after ≥30 s away with queue activity seen, the embedded view re-syncs itself once — the server is never touched, so a running generation is unaffected, and the reload never fires over a page the user was typing into. GPU kernel wheels (GGUF llama.cpp CUDA kernels **1.0.8**, Nunchaku, Lightx2v) are now synced from `setup_config.json` on **install and every update** — upstream wheel bumps land automatically instead of leaving a stale wheel behind. See [CHANGELOG-v2.8.0.md](changelogs/CHANGELOG-v2.8.0.md).
- **v2.6.1** — **The GUI stops disappearing** — a renderer-crash watchdog on `render-process-gone` auto-reloads the launcher window when the Chromium renderer dies (GPU/driver TDR under heavy load during a generation), restores Desktop/Browser mode exactly where you were, self-heals the embedded Wan2GP view and floating consoles, diagnoses GPU-process deaths, and stops looping after repeated crashes with a pointer to disabling GPU acceleration. Generation is never touched — the server runs in its own process. See [CHANGELOG-v2.6.1.md](changelogs/CHANGELOG-v2.6.1.md).
- **v2.6.0** — **No more install/update/uninstall freezes, VAE on Auto, deeper hardening** — the entire setup pipeline (Python/uv installs, git clone/fetch/reset, pip pins, xcopy backups, env removal) ran as blocking main-process calls that froze the window for minutes; everything is async now, so the UI stays responsive. Prerequisite installs (Git/Python/Miniconda) work again, orphaned servers from failed launches are killed with their process tree, duplicate console toggles and stale "running" states fixed, and install/reinstall/update/uninstall are serialized so rapid clicks can't interleave. Auto-Tune recommends the VAE config **Auto** for every tier (runtime picks tiling from real VRAM headroom). Hardened: launch URLs strictly validated (shell injection), pip option injection blocked (package names whitelisted), `manage-delete` path containment, `fetchUrl` redirects/16MB cap, release scripts build before pushing the tag, SignPath hook timeouts+PE validation. 51 tests. See [CHANGELOG-v2.6.0.md](changelogs/CHANGELOG-v2.6.0.md).
- **v2.5.4** — **No more phantom "local changes" backups** — the `[!] Local changes... backup saved` warning used to fire for any untracked file (like `envs.json`) and saved an empty 0-byte patch, even though `git reset --hard` never touches untracked files; updates now warn and back up only for real edits to tracked files. See [CHANGELOG-v2.5.4.md](changelogs/CHANGELOG-v2.5.4.md).
- **v2.5.3** — **Self-healing updates for broken git repos** — updates that died with `fatal: not a git repository` (AV quarantine / interrupted clone leaving `.git` unusable) now detect the broken state before updating and rebuild the repository automatically (issue #27); a failed `setup.py update` no longer strands the update — the launcher-side git fetch/reset continues; NVIDIA driver pre-check added to updates (parity with install). 46 tests. See [CHANGELOG-v2.5.3.md](changelogs/CHANGELOG-v2.5.3.md).
- **v2.5.2** — **Async hardware detection, model-path repair, update safety, injection hardening** — GPU/RAM/VRAM probing never blocks the app anymore (previously up to 15–20s of frozen window); Repair Settings + a silent background scan fix `wgp_config.json` entries pointing inside the repo — the fix for "error in getting the location" model downloads (issue #18); updates back up local repo edits (`pre-update-*.patch`) before resetting; Auto-Tune auto-runs detection on first tab visit; dashboard refresh batches its IPC and metric/update polling pauses while hidden; console rendering coalesced to one paint per frame; all repo-sourced content (commit messages, authors, env names, package lists) HTML-escaped through one unit-tested helper; 46 tests. See [CHANGELOG-v2.5.2.md](changelogs/CHANGELOG-v2.5.2.md).
- **v2.5.1** — **RAM tier boundary fix** — 32GB kits reporting 31.4–31.9 GiB are no longer demoted to the wrong profile; the detection card shows the true reported RAM. See [CHANGELOG-v2.5.1.md](changelogs/CHANGELOG-v2.5.1.md).
- **v2.5.0** — **Auto-Tune overhaul** — the tuned VRAM safety coefficient is actually forwarded on every launch, detection is async (no ~30s freeze), a failsafe preference forces P5 on demand, audio on 12–23GB cards engages the fast LM decoders, 12GB/32GB machines keep P4 instead of P5, RTX 30 gets the right attention backend, fresh installs auto-tune once, and Detect scans without writing. See [CHANGELOG-v2.5.0.md](changelogs/CHANGELOG-v2.5.0.md).
- **v2.4.5** — **Update checks (periodic + manual), update-flow hardening, driver pre-check** — the dashboard re-checks the upstream Wan2GP repo every 30 minutes while open (silent, skips while hidden) plus a **↻ Check for updates** link in the Wan2GP Updates card; updates no longer skip requirement bumps (changed `requirements.txt` pins are force-installed after the update — fixes the silently-skipped `mmgp` bump, and AMD/Windows installs pin `numpy==1.26.4` for ROCm wheel compat); NVIDIA driver pre-check warns below R580 (GTX 10/16 exempt); all launch paths now enable `--advanced --multiple-images`. See [CHANGELOG-v2.4.5.md](changelogs/CHANGELOG-v2.4.5.md).
- **v2.4.0** — **Auto-update control** — new **Auto-update** toggle (Manage → Desktop): turn off automatic update checks, downloads, and the surprise install-on-quit; updates then only happen through the explicit Check for updates → Download → Install & Restart flow, and the setting takes effect without restarting. See [CHANGELOG-v2.4.0.md](changelogs/CHANGELOG-v2.4.0.md).
- **v2.3.0** — **Settings repair + multi-GPU + issue reporting + tests** — **Repair Settings** (one-click fix for the "Value: N is not in the list of choices" save error — scans and clamps `*_settings.json` files with `*.bak-repair` backups), **GPU Device picker** (choose which GPU Wan2GP runs on, `--gpu cuda:N` in both launch modes), **🐞 Report an issue** (system info + launch log + error queue bundled into a zip with a pre-filled GitHub issue), first **test suite** (18 tests) + **CI**, release script auto-reads the version from package.json. See [CHANGELOG-v2.3.0.md](changelogs/CHANGELOG-v2.3.0.md).
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
