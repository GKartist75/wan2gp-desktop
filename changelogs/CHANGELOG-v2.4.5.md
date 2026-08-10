# v2.4.5 — Update checks (periodic + manual), update-flow hardening, driver pre-check

**New — Wan2GP update checks (QOL)**

- The launcher no longer waits for a restart to tell you Wan2GP has an update.
  While the dashboard is open, it silently re-checks the upstream Wan2GP repo
  every **30 minutes** (no loading flash, skips while the dashboard is hidden
  in browser/popout mode).
- A **↻ Check for updates** link in the Wan2GP Updates card footer triggers a
  manual re-check at any time — the changelog refreshes on the spot.
- Upstream commit lookups are cached for **5 minutes** so the extra polling
  never exhausts the unauthenticated GitHub API rate limit (60 req/hr).
  Setting a token in Manage → Settings still applies for higher limits.

**Fixed — update flow no longer skips requirement bumps**

- The update handler now snapshots the pre-update `requirements.txt` state
  before `git reset --hard`, and if the file changed, force-reinstalls the
  requirements (`pip install -r requirements.txt`) after the reset. Previously,
  when the pull no-oped but the reset landed new code, a pin bump (e.g.
  `mmgp` 3.7.11 → 3.7.12) was silently never installed.
- AMD/Windows installs now pin `numpy==1.26.4` after install and update —
  ROCm "TheRock" wheels crash with numpy 2.1.2, which upstream's new
  requirements can pull in.

**New — NVIDIA driver pre-check**

- Install/update now reads the installed NVIDIA driver version and warns
  before proceeding when it is below **R580** (the CUDA 13.0 / cu130 floor
  the current torch build expects), unless your GPU is a GTX 10/16 series
  (which stays on the cu128 profile and is exempt).

**New — advanced launch args**

- All four launch paths (Desktop mode, Browser mode, both shortcut types)
  now pass `--advanced --multiple-images` to Wan2GP unless you already set
  them in Manage → Advanced, exposing the Steps Skipping tab and
  multiple-image support out of the box.

**Verification**

- Tests: 23/23 pass (`npm run test`).
- Live check on a running instance (CDP): link present, click fires the
  re-check, 30-min timer armed, changelog renders real upstream commits,
  update-dot state correct.
