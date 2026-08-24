# Getting started

## Install

1. **Run the installer** (`.exe`) — no prior tooling required. Git, Python 3.11, uv, and Miniconda are installed silently if missing.
2. **Review the install screen** — it detects your GPU and lists the packages it will install before proceeding. All paths are editable.
3. **Click Install** (~5–20 min): git clone Wan2GP → uv venv → PyTorch + CUDA → requirements → attention kernels (Sage/Sparge/Flash/Nunchaku/GGUF/bnb) → writes `wgp_config.json`.
4. **Launch**: **Launch Wan2GP in Desktop** (green, in-app) or **Launch Wan2GP in Browser** (amber).

If you had a v2.8.x install, step 3 first **migrates** your old `%APPDATA%\wan2gp-desktop\Wan2GP` into `C:\Wan2GP` (rollback-safe), then continues.

> **Tip:** a **Desktop Shortcut** creates `Launch Wan2GP.bat` to run without the launcher.

## Launch modes

- **Desktop mode** (green) — Wan2GP runs inside the launcher with browser controls (back/forward/reload, zoom 25–200%) and a pop-out to a separate window.
- **Browser mode** (amber) — runs in a visible console and auto-opens your browser when the server is ready.
- **External Terminal mode** (blue) — launches the server in a real Windows Terminal / cmd window using a generated script. In-app Running LED + Stop kills it by PID; closing the window also stops it.
- **No-GPU Chrome script** — launch in Chrome with GPU disabled to free VRAM for generation.
- **Browser picker** — detects Chrome, Edge, Firefox, Brave, Opera, Vivaldi; choose your default.

## Where is everything now? (v3.0+)

```
C:\Wan2GP\                      ← repo + launcher data (self-contained)  [default location]
   ├─ wgp.py                    ← Wan2GP core
   ├─ env_uv\                   ← Python 3.11 venv (uv)
   ├─ wgp_config.json           ← your settings (ckpts → C:\Wan2GP-Models\ckpts)
   ├─ desktop-config.json       ← launcher config
   ├─ .electron\  .py-shim\  patches\  .reinstall-backup\
   └─ boot.log                  ← launcher diagnostic

C:\Wan2GP-Models\               ← SEPARATE, your large files  [default location]
   ├─ ckpts\                    ← model checkpoints
   ├─ loras\                    ← LoRA models
   └─ outputs\                  ← generated videos/images/audio
```

> 💡 **`C:\Wan2GP` and `C:\Wan2GP-Models` are just the pre-filled defaults** — shown here because they're what the installer suggests. You can place the install and the model folders on **any drive or folder** at install time (Browse) or later via the in-app **Migrate to new location** button. The tree above is the default layout; your actual paths are whatever you chose.
> The install screen pre-fills these defaults and warns if your model folders still point inside AppData. The dashboard shows a `MODELS` banner if it detects checkpoints/LoRAs under your roaming profile.

## Prerequisites

No need to pre-install anything — the launcher sets up Git, Python 3.11, uv, and Miniconda for you. To run Wan2GP you need an **NVIDIA GPU + driver (CUDA 12.8+)** and an internet connection. The launcher is ~90 MB to download, ~250 MB installed.

For manual prerequisite troubleshooting, see [PREREQUISITES.md](../PREREQUISITES.md).

## Next

- New to v3.0? Read the [migration guide](migration-v3.md).
- Want the full feature list? See [Features](features.md).
