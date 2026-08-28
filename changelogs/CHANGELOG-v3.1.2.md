# Wan2GP Desktop Launcher v3.1.2

Patch release — actually ships the OpenCode / npm spawn fix that v3.1.1 described but missed.

## What changed
- **Ships the OpenCode `spawn EINVAL` fix.** v3.1.1's changelog documented the
  `services/spawn-cmd.js` fix, but the v3.1.1 tag (`056d7b7`, 21:42) was cut
  **11 minutes before** the fix commit `329c095` (21:53). So the released 3.1.1
  EXE still contains the broken `shell:false` spawn path and the old
  `services/spawn-npm.js`. v3.1.2 is built from `main` (`8bc15b4`), which
  **does** include `spawn-cmd.js` and the corrected `main.js` call sites.
- The `spawn-cmd.js` rule (unchanged from the intended fix): a `.cmd`/`.bat`
  shim (e.g. `npm`/`opencode` under `C:\Program Files\nodejs`) runs via a shell
  **with the path QUOTED**, so the space stays one token and the batch file
  executes (no `spawn EINVAL`); a real `.exe` spawns **directly** (argv[0]
  passed whole, no shell to misinterpret it). Both the `'C:\Program' is not
  recognized` and `spawn EINVAL` failure modes are fixed on any Node location.
- **Tests:** `tests/spawn-cmd.test.js` pins both cases (spaced `.cmd` via quoted
  shell, real `.exe` direct). `tests/spawn-npm.test.js` removed.

## Upgrade
Install over 3.1.1. Non-disruptive — launcher-only change. After updating, the
**OpenCode** / **Codex** "Install via npm" buttons and the OpenCode **Start
server** toggle work regardless of where Node is installed.
