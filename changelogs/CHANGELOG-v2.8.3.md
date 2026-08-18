# v2.8.3 — black-screen regression fix (window showed then vanished)

Issue #45 reported the launcher opening to a black screen on fresh installs
across NVIDIA (RTX 5050 / RTX 4090) and AMD (9070XT) GPUs, Windows 10/11.
Several reporters saw the HTML render for ~0.5s and then the window go blank,
and the v2.8.2 GPU-off override file did **not** help — which ruled out the
GPU-compositor cause that v2.8.2 had targeted (that one, issue #39, is a
different class and the GPU-off flag still fixes it).

## Root cause
v2.8.2 changed the window show path: it showed the window on `did-finish-load`
(HTML parsed) instead of only on `ready-to-show`. On some GPUs/drivers that
double show/hide ordering made the window appear and then disappear — matching
the "shows for half a second then vanishes" reports. v2.6.0 showed only on
`ready-to-show` and did not exhibit this.

## Fixed
- **Reverted to show-on-`ready-to-show`** (the v2.6 behavior). The window no
  longer shows on `did-finish-load`, eliminating the show/hide race.
- **Boot tracer** — every launch writes `<dataDir>/boot.log` with the exact
  show/hide/paint timeline (`createWindow`, `did-finish-load`,
  `did-start-loading`, `did-stop-loading`, `first-paint`, `ready-to-show`,
  `show`, `hide`, `close`, `closed`, and the resolved `dataDir` +
  `windowState`). A black-screened user can send this file without needing the
  (blank) UI, so future reports are self-diagnosing.
- **"Report an issue" bundle now includes `windowState` + the last 25 boot-log
  marks**, so the existing About → Report an issue button captures the geometry
  and boot timeline needed to diagnose black-screen reports.

## Note
The v2.8.2 GPU-off override (`%USERPROFILE%\.wan2gp-desktop-gpu-off`) remains
the fix for the *compositor/present* class of black screens (issue #39). This
release fixes the separate *show-path* regression that 2.8.2 introduced.
