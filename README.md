# Wan2GP Desktop Launcher

A desktop launcher for [Wan2GP](https://github.com/deepbeepmeep/Wan2GP) that installs,
updates, and runs it from one window — handling Git, Python, CUDA, and PyTorch setup
so you don't have to configure them manually.

> **Stuck on v3.0 not starting?** If you upgraded from an older version whose data lived in
> the roaming AppData profile, the essential fix is:
> **uninstall → make sure it's fully closed → delete `Roaming\wan2gp-desktop` → reinstall the latest v3.x.**
> (v3.0.1+ also offers an in-app "Migrate to new location" button that moves your data out of
> AppData cleanly, so this manual cleanup is no longer needed.)
>
> **v3.0.1 ships the latest GPU kernel wheels, auto-installed per hardware.** Same kernel set as v3.0.0 (Python 3.11.14, PyTorch 2.10 + CUDA 13, Triton, SageAttention, Sparge 0.1.0, Flash-Attention 2.8.3, Nunchaku 1.2.1, GGUF llama.cpp CUDA 1.0.11, Lightx2v 0.0.2 on RTX 50, bitsandbytes 0.49.2) — the launcher detects your GPU and installs exactly the wheels it needs, re-synced on every update. Full per-hardware version map in [⚙️ GPU kernel wheels](#️-gpu-kernel-wheels-installed-automatically).

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

> **New in v3.0.0** — **Self-contained install layout (folders moved) + latest GPU kernels auto-installed per hardware.** Wan2GP now installs to a dedicated `C:\Wan2GP` (repo + venv + config) and keeps model checkpoints/LoRAs on a **separate** `C:\Wan2GP-Models` — out of roaming AppData for good. The installer also pulls the **current** attention/quant kernels matched to your GPU: Python 3.11.14 + PyTorch 2.10 (CUDA 13), Triton, SageAttention (1.0.6 on RTX 20 / 2.2.0 on 30–50), Sparge 0.1.0, Flash-Attention 2.8.3, Nunchaku 1.2.1, GGUF llama.cpp CUDA 1.0.11, Lightx2v 0.0.2 (RTX 50 FP4), and bitsandbytes 0.49.2 (NF4) — all re-synced on every update. This is a breaking change for existing installs (old path was `%APPDATA%\wan2gp-desktop\Wan2GP\Wan2GP`). **Uninstall then reinstall is the clean path; in-place update also works** (it auto-migrates your old AppData data into `C:\Wan2GP` on first launch). See [📁 Folder-change notice](#️-v30--install-folders-moved-read-this) and [⚙️ GPU kernel wheels](#️-gpu-kernel-wheels-installed-automatically) and [CHANGELOG-v3.0.0.md](changelogs/CHANGELOG-v3.0.0.md).
> [Full changelog →](changelogs/CHANGELOG-v3.0.0.md)

> **New in v3.0.1** — **Legacy roaming installs now launch, and migration is opt-in + safe.** v3.0.0's eager auto-migration of your old AppData data ran *before* the window painted, so some users upgrading from an older roaming install never got a view at all (only deleting the roaming folder helped). v3.0.1 defers that work and instead offers an explicit **"Migrate to new location"** dialog (startup prompt, dashboard `MODELS` banner, or Manage) where you choose the data / checkpoints / LoRAs / output folders — preferred defaults pre-filled (`C:\Wan2GP` + `C:\Wan2GP-Models`), all editable. The move flattens the repo (no `C:\Wan2GP\Wan2GP` doubling), rewrites `wgp_config.json` model paths to the new locations, removes the empty roaming wrapper, and shows a live progress bar on the slow copy path. Also: **auto-update is now manual-only** — the Manage toggle is renamed "Check for updates on launch" and defaults OFF; nothing downloads or installs without your explicit action. Ships the same latest GPU kernel wheels as v3.0.0, auto-installed per hardware. See [CHANGELOG-v3.0.1.md](changelogs/CHANGELOG-v3.0.1.md).

> **New in v3.0.2** — **RTX 40/50 SageAttention fix + RTX 3080 `accelerate` fix + visible install progress.** RTX 40/50 users were on an upstream SageAttention wheel (`2.2.0+cu130torch2.9.0andhigher`) whose fp8 kernel corrupts the CUDA context under torch 2.10 — causing false out-of-memory errors, GPU hangs, and black MiniMax H3. v3.0.2 **auto-swaps it to the stable `cu128torch2.8.0-cp311-cp311` build** on RTX 40/50 (after install / update / Kernel sync), keeping full SageAttention speed. RTX 3080 installs no longer skip the z-image VAE fix: the bootstrap is deferred so a missing `accelerate` can't abort it, and `ensureAccelerate()` installs it when absent. The installer also now shows a **15s activity heartbeat** during silent setup stretches so it never looks frozen, and a red **SAGE** banner tells affected RTX 40/50 users to click **Sync Kernels**. See [CHANGELOG-v3.0.2.md](changelogs/CHANGELOG-v3.0.2.md).

> **New in v3.0.3** — **Critical hotfix for the v3.0.2 SageAttention swap (RTX 40/50).** v3.0.2 shipped the swap with two bugs that made **Sync Kernels** fail: (1) the release-URL prefix `SAGE_CU128_BASE` was not exported, producing a broken `undefinedsageattention-…whl` URL; (2) the target wheel was a Python-3.10-only build that pip rejects on the launcher's Python 3.11.14 env. Both are fixed — the swap now installs `sageattention-2.2.0+cu128torch2.8.0-cp311-cp311` (verified downloadable). Version bumped to 3.0.3 so the **auto-updater offers it to everyone still on broken 3.0.2** (a same-version re-upload would not trigger an update). See [CHANGELOG-v3.0.3.md](changelogs/CHANGELOG-v3.0.3.md).

> **New in v2.8.7** — **Blank-screen ROOT CAUSE fixed (nested `.screen` DOM regression).** The real bug: during the gallery/plugin-tab refactor `#installer` was placed *inside* `#dashboard`'s closing tag, so it became a child of `#dashboard`. Because the launcher shows a screen by toggling a single `.active` class and `#dashboard` is `display:none` when another screen is active, the nested `#installer` inherited that hidden state and collapsed to **0×0** — the classic "title bar only" blank. (This is why the 2.8.2–2.8.6 `show`/hammer fixes never worked: you can't re-present a 0-height element.) Fix: restore `#installer` (+ floating-terminal) as **siblings of `#dashboard`** under `#app` (as in 2.6.0), and make `.screen` fill `#app` via `position:absolute; inset:0`. Also removed the 1px resize-nudge that caused a window "shake". Verified by clean reinstall + full install→open-Wan2GP flow.
> [Full changelog →](changelogs/CHANGELOG-v2.8.7.md)

> **New in v2.8.6** — **Presentation-class blank screen, attempted (superseded by 2.8.7).** v2.8.5 still blanked on some GPUs — `ready-to-show` fired but the frame never committed, so v2.8.6 added a present hammer (`invalidate()` + resize nudge). *Correction:* this was a misdiagnosis — the real bug was the nested-`.screen` DOM regression (see v2.8.7), so the hammer did not fix the affected hardware. The separate **stale data-dir override** self-heal in v2.8.6 is still valid.
> [Full changelog →](changelogs/CHANGELOG-v2.8.6.md)

> **New in v2.8.5** — **Blank-screen root causes fixed (update-corruption + presentation class).** Updating *within the app* used to leave a partial/corrupt `app.asar` (the NSIS swap ran while the app still held handles on its own install dir) → next launch blanked with title bar only. A single `forceTeardown()` now releases every handle **before** the swap. And the "window shows but content never paints" case (issue #45 pt2): the window shows **only on `ready-to-show`** (restored to the v2.6.0 path), `webContents.invalidate()` force-commits the first frame, and the blank-screen watchdog now keys on *real paint* (and is no longer cancelled by `ready-to-show`) so it force-shows + surfaces the GPU-off recovery if the frame still doesn't paint within 8s.
> [Full changelog →](changelogs/CHANGELOG-v2.8.5.md)

> **New in v2.8.4** — **`boot.log` now lives in the launcher's own folder.** It was being written via `getDataDir()`, which the data-dir override (`%USERPROFILE%\.wan2gp-desktop-data-dir`) can redirect to the user's home root. The boot tracer is a launcher diagnostic, so it now writes to `%LOCALAPPDATA%\Wan2GP Desktop Launcher\boot.log`, independent of where Wan2GP core is installed.
> [Full changelog →](changelogs/CHANGELOG-v2.8.4.md)

> **New in v2.8.3** — **Black-screen regression fixed (window showed then vanished).** v2.8.2's change to show the window on `did-finish-load` caused a show/hide race that black-screened fresh installs on some GPUs (issue #45). Reverted to the v2.6 show-on-`ready-to-show` path, and added a per-launch `boot.log` tracing the exact show/hide/paint timeline so black-screen reports are self-diagnosing.
> [Full changelog →](changelogs/CHANGELOG-v2.8.3.md)

> **New in v2.8.2** — **The launcher no longer black-screens.** A blank/black window on first launch (title bar only, content never appears) was a GPU-compositor first-present failure, not a setup problem. A 4s watchdog force-shows the window with a diagnostic if paint still fails, and a home-directory override file (`%USERPROFILE%\.wan2gp-desktop-gpu-off` on Windows, `~/.wan2gp-desktop-gpu-off` on macOS/Linux) disables hardware acceleration at module load so a black-screened user can recover without even opening Settings. (Note: v2.8.3 later restored the show-on-`ready-to-show` path after v2.8.2's `did-finish-load` show caused a show-then-vanish regression.)
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
> throttled while hidden, so the queue panel updates live even when the window
> is in the background — and the page is never auto-reloaded, so your in-progress
> inputs (prompt, reference media, settings) are never lost on window restore.
> Upstream kernel-wheel bumps (like the GGUF
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

## 📁 v3.0 — Install folders moved (READ THIS)

v3.0 changes **where Wan2GP lives on your disk**. This is the one thing you must
check before/after upgrading.

### Old vs new default locations

| What | ❌ Before (v2.8.x) | ✅ Now (v3.0.0) |
|------|--------------------|-----------------|
| Repo + venv + `wgp_config.json` | `%APPDATA%\wan2gp-desktop\Wan2GP\Wan2GP` | **`C:\Wan2GP`** |
| Model checkpoints | `<repo>\ckpts` (inside the repo) | **`C:\Wan2GP-Models\ckpts`** |
| LoRAs | `<repo>\loras` | **`C:\Wan2GP-Models\loras`** |
| Generated outputs | `<repo>\outputs` | **`C:\Wan2GP-Models\outputs`** |

The old location was inside your **roaming AppData** profile — it travels with
your account, can sync/backup unexpectedly, and counts against profile quotas.
For tens–hundreds of GB of checkpoints that's a bad place to be. `C:\Wan2GP`
is a dedicated top-level folder on a fast drive; `C:\Wan2GP-Models` keeps your
large files separate from the code so backups and drive swaps are trivial.

### How to upgrade — pick one

**✅ Preferred: uninstall, then install fresh**
1. Launcher → **Manage** → **Uninstall** (keep or delete your old models — they
   sit in the old AppData path).
2. **Close the launcher completely.**
3. Run the new v3.0.0 `.exe` → it creates `C:\Wan2GP` fresh.
4. Copy/point your checkpoints at `C:\Wan2GP-Models\ckpts`.

**🟡 Also works: in-place update (v3.0.0)**
Updating an existing v2.8.x install **auto-migrated** your old AppData data dir
into `C:\Wan2GP` on first launch (rollback-safe: source removed only after the
move verified on disk). The old `Wan2GP\Wan2GP` doubling was preserved if you had
it; only genuinely fresh installs got the clean flat layout.

> **⚠️ v3.0.0 → v3.0.1 upgrade note.** v3.0.0's automatic pre-paint migration
> could leave some roaming installs with no window at all. **v3.0.1 does NOT
> auto-migrate** — on first launch it only opens the **"Migrate to new location"**
> dialog and waits for you to choose (prefilled `C:\Wan2GP` + `C:\Wan2GP-Models`).
> If you upgraded and saw a blank launch, just reinstall v3.0.1 fresh (or use the
> in-app Migrate button from Manage / the `MODELS` banner) — your old data is not
> deleted, it's still in `Roaming\wan2gp-desktop` until you move it.

> Either path lands you at `C:\Wan2GP`. Uninstall-first is cleaner; update-in-place
> is fine if you just want the new build. **No data is deleted by the migration.**
>
> **All paths are user-selectable** — `C:\Wan2GP` (Wan2GP install) and
> `C:\Wan2GP-Models\ckpts` (checkpoints) are just the **recommended defaults**,
> pre-filled on the install screen. Click **Browse** to place the repo, the
> checkpoints, the LoRAs, or the outputs on any drive/folder you like; your
> choice is saved. Nothing is hard-coded.

### Installation process (v3.0)

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. RUN the installer (.exe)                                          │
│    → detects GPU, shows the packages it will install                 │
└───────────────────────────────────┬─────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. INSTALL SCREEN — check the defaults (now editable):               │
│    • Wan2GP install location : C:\Wan2GP          ⚠ keep OUT of AppData│
│    • Model folders           : C:\Wan2GP-Models\ckpts  (loras/outputs)│
│      ⚠ checkpoints/LoRAs are large — use a fast, non-system drive    │
│    • 📝 ALL paths are editable — C:\Wan2GP / C:\Wan2GP-Models are     │
│      recommended defaults only; click Browse to put them anywhere    │
└───────────────────────────────────┬─────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. CLICK Install (~5–20 min)                                         │
│    → git clone Wan2GP  →  uv venv  →  PyTorch+CUDA  →  requirements  │
│    →  attention kernels (Sage/Sparge/Flash/Nunchaku/GGUF/bnb)         │
│    → writes wgp_config.json (ckpts=C:\Wan2GP-Models\ckpts)            │
└───────────────────────────────────┬─────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. LAUNCH — Desktop (green, in-app) or Browser (amber)               │
│    → Wan2GP opens, ready to use                                      │
└─────────────────────────────────────────────────────────────────────┘
```

If you already had a v2.8.x install, step 3 first **migrates** your old
`%APPDATA%\wan2gp-desktop\Wan2GP` into `C:\Wan2GP` (rollback-safe), then
continues the install.

### Where is everything now?

```
C:\Wan2GP\                      ← repo + launcher data (self-contained)
   ├─ wgp.py                    ← Wan2GP core
   ├─ env_uv\                   ← Python 3.11 venv (uv)
   ├─ wgp_config.json           ← your settings (ckpts → C:\Wan2GP-Models\ckpts)
   ├─ desktop-config.json       ← launcher config
   ├─ .electron\  .py-shim\  patches\  .reinstall-backup\
   └─ boot.log                  ← launcher diagnostic

C:\Wan2GP-Models\               ← SEPARATE, your large files
   ├─ ckpts\                    ← model checkpoints
   ├─ loras\                    ← LoRA models
   └─ outputs\                  ← generated videos/images/audio
```

> 💡 The install screen pre-fills these defaults and shows a ⚠ warning if your
> model folders still point inside AppData. The dashboard shows a `MODELS`
> banner if it detects checkpoints/LoRAs under your roaming profile.

> **Also included** — v3.0 builds on the recent 2.6 – 2.8.7 line, none of it
> regressed: the **black/blank-screen root cause** is fixed (nested-`.screen` DOM
> regression in 2.8.7, GPU-compositor override in 2.8.2/2.8.3, update-`app.asar`
> blank in 2.8.5); the **HTML structure is cleaner** (`#installer`/`#dashboard`
> are siblings under `#app`, `.screen{position:absolute;inset:0}`); **GPU kernel
> wheels** (GGUF/Nunchaku/Flash/Sage/Sparge/bitsandbytes) stay synced on every
> install/update; and **switching Desktop ↔ Dashboard** no longer reloads the
> embedded view, so your in-page input is never dropped.

## ⚙️ GPU kernel wheels (installed automatically)

Wan2GP runs far faster with vendor attention/quantization kernels than with
stock PyTorch. The installer detects your GPU and pulls the matching **prebuilt
wheels** during install (and re-syncs them on every update, so you never get a
stale wheel when upstream bumps one). The installer reads Wan2GP's own
`setup_config.json` per hardware profile and shows **exactly** what it will
install before you click. On an NVIDIA RTX 30/40/50 install you'll see these go
down (v3.0.0 pinned versions):

| Wheel | Version (v3.0.0) | What it does |
|-------|------------------|--------------|
| **Python** (uv) | `3.11.14` (RTX 20–50) / `3.10.9` (GTX 10) | The venv interpreter. |
| **PyTorch + CUDA** (`torch`/`torchvision`/`torchaudio`) | `2.10.0` + CUDA 13.0 | Base tensor + GPU runtime. |
| **Triton** (`triton-windows`) | `latest` (3.7.1 on the v3.0 build) | JIT compiler for custom CUDA/attention kernels on Windows. |
| **SageAttention** (`sageattention`) | `1.0.6` (RTX 20) / `2.2.0` (RTX 30–50) | Fast fused attention — big speed-up for sampling, low VRAM overhead. **RTX 40/50 safety note:** the upstream `2.2.0+cu130torch2.9.0andhigher` wheel ships fp8-PV CUDA kernels that corrupt the CUDA context under the torch 2.10 + CUDA 13 runtime (false OOM / stall / black MiniMax H3 frames — GitHub #64, upstream #2178). The launcher auto-swaps RTX 40/50 to the stable `cu128torch2.7.1` SageAttention 2.2.0 build after install / update / Kernel sync, keeping the speed-up. If you ever see a "FALSE OOM" hint, switch attention to `flash`/`sdpa` (Manage → Advanced) and re-run Kernel sync. |
| **Sparge Attention** (`spas-sage-attn`) | `0.1.0` | Sparsity-aware attention kernel (drop-in speed-up alongside Sage). |
| **Flash-Attention** (`flash-attn`) | `2.8.3` | Memory-efficient exact attention for long contexts/high-res. |
| **Nunchaku** (`nunchaku`) | `1.2.1` | SVD-quantized (NF4/SVDQ) checkpoint runtime — runs 4-bit/8-bit models fast. |
| **GGUF llama.cpp CUDA** (`llamacpp_gguf_cuda`) | `1.0.11` | CUDA-backed GGUF LLM/quant kernels (Stream-K, quantized KV-cache). |
| **Lightx2v** (`lightx2v_kernel`) | `0.0.2` | FP4 kernels — **RTX 50xx / sm120+ only**. |
| **bitsandbytes** (`bitsandbytes`) | `0.49.2` | 8-bit/NF4 optimizers + dequant for NF4 checkpoints (since v2.8.1). |

> **Per-hardware kernel set (v3.0.0):** RTX 20 → Sage 1.0.6 + Flash 2.8.3 + Nunchaku + GGUF 1.0.11.
> RTX 30/40 → add Sparge 0.1.0 + Sage 2.2.0. RTX 50 → add **Lightx2v 0.0.2** (FP4). All profiles also get bitsandbytes 0.49.2.
> Versions are kept current with `setup_config.json` on every update — if upstream bumps a wheel, the next update installs it.

The kernels are installed into the `C:\Wan2GP\env_uv`
venv, not into the repo — so the flat `C:\Wan2GP` layout above keeps the wheels
with the environment, separately from your model files.

> GTX 10/16 cards deliberately stay on the legacy **CUDA 12.8** stack (no R580
> driver requirement); the modern RTX 20–50 stack uses CUDA 13.0. AMD/Apple
> paths install their respective ROCm/MPS kernels instead.

### What the 1-click installer covers (mapped to the manual guide)

Everything in Wan2GP's [manual `INSTALLATION.md`](https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/INSTALLATION.md) is done for you — you don't run any of those `pip`/`conda` commands by hand. The launcher picks the **per-GPU stack** the manual guide recommends and installs it into `C:\Wan2GP\env_uv`:

| Manual guide section | What the launcher does |
|----------------------|------------------------|
| **Minimal install** (clone + venv + PyTorch + `requirements.txt`) | Clones Wan2GP → creates a uv venv (Python **3.11.14** for RTX 20–50, **3.10.9** for GTX 10) → installs PyTorch (see matrix) + `requirements.txt`. |
| **Triton** | Installs `triton-windows` (pinned `<3.3` on RTX 20/30, latest on RTX 40/50). |
| **Sage Attention** | RTX 30 → `sageattention` 1.0.6; RTX 40/50 → Sage**2** 2.2.0 wheel. (GTX 10 unsupported — skipped.) |
| **Sparge Attention** (`spas_sage_attn`) | Installs the matching `cu130`/`py3.11` wheel. |
| **Flash Attention** (`flash-attn`) | Installs the `2.8.3` prebuilt wheel for Windows. |
| **GGUF llama.cpp CUDA** (`llamacpp_gguf_cuda`) | Installs `1.0.11` (CUDA-graph-safe Stream-K, quantized KV-cache). Synced on every update. |
| **INT4 / FP4 quantized** | **Nunchaku** 1.2.1 (SVD/NF4/FP4) and **bitsandbytes** 0.49.2 (NF4 dequant). **Lightx2v** FP4 kernels install **only on RTX 50xx / sm120+** (FP4 is hardware-dependent). |

**Recommended Python / PyTorch / CUDA matrix** (straight from the manual guide — the launcher follows it):

- **RTX 20 / 30 / 40 / 50** → Python 3.11.14, **PyTorch 2.10 + CUDA 13.0/13.1**
- **GTX 10xx** → Python 3.10.9, **PyTorch 2.7.1 + CUDA 12.8**
- RTX 50xx **FP4** kernels require the 3.11 / PyTorch 2.10 / CUDA 13 stack (which the launcher already uses for RTX 30–50).

> The manual guide explicitly says **avoid PyTorch 2.8.0** (System-RAM leaks when switching models) and **2.9.0** (3D-convolution perf bug — VAE VRAM explodes). The launcher installs **2.10**, so it sidesteps both.
>
> You only need the manual guide if you want a fully custom/hand-rolled environment. For everyone else, the installer is the supported path and stays in sync with `setup_config.json` on every update.

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

## Troubleshooting — blank / black window after an in-app update

If the launcher opens to a **title bar only, no content** right after using
**Check for updates → Download → Install & Restart** (and a clean older
version worked):

1. The update likely left a partial `app.asar` because a file was locked during
   the swap. **Uninstall**, then reinstall the latest `.exe` from
   [Releases](https://github.com/GKartist75/wan2gp-desktop/releases) with the
   launcher **fully closed**.
2. Still blank? Open `%LOCALAPPDATA%\Wan2GP Desktop Launcher\boot.log` to tell
   the two remaining classes apart:
   - **`ready-to-show -> show()` present, no `first-paint` mark** = presentation
     class (issue #45, part 2). v2.8.5 force-commits a frame via
     `webContents.invalidate()`; if it still fails, create an empty file
     `%USERPROFILE%\.wan2gp-desktop-gpu-off` and restart (disables hardware
     acceleration — the GPU-compositor class, issue #39).
   - **`did-fail-load` mark, no `first-paint`** = corrupt bundle (update class),
     reinstall as in step 1.

v2.8.5+ prevents the update class at the source (releases all handles before
the installer swap) and force-commits the first frame so the presentation
class paints.

## Build from source

```bash
git clone https://github.com/GKartist75/wan2gp-desktop.git
cd wan2gp-desktop
npm install
npm start          # dev
npm run build:win  # Windows NSIS installer
```

## Changelog

- **v3.0.1** — **Legacy roaming installs launch again + safe opt-in migration + manual-only updates.** Root cause of "v3.0 won't start after upgrading from an old roaming install": v3.0.0 ran the data-dir migration synchronously before the first paint, which could leave users with no window at all (the only workaround was deleting the `Roaming\wan2gp-desktop` folder). v3.0.1 defers migration and surfaces it as an explicit **Migrate to new location** dialog (startup / `MODELS` banner / Manage) with editable data + checkpoints + LoRAs + outputs folders (preferred `C:\Wan2GP` + `C:\Wan2GP-Models` defaults). The move flattens the repo (no `C:\Wan2GP\Wan2GP` double), rewrites `wgp_config.json` model paths, removes the emptied roaming wrapper, and reports live progress on the slow copy path (verified by unit tests simulating a legacy roaming → 3.0.1 migration). **Auto-update is now manual-only**: the Manage toggle is renamed "Check for updates on launch" and defaults OFF; auto-download and install-on-quit are forced off, so closing the app never installs an update. Ships the same latest GPU kernel wheels as v3.0.0 (Python 3.11.14, PyTorch 2.10 + CUDA 13, Triton, SageAttention per GPU, Sparge 0.1.0, Flash-Attention 2.8.3, Nunchaku 1.2.1, GGUF llama.cpp CUDA 1.0.11, Lightx2v 0.0.2 on RTX 50, bitsandbytes 0.49.2), auto-installed per hardware and re-synced on every update. See [CHANGELOG-v3.0.1.md](changelogs/CHANGELOG-v3.0.1.md).
- **v3.0.0** — **Self-contained install layout — folders moved (breaking).** Wan2GP + venv + `wgp_config.json` now default to a dedicated **`C:\Wan2GP`** (not roaming AppData), and model checkpoints/LoRAs default to a **separate `C:\Wan2GP-Models`** (`ckpts` = `C:\Wan2GP-Models\ckpts`). This kills the old `Wan2GP\Wan2GP` doubling and keeps tens–hundreds of GB of models off your roaming profile. Existing v2.8.x installs **auto-migrate** into `C:\Wan2GP` on first launch (rollback-safe); uninstall-then-reinstall is the cleaner path. The clone step no longer renames the live data dir (the EPERM-on-reinstall bug), and legacy repo-relative model paths are upgraded to the separate default. See [📁 Folder-change notice](#️-v30--install-folders-moved-read-this) and [CHANGELOG-v3.0.0.md](changelogs/CHANGELOG-v3.0.0.md).
- **v2.8.7** — **Blank-screen ROOT CAUSE fixed (nested `.screen` DOM regression).** During the gallery/plugin-tab refactor `#installer` (+ floating-terminal) were placed *inside* `#dashboard`'s closing tag, so they became children of `#dashboard`. The launcher shows a screen by toggling a single `.active` class; `#dashboard` is `display:none` when another screen is active, so the nested `#installer` inherited that hidden state and collapsed to 0×0 (the "title bar only" blank). Fix: restore them as **siblings of `#dashboard`** under `#app` (as in 2.6.0); `.screen` now fills `#app` via `position:absolute; inset:0`; removed the 1px resize-nudge that caused a window "shake". The 2.8.6 stale-data-dir self-heal remains valid. See [CHANGELOG-v2.8.7.md](changelogs/CHANGELOG-v2.8.7.md).
- **v2.8.6** — **Blank-screen (presentation class) — misdiagnosed, superseded by 2.8.7.** v2.8.6 added a present hammer (`invalidate()` + resize nudge) on the (wrong) theory that the compositor dropped a committed frame. The real bug was the nested-`.screen` DOM regression (v2.8.7), so the hammer did not fix the affected hardware. **(B) Stale data-dir override** self-heal (still valid) — the launcher pins its data dir once and never re-validated it; renaming/moving the Wan2GP folder then reinstalling left a dead pin so the launcher blanked. Now self-heals: the override is dropped and the default re-derived if stale. See [CHANGELOG-v2.8.6.md](changelogs/CHANGELOG-v2.8.6.md).
- **v2.8.5** — **In-app update no longer blanks the launcher.** Updating *within the app* (e.g. 2.6 → 2.8.4) could leave a partial/corrupt `app.asar` because `quitAndInstall()` ran the NSIS swap while the app still held handles (Wan2GP server, embedded BrowserView, pulse window) on its own install dir — the next launch then opened to a blank window (title bar only, no content). A new `forceTeardown()` now releases **every** handle **before** the swap, and a failed in-flight update clean-quits so a manual reinstall is never blocked by stale locks. Covers the update-installation class of blank screen; the GPU-compositor (`%USERPROFILE%\.wan2gp-desktop-gpu-off`) and show-path (v2.8.3) fixes are unchanged. See [CHANGELOG-v2.8.5.md](changelogs/CHANGELOG-v2.8.5.md).
- **v2.8.4** — **`boot.log` now lives in the launcher's own folder.** It was being written via `getDataDir()`, which the data-dir override (`%USERPROFILE%\.wan2gp-desktop-data-dir`) can redirect to the user's home root — dumping `boot.log` (and `desktop-config.json`) into `C:\Users\<user>\`. The boot tracer is a launcher diagnostic, so it now writes to the launcher's own data dir (`%LOCALAPPDATA%\Wan2GP Desktop Launcher\boot.log`) computed explicitly from `LOCALAPPDATA` + app name, independent of where Wan2GP core is installed or what the override says. The "Report an issue" bundle reads from the same place. The v2.8.3 black-screen fix is unchanged. See [CHANGELOG-v2.8.4.md](changelogs/CHANGELOG-v2.8.4.md).
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

## Credits

- **[DeepBeepMeep](https://github.com/deepbeepmeep)** — creator of [Wan2GP](https://github.com/deepbeepmeep/Wan2GP), the generative AI app this launcher installs and runs.
- **Tophness / Steve Jabz** — for the original Wan2GP install scripts that the launcher's setup pipeline is built on.
- **All Wan2GP Desktop Launcher users** — thank you for using the launcher and for your support, feedback, and bug reports that keep it improving.

## License

MIT
