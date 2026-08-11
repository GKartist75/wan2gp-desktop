# v2.5.0 — Auto-Tune overhaul: aligned profiles, working VRAM coefficient, no more freezes

**Fixed — Auto-Tune now actually does what it shows**

- **`vram_safety_coefficient` is no longer a dead setting.** The coefficient
  Auto-Tune wrote to `wgp_config.json` was silently ignored — Wan2GP only reads
  it from the command line (`shared/cli_args.py:35`), defaulting to 0.8, and the
  launcher never passed it. The launcher now forwards the tuned coefficient as
  `--vram-safety-coefficient` on every launch (browser and terminal mode), so
  0.70 on <12GB cards is real. Explicit values in Extra Launch Args still win.
- **Audio generation no longer silently crawls at <1 token/sec.** Cards with
  12–23GB VRAM were getting their *video* profile reused as the audio profile
  (P4/P5), which bypasses Wan2GP's fast LM decoders (`int(profile) in (1, 3)`,
  wgp.py) and falls back to a legacy decoder that makes audio look hung for
  10–15 minutes. Audio profile now follows Maestro's rule: **profile 3 on any
  ≥12GB card** whose video profile isn't 1 or 3.
- **12GB/32GB machines are no longer downgraded to P5.** The install-time
  defaults and the Auto-Tune tab used two different tier tables; a 12GB +
  32GB machine installed at P4 then "improved" itself to P5 on the first
  Detect. Both now share one engine realigned to Wan2GP's own profile table
  (≥24 / 12–23 / <12 GB VRAM × ≥64 / ≥32 / <32 GB RAM).
- **Detect no longer freezes the app for ~30 seconds.** Hardware probes ran
  synchronously in the Electron main process (nvidia-smi 10s + python import
  probes up to 5s each). Detection is now async with bounded per-probe
  timeouts; on multi-GPU machines the highest-VRAM NVIDIA card is used.
- **RTX 30 (Ampere) cards no longer get the wrong attention backend.** The
  installer set `sage2` for RTX 30; sage2 is sm90+ only, so Ampere silently
  fell back or errored. RTX 30/20 now get `sage` v1, RTX 40/50 keep `sage2`.
- **Detect detects, Apply applies.** Detect previously wrote settings without
  asking; now it only scans and recommends. Apply explicitly states Wan2GP
  must be restarted (config is read once at startup).
- **Non-NVIDIA hardware is clearly labeled.** Auto-Tune shows "Auto-tune
  unavailable on this hardware" and disables Apply instead of silently
  assigning P5.
- **First-boot auto-tune.** A brand-new install now gets one automatic
  detect → recommend → apply pass at install time (Maestro parity). Existing
  installs are never touched automatically — manual tuning always wins.
- **VAE config labels corrected** to what the core actually implements
  (1 = full/untiled, 2 = tiling 256, 3 = aggressive tiling 128) and chosen per
  VRAM tier (1 for ≥24GB, auto for 12–23GB, 3 for <12GB).
- **Failsafe preference.** A checkbox in the Auto-Tune tab forces the P5
  maximum-compatibility profile (with a 0.60 safety coefficient and aggressive
  VAE tiling) regardless of the tier matrix — for hardware where the recommended
  profile still crashes. Toggling re-renders the recommendation live.
- **Fixed a crash in the recommendation card** where Detect threw
  "profileSelect is not defined" — the dropdown helper functions were lost in
  the UI rework and are restored.
- **Config writes always go to the repo dir** — `wgp_config.json` discovery
  now prefers the Wan2GP install dir over the launcher's working directory, so
  a stray config in the packaged app's folder can't swallow your tuning.

**Tests**

- `tests/auto-tune.test.js` rewritten around the new engine: tier matrix,
  audio-profile rule, coefficient policy, VAE tiers, no-CUDA fallback and
  config-discovery order (13 tests, full suite 28/28 green).