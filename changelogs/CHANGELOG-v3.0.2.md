# Wan2GP Desktop Launcher v3.0.2 — SageAttention fp8 safety fix

## Root cause (GitHub #64, upstream Wan2GP #2178 / #199)

On **RTX 40 / 50** the launcher installed the upstream-recommended
`SageAttention 2.2.0` wheel `sageattention-2.2.0+cu130torch2.9.0andhigher.post4`
alongside **PyTorch 2.10 + CUDA 13**. That wheel's fp8-PV CUDA kernel
(`sageattn_qk_int8_pv_fp8_cuda`) was built against torch 2.9 and **corrupts the
CUDA context under torch 2.10** → false `OutOfMemoryError` (a 26 MiB allocation
refused while ~21 GiB is free), generation stalls/aborts, and silent black frames
in **MiniMax H3** (its video VAE decode runs on the same fp8 path and never pins a
safe backend — upstream #2178). torch 2.10 itself is correct (upstream docs warn
*against* 2.8/2.9); only the SageAttention kernel pairing was wrong.

RTX 30 (sm86) is unaffected — it routes to the safe Triton fp16 kernel. RTX 20
uses Sage v1 (no fp8). GTX 10/16 have no SageAttention.

## Fix

- **Launcher-side SageAttention self-heal** (`setSageAttentionSafe`): after
  **install**, **update**, and the manual **Kernel sync** button, on RTX 40/50
  with torch ≥ 2.10 it detects the broken `cu130torch2.9.0andhigher` wheel and
  replaces it, in place, with the **stable `cu128torch2.7.1` SageAttention 2.2.0**
  build. SageAttention ignores CUDA *minor* (12.8 vs 13.0), so the cu128 build
  dispatches the fp8 path correctly while keeping the SageAttention2++ speed-up
  (no fallback to the slow `flash`/`sdpa` path). Idempotent — never touches a
  good/already-safe wheel, so Kernel sync can no longer re-break a working install.
- **False-OOM hint**: the launch log now recognises a tiny allocation refused
  while GiB are free and tells the user it is a corrupted CUDA context (not a VRAM
  limit), pointing them to `flash`/`sdpa` attention or a Kernel re-sync.
- **Docs**: README wheel table no longer presents the cu130 SageAttention combo as
  an unqualified clean set; it documents the auto-swap and the FALSE-OOM recovery.

## MiniMax H3 note

The H3 *black-video* reports have **two** independent causes: (1) the SageAttention
fp8 decode corruption above — fixed by this release — and (2) raw **FP16 overflow**
on H3 when not on BF16 (upstream #2156), which is a Wan2GP-core issue and needs a
core fix (out of launcher scope). If H3 still blacks out after this update, the
remaining cause is #2156, not the attention kernel.

## Files changed

- `services/kernel-resolver.js` — `applySageOverride()` + `sageWheelFamily()`
  (single source of truth for the cu130→cu128 swap; unit-tested).
- `main.js` — `setSageAttentionSafe()` self-heal wired into install / update /
  `sync-kernels`; false-OOM detector in the Wan2GP stderr stream.
- `README.md` — corrected SageAttention row + safety note.
- `tests/kernel-resolver.test.js` — 6 new cases (swap / no-op on RTX 30/20 /
  torch<2.10 / non-sage; family normalization).

## Verification

- `node --check main.js` / `services/kernel-resolver.js` → syntax OK.
- `npm test` → 118 tests pass (incl. 6 new resolver cases).
- Safe wheel URL verified live (302 → `sageattention-2.2.0+cu128torch2.7.1-cp310-cp310-win_amd64.whl`).
- Built `Wan2GP-Desktop-Launcher-3.0.2-win-x64.exe`.
