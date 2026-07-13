# Prerequisites & Manual Setup

The Wan2GP Desktop Launcher installs these tools automatically if they're missing.
This page is for when you'd rather set them up yourself, or need to troubleshoot.

| Tool                           | Needed for                  | Auto-install | Manual                                                              |
| ------------------------------ | --------------------------- | ------------ | ------------------------------------------------------------------- |
| **Git**                        | Clone repo                  | ✅           | [git-scm.com](https://git-scm.com/downloads)                        |
| **Python 3.11**                | env creation                | ✅ via uv    | [python.org](https://www.python.org/downloads)                      |
| **uv** (optional)              | Faster installs             | ✅           | [docs.astral.sh/uv](https://docs.astral.sh/uv/#installation)        |
| **Miniconda** (optional)       | `conda` envs                | ✅           | [docs.anaconda.com/miniconda](https://docs.anaconda.com/miniconda/) |
| **NVIDIA GPU + driver**        | Running Wan2GP (CUDA 12.8+) | ❌           | [nvidia.com/drivers](https://www.nvidia.com/drivers)                |
| **~50 GB free** + **Internet** | Repo + models + deps        | —            | —                                                                   |

## Notes

- **Git** — required to clone the Wan2GP repository.
- **Python 3.11** — the launcher builds its environment on this interpreter via uv;
  a newer system Python (e.g. 3.14) will not work and is not used.
- **uv / Miniconda** — optional; the launcher can install either for you. `uv` is
  recommended for faster, wheel-based installs.
- **NVIDIA GPU + driver** — cannot be auto-installed. Wan2GP needs CUDA 12.8 or
  newer to run.
- **Disk & network** — the repo, models, and dependencies need roughly 50 GB and a
  working internet connection on first setup.
