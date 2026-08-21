# Changelog — v3.0.2

**Topic:** Two independent regressions surfaced by users on **RTX 40/50** (a broken
SageAttention wheel that corrupts the CUDA context) and **RTX 3080** (a missing
`accelerate` dependency that skipped the z-image VAE fix), **plus** installer UX
improvements (visible progress during silent setup, and a banner that tells
affected users to sync). No layout change.

## 🐞 Bug 1 (RTX 40/50): SageAttention `cu130torch2.9.0andhigher` wheel corrupts the CUDA context

### Symptom
On RTX 40/50 under PyTorch 2.10, generation could:
- abort with a **false `OutOfMemoryError`** ("Tried to allocate X MiB … GiB free") on a tiny allocation while gigabytes were free,
- **stall / hang with the GPU at full VRAM** (the context was corrupted, not OOM), or
- produce **black / garbled MiniMax H3** videos (a second, separate fp16-overflow cause — see below).

This matched community reports (GitHub #64, upstream Wan2GP #2178 / #199, and the
same wheel shipped by Pinokio).

### Root cause
Upstream `setup_config.json` installs, for the RTX 40/50 profile, the wheel
`sageattention-2.2.0+cu130torch2.9.0andhigher.post4`. Under torch 2.10 on
sm89/sm120, its **fp8 PV kernel** (`sageattn_qk_int8_pv_fp8_cuda`) corrupts the
CUDA context → the false-OOM / stall above. (RTX 30 routes to the **Triton fp16**
PV kernel and is unaffected; RTX 20 uses Sage v1.)

### Fix (v3.0.2)
- **`setSageAttentionSafe()`** — on RTX 40/50 with torch ≥ 2.10, detects the broken
  `cu130torch2.9.0andhigher` SageAttention wheel and replaces it **in place** with the
  stable `sageattention-2.2.0+cu128torch2.7.1` build. CUDA minor is ignored by
  SageAttention (12.8 ≥ 12.8 satisfies the fp8 path), so correctness + speed are
  preserved — **no fallback to slow `flash`/`sdpa`**.
- Runs after **install**, **update**, and **Kernel sync**, so it self-heals existing
  installs. **Idempotent**: a good/cu128 wheel is left alone, so Kernel sync can never
  re-break a working install.
- A **top SAGE banner** now appears for RTX 40/50 users still on the broken wheel,
  with a one-click **Sync Kernels** button. Dismissible; RTX 30/20/older never see it.

## 🐞 Bug 2 (RTX 3080 / all GPUs): missing `accelerate` skipped the z-image VAE fix

### Symptom
Update log showed:
```
[bootstrap] z-image VAE dtype fix skipped: ModuleNotFoundError("No module named 'accelerate'")
```
Z-Image generation was then prone to the `F.conv2d "Input type (BFloat16) and bias
type (Half)"` crash.

### Root cause
The z-image VAE bf16 bootstrap patch **eagerly imported `models.z_image` at launch**,
whose import chain pulls in `accelerate`. `accelerate>=1.1.1` is required by upstream
`requirements.txt`, but a broken/incomplete requirements install can drop it — so the
fix was skipped.

### Fix (v3.0.2)
- The bootstrap now **defers** the z-image patch via a meta-path finder: it arms the
  monkeypatch on the first real import of `models.z_image` during the run, so a missing
  unrelated dep at bootstrap startup can no longer abort the fix.
- **`ensureAccelerate()`** runs after install / update and installs `accelerate>=1.1.1`
  only when absent (mirrors the existing AMD-numpy-pin pattern).

## ✨ UX: installer progress is now visible

`setup.py` has long silent stretches (uv resolving torch, venv creation before any
`[1/3]` line, large CUDA wheel downloads) where no output is emitted for minutes,
making the installer look frozen. `runSetup` now runs a **15s activity heartbeat** that
re-emits the current phase label (or a generic "Working…") as a carriage-return line
the renderer overwrites in place. The heartbeat stops the moment real output arrives
and is cleared on process exit/error.

## What changed

- `services/kernel-resolver.js` — `applySageOverride()` + `sageWheelFamily()` (single
  source of truth for the cu130→cu128 swap; unit-tested).
- `main.js` — `setSageAttentionSafe()` (install / update / `sync-kernels`),
  `ensureAccelerate()` (install / update), deferred z-image bootstrap patch, and the
  `runSetup` activity heartbeat.
- `scripts/bootstrap.py` — mirrored deferred z-image fix (kept in sync with inline copy).
- `renderer/index.html` — SAGE banner; topbar Stop button unchanged.
- `renderer/app.js` — `checkSageSyncBanner()` + Sync Kernels handler.
- `renderer/style.css` — `.sage-warn` banner styling.
- `README.md` — corrected SageAttention row + v3.0.2 note.
- `tests/kernel-resolver.test.js` — resolver cases for the sage swap.

## GPU kernel wheels (same set as v3.0.1, auto-installed per hardware)

v3.0.2 keeps the v3.0.1 wheel set and **additionally self-heals the RTX 40/50
SageAttention wheel** to the stable cu128 build. Pinned set:

| Wheel | Version (v3.0.2) | Notes |
|-------|------------------|-------|
| **Python** (uv) | `3.11.14` (RTX 20–50) / `3.10.9` (GTX 10) | venv interpreter |
| **PyTorch + CUDA** | `2.10.0` + CUDA 13.0 | base tensor + GPU runtime |
| **Triton** | `latest` (~3.7.1) | JIT compiler for custom kernels on Windows |
| **SageAttention** | `1.0.6` (RTX 20) / `2.2.0` (RTX 30–50) | **RTX 40/50 auto-swapped to the stable `cu128torch2.7.1` build** |
| **Sparge Attention** | `0.1.0` | sparsity-aware attention |
| **Flash-Attention** | `2.8.3` | exact attention |
| **Nunchaku** | `1.2.1` | SVD/NF4/FP4 quantized runtime |
| **GGUF llama.cpp CUDA** | `1.0.11` | CUDA GGUF kernels (Stream-K) |
| **Lightx2v** | `0.0.2` | FP4 — RTX 50xx / sm120+ only |
| **bitsandbytes** | `0.49.2` | NF4 dequant |

Per-hardware set: RTX 20 → Sage 1.0.6 + Flash 2.8.3 + Nunchaku + GGUF 1.0.11.
RTX 30/40 → add Sparge 0.1.0 + Sage 2.2.0 (RTX 40 auto-healed to cu128).
RTX 50 → add Lightx2v 0.0.2. All profiles also get bitsandbytes 0.49.2.
GTX 10/16 stay on the legacy CUDA 12.8 stack.

## Verification

- `node --check main.js` / `renderer/app.js` → syntax OK.
- `npm test` → 118 tests pass (incl. new `tests/kernel-resolver.test.js` cases for the
  cu130→cu128 swap: swap / no-op on RTX 30/20 / torch<2.10 / non-sage; family normalization).
- Built `Wan2GP-Desktop-Launcher-3.0.2-win-x64.exe` (unsigned — matches the tested build).
- Confirmed in a real RTX 3080 install log: `z-image VAE dtype fix deferred`,
  `accelerate: present — ok.`, GGUF `1.0.8 → 1.0.11`, `Installation complete!`.

## Upgrade guidance

- **From v3.0.1:** install v3.0.2. RTX 40/50 users will see a red **SAGE** banner —
  click **Sync Kernels** once (or run one Update) to apply the stable SageAttention
  wheel. The fix is then permanent. RTX 30/20/older are unaffected and need no action.
- **New installs / reinstalls:** the fix applies automatically at the end of install.
- **MiniMax H3 black videos:** if H3 still blacks out after the SageAttention swap, the
  remaining cause is a **separate** fp16-overflow bug in Wan2GP core (upstream #2156),
  outside the launcher's scope — not the SageAttention wheel.

## Credits

- **[DeepBeepMeep](https://github.com/deepbeepmeep)** — creator of
  [Wan2GP](https://github.com/deepbeepmeep/Wan2GP).
- **Community testers** — the RTX 40/50 false-OOM and RTX 3080 `accelerate` reports
  that surfaced both regressions.
