/**
 * services/spawn-npm.js — build the spawn options for an `npm install` of a
 * remote-LLM engine CLI (Codex / OpenCode) WITHOUT a shell.
 *
 * Why no shell: `resolveCmd` returns the concrete npm/engine shim (e.g.
 * `C:\Program Files\nodejs\npm.cmd` on Windows). Passing that path into
 * `cmd.exe /c "<path> install -g pkg"` UNQUOTED makes cmd split on the space
 * in "Program Files" and try to run `C:\Program` — the exact
 * "'C:\Program' is not recognized" error some users hit. Spawning the resolved
 * shim directly with an argv array avoids the shell entirely, so paths with
 * spaces are passed whole. This is safe on every platform because resolveCmd
 * already returns a real .cmd/.exe on Windows and the bare binary elsewhere.
 *
 * @param {string} bin  resolved npm/engine path from resolveCmd
 * @param {string} pkg  bare npm package name (already validated by caller)
 * @param {{global?: boolean}} [opts]
 * @returns {{cmd: string, args: string[], spawnOpts: object}}
 */
function npmInstallSpawn(bin, pkg, opts = {}) {
  const args = opts.global ? ['install', '-g', pkg] : ['install', pkg]
  return {
    cmd: bin,
    args,
    // shell:false (default) — pass the path as a single argv token so spaces
    // in e.g. "C:\Program Files" are never interpreted by a shell.
    spawnOpts: { windowsHide: true }
  }
}

module.exports = { npmInstallSpawn }
