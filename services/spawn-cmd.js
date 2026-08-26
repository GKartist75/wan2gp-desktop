/**
 * services/spawn-cmd.js — spawn a command on any platform WITHOUT the classic
 * Windows breakage modes:
 *
 *   1. "'C:\Program' is not recognized"  — a path WITH A SPACE (e.g. the default
 *      `C:\Program Files\nodejs\npm.cmd`) passed unquoted into `cmd /c` gets split
 *      on the space, so cmd tries to run `C:\Program`.
 *   2. "spawn EINVAL"  — a `.cmd`/`.bat` batch file spawned DIRECTLY (shell:false)
 *      is rejected by Windows CreateProcess, which throws EINVAL. Batch files MUST
 *      run through cmd.exe (a shell).
 *
 * The single correct rule:
 *   - If the resolved bin ends in `.cmd`/`.bat`  → run via `shell: true` with the
 *     bin QUOTED so the spaced path stays one token. (Windows npm/opencode shims.)
 *   - Otherwise (`.exe`, or a POSIX binary/script) → spawn DIRECTLY (shell:false);
 *     Node passes argv[0] whole, so spaces are inherently safe and there is no
 *     shell to misinterpret metacharacters.
 *
 * Args are assumed to be static/safe (validated callers: npm package name regex,
 * fixed serve flags). They are joined for the shell case; if you ever pass
 * user-derived args, escape them before calling this.
 *
 * @param {string} bin   resolved executable (from resolveCmd, may contain spaces)
 * @param {string[]} args argv (excluding argv[0])
 * @param {object} [opts] extra child_process.spawn options (cwd, env, timeout…)
 * @returns {import('child_process').ChildProcess}
 */
function isBatchFile(bin) {
  return /\.(cmd|bat)$/i.test(bin)
}

function spawnCmd(bin, args = [], opts = {}) {
  const { spawn } = require('child_process')
  if (isBatchFile(bin)) {
    // Quote the bin so "C:\Program Files\..." is one token; /s makes cmd honor it.
    const command = `"${bin}" ${args.join(' ')}`
    return spawn(command, [], { ...opts, shell: true })
  }
  return spawn(bin, args, { ...opts, shell: false })
}

module.exports = { spawnCmd, isBatchFile }
