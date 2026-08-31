# v3.1.6

## Env hint + Desktop Full/Quick update

**Active Environment:** `↻ Check Updates` hint moved directly below the header/button (grey `token-hint`, `use restore` for safe `requirements.txt` reinstall), button sized to `0.55rem` to match `restore`/`unlink`.

**Paths & Model Folders:** `After changing a folder...` hint changed from yellow `path-hint-warn` to grey `path-hint` (no border).

**Desktop auto-update:** banner now offers two choices — `Full Download` (93 MB full NSIS, `disableDifferentialDownload=true`, `sha512` verified, always works) and `Quick Update` (blockmap delta, `disableDifferentialDownload=false`, ~5-15 MB, faster but may fail if base is dev/modified or `C:\Program Files` locked). Fixes `3.1.3→3.1.4` delta corruption while keeping fast path. `Shift+Click` `Check Desktop Updates` → local `http://localhost:8888/latest.yml` for testing.

**Auto-check dedupe:** single launch check (`main.js` 5s delayed, respects `autoUpdateEnabled`) + 5h polling, removed duplicate `renderer` immediate poke — one GitHub API hit per launch.
