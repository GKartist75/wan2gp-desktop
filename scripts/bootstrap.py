#!/usr/bin/env python3
"""DEPRECATED / SUPERSEDED — kept for reference only.

The launcher embeds the canonical bootstrap inline in main.js (BOOTSTRAP_LINES)
and writes it to disk at runtime, so the file this script points at is the one
that actually runs. This standalone copy is NOT used by the launcher; it exists
so the technique is documented outside the JS.

The inline copy (main.js) includes the z-image VAE dtype fix
(_patch_zimage_vae_dtype), which this file mirrors below so the two copies
don't drift.

Wan2GP Desktop progress-forcing bootstrap.

Patches sys.stderr and sys.stdout so that tqdm, huggingface_hub,
and any other progress-bar library believe they are writing to a
real terminal. Without this, output pipes suppress progress bars
even when HF_HUB_DISABLE_PROGRESS_BARS=0 and TQDM_DISABLE=0.

Usage: python bootstrap.py <target_script> [args...]

The target script (wgp.py, setup.py, etc.) receives its own args.
"""
import os
import sys
import runpy


def _patch_tty():
    """Wrap stderr/stdout so isatty() always returns True."""
    # ── Force progress-bar env vars (override parent) ──
    os.environ["PYTHONUNBUFFERED"] = "1"
    os.environ["TQDM_DISABLE"] = "0"
    os.environ["TQDM_MININTERVAL"] = "0"
    os.environ["TQDM_MINITERS"] = "1"
    os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "0"
    os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "0"  # keep std Python downloader
    os.environ["TERM"] = "xterm-256color"

    # ── Patch streams to pretend they are TTYs ──
    class _TTYStream:
        """Proxy that lies about isatty() so progress bars render on pipes."""

        __slots__ = ("_inner",)

        def __init__(self, inner):
            self._inner = inner

        def isatty(self):
            return True

        def __getattr__(self, name):
            return getattr(self._inner, name)

        def fileno(self):
            # Some libraries (tqdm) want a real fileno for ncols detection.
            # If the inner stream has one, forward it; otherwise fall back.
            try:
                return self._inner.fileno()
            except OSError:
                raise  # propagate properly

    # Patch both the public streams AND the private __std*__ references
    # (some libraries bypass sys.stderr and use sys.__stderr__ directly).
    sys.stderr = _TTYStream(sys.stderr)
    sys.stdout = _TTYStream(sys.stdout)
    sys.__stderr__ = sys.stderr
    sys.__stdout__ = sys.stdout

    # Announce bootstrap is active (visible in console logs)
    print("[bootstrap] active", flush=True)


def _patch_zimage_vae_dtype():
    """Mirror of the inline main.js fix (BOOTSTRAP_LINES).

    Z-Image: pipeline casts latents to the transformer dtype (bf16) before VAE
    decode (pipeline_z_image.py ~:978), but wgp.py loads the VAE as fp16 by
    default (vae_precision=16) -> F.conv2d "Input type (BFloat16) and bias type
    (Half)" crash. The ZImageTurbo VAE checkpoint is natively bf16 (and fp32
    VAE crashes too), so force the z-image factory to load the VAE as bf16.
    Deferred via a meta-path finder so a missing unrelated dep at bootstrap
    startup (e.g. accelerate) can't abort the fix.
    """
    import importlib.abc

    class _ZImageArm(importlib.abc.MetaPathFinder):
        def find_spec(self, name, path, target=None):
            if name == "models.z_image.z_image_main":
                sys.meta_path.remove(self)
                try:
                    import torch
                    import models.z_image.z_image_main as _zim

                    _orig_init = _zim.model_factory.__init__

                    def _init(self, *a, **kw):
                        kw["VAE_dtype"] = torch.bfloat16
                        return _orig_init(self, *a, **kw)

                    _zim.model_factory.__init__ = _init
                    print("[bootstrap] z-image VAE dtype fix armed (bf16)", flush=True)
                except Exception as e:
                    print("[bootstrap] z-image VAE dtype fix skipped: " + repr(e), flush=True)
            return None

    sys.meta_path.insert(0, _ZImageArm())
    print("[bootstrap] z-image VAE dtype fix deferred (armed on first z_image import)", flush=True)


def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith("-"):
        print(
            f"Usage: {os.path.basename(sys.argv[0])} <target_script> [args...]",
            file=sys.stderr,
        )
        sys.exit(1)

    target = os.path.abspath(sys.argv[1])
    if not os.path.isfile(target):
        print(f"[bootstrap] Target script not found: {target}", file=sys.stderr)
        sys.exit(1)

    # Patch BEFORE running the target
    _patch_tty()
    _patch_zimage_vae_dtype()

    # Hand argv to the target (remove bootstrap path from argv[0])
    sys.argv = sys.argv[1:]

    # Insert target's directory into the module search path
    target_dir = os.path.dirname(target)
    if target_dir not in sys.path:
        sys.path.insert(0, target_dir)

    # Run the target script
    runpy.run_path(target, run_name="__main__")


if __name__ == "__main__":
    main()
