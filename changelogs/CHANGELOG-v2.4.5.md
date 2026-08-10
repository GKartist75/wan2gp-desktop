# v2.4.5 — Wan2GP update checks: periodic + manual (QOL)

**New**

- The launcher no longer waits for a restart to tell you Wan2GP has an update.
  While the dashboard is open, it silently re-checks the upstream Wan2GP repo
  every **30 minutes** (no loading flash, skips while the dashboard is hidden
  in browser/popout mode).
- A **↻ Check for updates** link in the Wan2GP Updates card footer triggers a
  manual re-check at any time — the changelog refreshes on the spot.
- Upstream commit lookups are cached for **5 minutes** so the extra polling
  never exhausts the unauthenticated GitHub API rate limit (60 req/hr).
  Setting a token in Manage → Settings still applies for higher limits.

**Verification**

- Tests: 23/23 pass (`npm run test`).
- Live check on a running instance (CDP): link present, click fires the
  re-check, 30-min timer armed, changelog renders real upstream commits,
  update-dot state correct.
