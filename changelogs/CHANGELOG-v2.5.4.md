# v2.5.4 — No more phantom "local changes" backups

Updates previously warned `[!] Local changes in the Wan2GP repo will be
overwritten — backup saved: ...` whenever *any* untracked file sat in the
install directory (e.g. the `envs.json` that setup.py writes at install).
`git reset --hard` never touches untracked files — nothing was ever at
risk — and `git diff` had nothing to capture, so every "backup" was an
empty 0-byte `.patch` file sitting in `patches/`.

## Fixed

- **The backup warning only fires when it means it.** The dirty-repo guard
  now keys off `git diff` (real edits to tracked files, like a hand-patched
  `wgp.py`), not `git status --porcelain` (which also counts untracked
  files). Untracked files produce no warning and no bogus empty patch.
- **Real edits are still backed up exactly as before.** If you ever do
  modify a tracked file, the launcher still saves a pre-update patch and
  tells you where it is.

## Impact

- Only-untracked-files installs: no more warning, no more empty backups.
- Everyone else: unchanged — tracked edits still get a genuine backup.

Tests: 46/46 green.