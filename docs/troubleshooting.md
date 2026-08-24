# Troubleshooting

## ⚠️ Temporary fix: Z-Image crash on generation

If Z-Image generation crashes right after sampling starts with:

```
RuntimeError: Input type (struct c10::BFloat16) and bias type (struct c10::Half) should be the same
```

that's a known Wan2GP core bug. The Z-Image pipeline casts the sampled latents to the **transformer's** dtype (bf16 for bf16-quantized checkpoints like `ZImageTurbo_quanto_bf16_int8`), but Wan2GP loads the **VAE** as fp16 by default — and `F.conv2d` requires both to match. Setting `vae_precision="32"` does **not** help (fp32 VAE + bf16 latents fails identically).

**v2.2.4+ applies a temporary workaround automatically at every launch:** the launcher's bootstrap forces the Z-Image VAE to load as **bf16** (the checkpoint's native precision) to match the latents, so Z-Image generation works out of the box. You'll see `[bootstrap] z-image VAE dtype fix APPLIED (bf16)` in the console — no action needed.

The permanent fix is upstream: **[PR #2095](https://github.com/deepbeepmeep/Wan2GP/pull/2095)** (`latents.to(self.vae.dtype)` at the VAE decode boundary). Once it's merged, the workaround becomes a harmless no-op — nothing to uninstall or configure.

## Blank / black window after an in-app update

If the launcher opens to a **title bar only, no content** right after using **Check for updates → Download → Install & Restart** (and a clean older version worked):

1. The update likely left a partial `app.asar` because a file was locked during the swap. **Uninstall**, then reinstall the latest `.exe` from [Releases](https://github.com/GKartist75/wan2gp-desktop/releases) with the launcher **fully closed**.
2. Still blank? Open `%LOCALAPPDATA%\Wan2GP Desktop Launcher\boot.log` to tell the two remaining classes apart:
   - **`ready-to-show -> show()` present, no `first-paint` mark** = presentation class (issue #45, part 2). v2.8.5 force-commits a frame via `webContents.invalidate()`; if it still fails, create an empty file `%USERPROFILE%\.wan2gp-desktop-gpu-off` and restart (disables hardware acceleration — the GPU-compositor class, issue #39).
   - **`did-fail-load` mark, no `first-paint`** = corrupt bundle (update class), reinstall as in step 1.

v2.8.5+ prevents the update class at the source (releases all handles before the installer swap) and force-commits the first frame so the presentation class paints.

## Prerequisites

No need to pre-install anything — the launcher sets up Git, Python 3.11, uv, and Miniconda for you automatically. To actually run Wan2GP you'll need an NVIDIA GPU + driver (CUDA 12.8+) and an internet connection. The launcher itself is about 90 MB to download and 250 MB installed.

For manual installation or troubleshooting of any prerequisite, see [PREREQUISITES.md](../PREREQUISITES.md).
