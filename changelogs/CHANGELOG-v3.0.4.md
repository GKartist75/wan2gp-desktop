# Changelog — v3.0.4

**Topic:** Hotfix for the v3.0.3 SageAttention swap on **RTX 40/50**. v3.0.3 correctly
fixed the URL/export and pip-rejection bugs, but swapped in a **CUDA-12.8** SageAttention
wheel that **fails to import** in the launcher's **CUDA-13.0 / torch 2.10** environment.
This release corrects the swap target to a **CUDA-13.0-native, fp8-fixed** wheel.

> Bumped to **3.0.4** so the auto-updater offers it to everyone still on the broken
> 3.0.3 (a same-version re-upload would not trigger an update).

## 🐞 The v3.0.3 swap installed but then crashed at import

After v3.0.3 swapped the wheel, Wan2GP failed to start with:

```
File "C:\Wan2GP\env_conda\Lib\site-packages\sageattention\__init__.py", line 1, in <module>
from .core import sageattn, sageattn_varlen
...
from . import _fused
ImportError: DLL load failed while importing _fused: The specified module could not be found.
```

**Root cause:** v3.0.3 replaced the broken `cu130torch2.9.0andhigher.post4` wheel with
`sageattention-2.2.0+**cu128torch2.8.0-cp311-cp311**`. But the launcher installs
**torch 2.10 + CUDA 13.0** (`cu130`). A `cu128` SageAttention wheel's compiled
`_fused.pyd` extension links against **CUDA 12.8** runtime DLLs that are **not present**
in a cu130 environment — so the module can't load (`DLL load failed`). The swap was
"successful" at the pip level but the resulting wheel is **incompatible with the env**.

**Correct fix:** swap to a **CUDA-13.0-native** SageAttention wheel from the same
upstream release family. `v2.2.0-windows.post6` ships:

```
sageattention-2.2.0+cu130torch2.10.0andhigher.post6-cp310-abi3-win_amd64.whl
```

Why this one:
- **`cu130`** → built against CUDA 13.0, matching the env's torch 2.10/cu130 runtimes,
  so `_fused.pyd` loads correctly (no DLL error).
- **`cp310-abi3`** → abi3 wheel, installs on **Python 3.11** (the launcher's Python),
  so pip does not reject it (unlike a `cp310-cp310` build).
- **`.post6`** → the build where the **fp8 out-of-bounds bug** (black/noise outputs on
  RTX 40/50 under torch ≥ 2.10) is fixed (see SageAttention issue #98). It is the
  stable replacement for the broken `cu130torch2.9.0andhigher.post4` wheel — same
  CUDA stack, fp8-safe, full SageAttention2++ speed.

## What changed

- `services/kernel-resolver.js` — `applySageOverride` now swaps the broken
  `cu130torch2.9.0andhigher.post4` wheel for
  `cu130torch2.10.0andhigher.post6` (cu130-native, abi3, fp8-fixed). Constants
  renamed `SAGE_CU128_*` → `SAGE_CU130_SAFE_*`.
- `main.js` — `setSageAttentionSafe()` builds the URL from the renamed constants and
  logs the correct wheel.
- `tests/kernel-resolver.test.js` — assertions updated to the `cu130.post6` wheel.
- `package.json` — version `3.0.3 → 3.0.4`.

## Verification

- `npm test` → 118 pass. `node --check` on all sources OK.
- The `cu130torch2.10.0andhigher.post6` wheel is downloadable (HTTP 200, 16.6 MB) and
  contains `_fused.pyd` (cu130-linked).

## Upgrade

Install v3.0.4. **RTX 40/50** users: after updating, click **Sync Kernels** once (or run
one Update) to land on the stable `cu130.post6` SageAttention wheel. **RTX 30/20/older**:
no action needed (the swap only fires on RTX 40/50 + torch ≥ 2.10).

Full write-up: [CHANGELOG-v3.0.3.md](https://github.com/GKartist75/wan2gp-desktop/blob/main/changelogs/CHANGELOG-v3.0.3.md)
