# Wan2GP Desktop Launcher v3.1.1

Bug-fix release — fixes the npm/OpenCode install failure on machines where Node lives in a path with a space.

## What changed
- **Fixed: "C:\Program is not recognized" on OpenCode / Codex install.** The guided
  LLM-engine install buttons ran `npm install -g <pkg>` through a shell
  (`shell: true`) with the resolved npm path passed **unquoted**. When Node is
  installed in the default `C:\Program Files\nodejs` (note the space), `cmd.exe`
  split the path on the space and tried to run `C:\Program`, failing with
  `'C:\Program' is not recognized as an internal or external command`. This hit
  every user whose Node lives under `Program Files` — the normal install
  location — which is why Claude Code sometimes worked (nvm-based, space-free
  path) but OpenCode did not.
  - The install now **spawns the resolved npm shim directly with an argv array
    and no shell**, so the path is passed as a single token regardless of spaces.
    The same fix was applied to the **OpenCode server start** (`opencode serve`),
    which had the identical `shell: true` bug.
  - `services/spawn-npm.js` centralizes the command construction; `main.js` uses
    it for both the install and (via the same no-shell pattern) the serve step.
- **Tests:** added `tests/spawn-npm.test.js` (3 cases) asserting the install
  command is built with **no shell** and an argv array, including a
  `C:\Program Files\nodejs\npm.cmd` path. Suite now **176 passing** (was 173).

## Upgrade
Install over 3.1.0. Non-disruptive — launcher-only change. After updating, the
**OpenCode** / **Codex** "Install via npm" buttons work on any Node install
location, and **Start server** for OpenCode launches correctly.
