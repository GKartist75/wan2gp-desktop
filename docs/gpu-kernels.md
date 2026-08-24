# GPU kernel wheels (installed automatically)

Wan2GP runs far faster with vendor attention/quantization kernels than with stock PyTorch. The installer detects your GPU and pulls the matching **prebuilt wheels** during install (and re-syncs them on every update, so you never get a stale wheel when upstream bumps one). The installer reads Wan2GP's own `setup_config.json` per hardware profile and shows **exactly** what it will install before you click.

## What gets installed (NVIDIA RTX 30/40/50 example)

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

> **Per-hardware kernel set (v3.0.0):** RTX 20 → Sage 1.0.6 + Flash 2.8.3 + Nunchaku + GGUF 1.0.11. RTX 30/40 → add Sparge 0.1.0 + Sage 2.2.0. RTX 50 → add **Lightx2v 0.0.2** (FP4). All profiles also get bitsandbytes 0.49.2. Versions are kept current with `setup_config.json` on every update — if upstream bumps a wheel, the next update installs it.

The kernels are installed into the `C:\Wan2GP\env_uv` venv, not into the repo — so the flat `C:\Wan2GP` layout keeps the wheels with the environment, separately from your model files.

> GTX 10/16 cards deliberately stay on the legacy **CUDA 12.8** stack (no R580 driver requirement); the modern RTX 20–50 stack uses CUDA 13.0. AMD/Apple paths install their respective ROCm/MPS kernels instead.

## What the 1-click installer covers (mapped to the manual guide)

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

> You only need the manual guide if you want a fully custom/hand-rolled environment. For everyone else, the installer is the supported path and stays in sync with `setup_config.json` on every update.
