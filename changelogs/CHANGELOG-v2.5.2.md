# v2.5.2 — Async hardware detection, model-path repair, update safety, injection hardening

Hardware detection never freezes the app anymore, model downloads that died
with "error in getting the location" get auto-repaired, updates back up your
local edits before resetting, and nothing from a remote repo can execute in
the dashboard.

## Fixed

- **Hardware detection no longer freezes the whole app.** GPU/RAM probing ran
  synchronously in the main process — up to 8–10s per probe and a ~15–20s
  frozen window on machines where `nvidia-smi` is slow or absent. `detect-gpu`,
  the multi-GPU device list, and the dashboard hardware card all now use the
  shared async probe engine; the UI stays responsive while detection runs.

- **"Error in getting the location" when downloading models (issue #18).**
  `wgp_config.json` entries that resolve *inside* the Wan2GP repo itself
  (e.g. `./Wan2GP/ckpts` or a doubly-nested absolute path) make the HF
  downloader fail with `[WinError 3] The system cannot find the path
  specified` — the location lands in a nested folder Wan2GP never reads.
  **Repair Settings** now detects these (checkpoints, LoRAs, save paths) and
  rewrites them to the launcher's data-dir model home, with a
  `wgp_config.json.bak-repair` backup. A **silent background scan** runs once
  on dashboard load and fixes the same issue before it bites — it only speaks
  up when something was actually repaired.

- **Updates no longer silently destroy local edits.** If the Wan2GP repo has
  uncommitted changes (say, a hand-patched `.py`), the update's hard reset
  would wipe them. The launcher now detects the dirty repo, saves a
  `pre-update-<timestamp>.patch` to the launcher data dir, and tells you where
  the backup lives before resetting.

- **Auto-Tune showed an empty panel on first visit.** Opening the Auto-Tune tab
  now auto-runs detection once per session, so you get a live recommendation
  instead of a "Run detection first" wall. A failed detect leaves the button
  enabled for a manual retry.

## Hardened

- **HTML injection hardening.** Content that comes from outside the app —
  upstream Wan2GP commit messages and authors, environment names, installer
  package lists — used to be spliced into the DOM raw; a hostile commit
  message could run script in the dashboard. All rendering now goes through a
  single HTML-escaping helper (`services/escape.js`) shared with the test
  suite, loaded as a plain page script so the sandboxed preload stays clean.

## Faster

- **Terminal rendering** is coalesced to one paint per frame — a pip/log flood
  used to rebuild up to three full 5,000-line console bodies per chunk.
- Hidden consoles (webview mode, floating overlay) skip rendering entirely and
  flush on show.
- **Dashboard refresh** batches its three IPC calls into one round-trip;
  system-metric polling and update checks pause while the dashboard is hidden.

Tests: 46/46 green (11 new — nested model-path repair + escaping).