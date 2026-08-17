# v2.8.1 — AMD installs now match the AMD guide (and NF4 kernels get installed)

Two installation-documentation gaps got closed. An audit against upstream's
[`INSTALLATION.md`](https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/INSTALLATION.md)
and [`AMD-INSTALLATION.md`](https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/AMD-INSTALLATION.md)
found situations the docs describe that neither Wan2GP's own setup script nor the
launcher actually handled — this release implements them launcher-side (the Wan2GP
repo stays untouched).

## Fixed

- **AMD machines now get the guide's session environment at every launch.**
  `AMD-INSTALLATION.md` says to set the ROCm session block at the start of every
  session. The launcher now applies it automatically — in-app, browser mode,
  external-terminal `.bat`/`.sh`, and desktop shortcuts — instead of the user
  having to create a custom `.bat`:
  - `HSA_OVERRIDE_GFX_VERSION` read from the repo's own `setup_config.json`
    profile (AMD_GFX110X → 11.0.0, AMD_GFX1151 → 11.5.1, AMD_GFX1201 → 12.0.1).
    Upstream `setup.py` declares this field but **never applies it** — so no AMD
    build was ever told which GPU family to target. That's why some RX 9xxx
    cards (native gfx1201) ran gfx110x wheels with no override.
  - `ROCM_HOME` and the llvm `PATH` entry are forwarded from `ROCM_ROOT`/`ROCM_BIN`
    (which TheRock puts in the user environment).
  - The guide's mandated flags: `CC=CXX=clang-cl`, `DISTUTILS_USE_SDK=1`,
    `FLASH_ATTENTION_TRITON_AMD_ENABLE=TRUE`,
    `TORCH_ROCM_AOTRITON_ENABLE_EXPERIMENTAL=1`, `MIOPEN_FIND_MODE=FAST`.
- **AMD GPU-family detection fixed.** RX **9060/9070** now resolve to the
  **AMD_GFX1201** profile (they used to fall back to GFX110X, so no HSA override
  was applied), and **890M / Strix Halo** APUs resolve to **AMD_GFX1151**.
  RX 7600/7700/7800/7900/780M stay on GFX110X.
- **bitsandbytes NF4 kernels are now installed.** The docs' `pip install
  bitsandbytes==0.49.2` step lives in **neither** `requirements.txt` **nor**
  `setup_config.json` — so no code path (Wan2GP's `setup.py`, update, or the
  launcher's install) ever installed it, and 4-bit/NF4 checkpoints silently fell
  back to slow CPU dequantization. The launcher's kernel-wheel sync now treats it
  like any other wheel: version-checked against the environment and installed
  (or upgraded to) **0.49.2** on install and update for the modern NVIDIA stack
  (RTX 20/30/40/50; the legacy GTX 10/16 cu128 profile is excluded, matching the
  docs' py311/cu13 section).

## Impact

- On AMD machines, every launch now logs
  `[*] AMD machine detected — applying ROCm session env: HSA_OVERRIDE_GFX_VERSION, …`
  before the server starts, and the same vars are baked into any generated
  terminal script or desktop shortcut.
- Non-AMD launches are untouched (the env block is empty for NVIDIA/Apple/Intel).
- After any Update on an RTX machine, the launch log shows
  `[*] Kernel 'bitsandbytes': installing 0.49.2… (had …)` or
  `[*] Kernel 'bitsandbytes': 0.49.2 — already current.`

> **Testing note:** the author does **not** own an AMD machine, so the AMD
> path was implemented from the upstream docs and config, not from on-hardware
> testing. **Feedback from AMD users is welcome** — report what your RX/Strix
> card reports and what the launch log shows (especially the HSA override line),
> and the installer will be adjusted accordingly.