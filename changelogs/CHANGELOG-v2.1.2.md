# Wan2GP Desktop Launcher v2.1.2 — Release Notes

## 🐛 Bug Fixes
- **Wrong Python version in install** — the installer could fall back to a system Python 3.14 when 3.11 was unavailable, building the venv on 3.14. Several pinned deps (notably `pygame`) have no 3.14 wheel and failed to build (`ModuleNotFoundError: No module named 'setuptools._distutils.msvccompiler'`). The installer now resolves Python **3.11 via uv** (`uv python find 3.11`, falling back to `python3.11`) before creating the environment, and warns instead of silently degrading. Fixes the pygame build crash and the same class of failures for `insightface`/`flash-attn`/`triton-windows`.
- **Mirrored in standard scripts** — `scripts/install.bat` and `scripts/install.sh` now resolve the 3.11 interpreter the same way.

## 📝 Docs
- README rewritten to lead with ease of use: auto-install of prerequisites, hardware detection, and correct-env creation front and center. Compacted from 148 to ~55 lines.

## 📋 Changelog
See [README.md](README.md) for the full feature list.
