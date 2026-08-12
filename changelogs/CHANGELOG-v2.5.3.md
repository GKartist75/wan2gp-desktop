# v2.5.3 — Self-healing updates for broken git repos

Updates now survive a damaged `.git` folder. If your Wan2GP install's git
metadata was left incomplete or quarantined (antivirus interference,
interrupted clone), every "Update" click used to die with
`fatal: not a git repository` — forever, with no working recovery. The
launcher now detects this state before updating and rebuilds the repository
automatically.

## Fixed

- **Updates stuck on `fatal: not a git repository` (issue #27).** A `.git`
  folder that exists but is unusable — missing `HEAD`/`config`/`index` from
  an antivirus quarantine or an interrupted first clone — makes every git
  command fail, and upstream's repair path only re-initializes when `.git`
  is *absent*. Result: every update failed identically, on existing
  installs and fresh ones. The launcher now pre-flights the git state
  before every update: a broken `.git` is moved aside (`.git.broken-<ts>`),
  and setup.py's built-in repair rebuilds the repository from scratch.
  Models, plugins, finetunes, and settings live outside `.git`, so nothing
  user-visible is lost.
- **A failed `setup.py update` no longer strands the update.** If pip or a
  dependency hiccuped, the whole update used to abort before the launcher's
  own git fetch/reset ran — leaving the repo without the latest code. A
  setup.py error is now logged and the launcher-side git update continues.
- **NVIDIA driver warning on update.** Updates now surface the same driver
  pre-check installs get (cu130 wheels need R580+), so a too-old driver
  can't silently break the latest stack.

## One-time manual fix if you already hit this

Rename the `.git` folder in your Wan2GP install directory to
`.git.broken` (or delete it — it contains no user data), then click
Update again. With v2.5.3 the launcher does this automatically.

Tests: 46/46 green.