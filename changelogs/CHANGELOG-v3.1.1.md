# Wan2GP Desktop Launcher v3.1.1

Bug-fix release — fixes the guided LLM-engine install + OpenCode server start on Windows.

## What changed
- **Fixed: "C:\Program is not recognized" + "spawn EINVAL" on OpenCode / Codex install & Start server.**
  Both guided buttons ran the resolved `npm` / `opencode` shim, and the failure mode
  depended on how the path was passed:
  - With `shell: true` and the path **unquoted**, a Node installed in the default
    `C:\Program Files\nodejs` (note the space) made `cmd.exe` split on the space and
    try to run `C:\Program` → `'C:\Program' is not recognized`.
  - With `shell: false` (a naive "fix"), a `.cmd` shim spawned **directly** is
    rejected by Windows `CreateProcess` → **`spawn EINVAL`** (this was the regression
    that produced the "Start Server OpenCode → spawn EINVAL" report).
  - The correct rule (now in `services/spawn-cmd.js`): a `.cmd`/`.bat` shim runs via
    a shell **with the path QUOTED** (`cmd /d /s /c "<path>" args`), so the space
    stays one token and the batch file actually executes; a real `.exe` (or POSIX
    binary) spawns **directly** (argv[0] is passed whole, no shell to misinterpret
    it). This fixes both bugs at once and works on any Node install location.
- **Tests:** `tests/spawn-cmd.test.js` pins both cases — a spaced `.cmd` is spawned
  via a quoted shell command (no EINVAL, no space-split), and a real `.exe` spawns
  directly without a shell. Suite now **176 passing** (was 173).

## Upgrade
Install over 3.1.0. Non-disruptive — launcher-only change. After updating, the
**OpenCode** / **Codex** "Install via npm" buttons and the OpenCode **Start server**
toggle work regardless of where Node is installed.
