# Wan2GP Desktop Launcher v2.3.0

**Settings repair, multi-GPU, issue reporting, and tests** — a one-click tool to fix
the "Value is not in the list of choices" settings-save error (no more hand-editing
`_settings.json`), a device picker that lets multi-GPU systems choose which GPU
Wan2GP runs on, a report-an-issue bundler that gathers system info + launch log +
error queue into a zip with a pre-filled GitHub issue, and a first real test suite
plus CI.

## New Features

- **Repair Settings** — Manage → General → *Scan & Repair Settings*. Fixes the
  `Value: N is not in the list of choices: [0, 1]` settings-save error (GitHub
  issue #7) in one click: scans `models/`, `settings/`, and `finetunes/` for
  `*_settings.json` files, resets out-of-range dropdown values (`apg_switch`,
  `cfg_star_switch`, `multi_images_gen_type`) to valid ones, and backs each edited
  file up as `*.bak-repair`. File formatting and line endings are preserved.
- **Multi-GPU device picker** — Manage → Launch → *GPU Device*. Detects every GPU
  (NVIDIA via `nvidia-smi`, others via WMI), lets you pick which one Wan2GP runs
  on (`cuda:N`), and passes it as `--gpu cuda:N` at launch — in both browser and
  desktop modes. *Auto* keeps the previous behavior.
- **Report an issue** — Manage → About → *🐞 Report an issue…*. Bundles your
  launcher version, Wan2GP commit, GPU/OS/RAM, the last launch-log lines, and the
  core's `error_queue.zip` into a single zip, opens it in Explorer, and opens a
  GitHub issue pre-filled with the details — no more "please paste your launch log".

## Fixes

- **Release script version drift** — `scripts/release-win.sh` hardcoded `2.2.3`
  while the app was at `2.2.4`. It now reads the version from `package.json`
  automatically, so the release artifact can never be built with the wrong version.
- **Test suite could not run** — `node --test tests/` discovered nothing and the
  quoted-glob form was taken literally. `npm test` now pins the explicit test file
  list (18 tests, zero dependencies).

## Improvements

- **Packaged app slimmer** — the installer no longer ships `tests/`, `.github/`,
  or `dist/` (verified inside the packaged `app.asar`).
- **Repair logic shared** — the settings-clamp logic lives in
  `services/settings-repair.js`, required by both the main process and the test
  suite, so tests exercise exactly the shipped code.

## Infrastructure

- **Test suite (first ever)** — 18 tests with Node's built-in `node:test` (zero
  dependencies): 9 for settings repair (clamping, backups, CRLF preservation, file
  collection) and 9 for Auto-Tune (profile matrix, VRAM coefficients, per-job
  multipliers).
- **CI** — `.github/workflows/ci.yml`: syntax checks + `npm test` on every push/PR,
  and a Windows installer build on version tags (exe + blockmap + latest.yml
  artifacts).
- **Updated README** — version badge and release notes for v2.3.0.
- **Full changelog history** in [changelogs/](changelogs/).
