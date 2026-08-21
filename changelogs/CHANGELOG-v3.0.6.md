# Changelog — v3.0.6

**Topic:** Re-base the launcher on deepbeepmeep's **`setup_config.json`** as the single
source of truth (per the user's decision: *"the repo config is the most important,
because that is deepbeepmeep's original version"*), and close one remaining gap — the
SageAttention fp8 self-heal did **not** cover **RTX 30**, even though `setup_config.json`
declares `sage: v220_cu13` (the broken `cu130torch2.9.0andhigher.post4` wheel) for
**RTX 30, 40 AND 50**.

> Bumped to **3.0.6** so the auto-updater offers it to 3.0.5 users.

## What changed

### 1. `setup_config.json` is now the explicit base
The launcher installs exactly what deepbeepmeep's `setup_config.json` declares:
- Python 3.11.14 / torch 2.10 + cu130 for RTX 20–50; Python 3.10.9 / torch 2.7.1 + cu128 for GTX 10.
- Triton `latest` = `triton-windows` for RTX 40/50, `<3.3` for RTX 20/30.
- Kernels (`nunchaku_cu13`, `light2xv`, `gguf`) read straight from the profile's `kernels[]`.
- Sage: the profile's `sage` component (RTX 30/40/50 → `v220_cu13`; RTX 20 → `v1`).

This matches `docs/INSTALLATION.md` (which is just the human-readable form of the same
config). The launcher no longer maintains a parallel, hand-copied wheel list — it reads
the repo's own `setup_config.json`.

### 2. The ONE necessary correction — Sage `v220_cu13` → `cu130.post6`
`setup_config.json`'s `sage.v220_cu13` = `sageattention-2.2.0+cu130torch2.9.0andhigher.post4`
is the wheel that corrupts the CUDA context under torch 2.10 / cu130 (false OOM, GPU
hang, black MiniMax H3). This is true for **every profile the config puts it on** — RTX
30, 40 and 50. So the correction is applied uniformly:

- `services/kernel-resolver.js` `applySageOverride` now triggers for **RTX_30/40/50**
  (was RTX_40/50 only) — it substitutes `v220_cu13` (post4) with the cu130-native,
  fp8-fixed `cu130torch2.10.0andhigher.post6` wheel (abi3 → installs on Python 3.11,
  cu130-linked → no DLL load crash, out-of-bounds fixed per SageAttention #98).
- `main.js` `setSageAttentionSafe` no longer hard-gates on RTX_40/RTX_50; it runs for
  any NVIDIA GPU and only acts when the broken post4 wheel is actually installed
  (RTX 20 = Sage1 and GTX 10 = no sage never match → safe no-op). **RTX 30 is now
  self-healed too.**

### 3. Launch self-heal retained (from 3.0.5)
`setSageAttentionSafe()` + `ensureAccelerate()` still run on **Launch**, so updating the
launcher alone fixes the wheel — no manual Sync Kernels required.

## What is NOT changed (still correct, still from config)
- GGUF → `1.0.11` (the docs/INSTALLATION.md target; newer than the JSON's 1.0.8 pin, kept
  as a documented correction).
- bitsandbytes `0.49.2` (required by INSTALLATION.md; absent from the JSON, installed as a
  documented correction).
- torch / python / triton / nunchaku / light2xv — all straight from `setup_config.json`.

## Verification
- `npm test` → 118 pass (sage override now asserts RTX 30/40/50 all swap; RTX 20 stays put).
- `node --check` on all sources OK.
- The `cu130.post6` wheel verified live (HTTP 200).

## Upgrade
Install v3.0.6. **RTX 30/40/50** users: after updating, the next **Launch** self-heals the
SageAttention wheel automatically (cu130.post6). **RTX 20**: Sage 1.0.6, untouched.
**GTX 10**: no sage, untouched.
