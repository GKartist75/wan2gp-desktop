/**
 * Regression tests for services/spawn-cmd.js — the safe cross-platform spawn
 * helper. These guard against the two classic Windows breakage modes:
 *
 *   1. "'C:\Program' is not recognized" — a spaced path (default
 *      "C:\Program Files\nodejs\npm.cmd") passed unquoted into cmd split on the
 *      space. Fixed by QUOTING the bin when using a shell.
 *   2. "spawn EINVAL" — a .cmd/.bat spawned DIRECTLY (no shell) is rejected by
 *      Windows CreateProcess. Fixed by routing .cmd/.bat through a shell (quoted).
 *
 * Real .exe / POSIX binaries spawn directly (argv[0] is passed whole, so spaces
 * are inherently safe and no shell can misinterpret metacharacters).
 *
 * We assert the *command form* each case produces by spying on child_process.
 */
const { test } = require('node:test')
const assert = require('node:assert')
const cp = require('child_process')
const { spawnCmd, isBatchFile } = require('../services/spawn-cmd.js')

test('isBatchFile detects .cmd/.bat', () => {
  assert.strictEqual(isBatchFile('C:\\Program Files\\nodejs\\npm.cmd'), true)
  assert.strictEqual(isBatchFile('opencode.bat'), true)
  assert.strictEqual(isBatchFile('C:\\nvm4w\\nodejs\\opencode.exe'), false)
  assert.strictEqual(isBatchFile('opencode'), false)
})

test('a .cmd shim under a spaced path is spawned via a QUOTED shell command (no EINVAL, no space-split)', () => {
  const calls = []
  const origSpawn = cp.spawn
  cp.spawn = (command, args, opts) => { calls.push({ command, args, opts }); return { on() {} } }
  try {
    spawnCmd('C:\\Program Files\\nodejs\\npm.cmd', ['install', '-g', 'opencode-ai'], { cwd: 'X', windowsHide: true })
  } finally { cp.spawn = origSpawn }

  assert.strictEqual(calls.length, 1, 'expected exactly one spawn')
  const { command, args, opts } = calls[0]
  // shell:true with the bin quoted as the first token of the command string
  assert.strictEqual(opts.shell, true)
  // The bin must be the FIRST token, wrapped in quotes, followed by a space
  // before the args. cmd /d /s /c "<quoted bin>" args keeps it one token.
  assert.ok(command.startsWith('"C:\\Program Files\\nodejs\\npm.cmd" '),
    'spaced .cmd bin must be quoted at the start: ' + command)
  // The quoted segment must equal the FULL bin (no premature unquote/split).
  const m = command.match(/^"([^"]+)" /)
  assert.ok(m, 'expected a quoted bin token at the start')
  assert.strictEqual(m[1], 'C:\\Program Files\\nodejs\\npm.cmd')
  assert.deepStrictEqual(args, [])
})

test('a real .exe spawns directly without a shell (argv[0] whole)', () => {
  const calls = []
  const origSpawn = cp.spawn
  cp.spawn = (command, args, opts) => { calls.push({ command, args, opts }); return { on() {} } }
  try {
    spawnCmd('C:\\Program Files\\nodejs\\opencode.exe', ['serve', '--port', '4096'], { cwd: 'X' })
  } finally { cp.spawn = origSpawn }

  assert.strictEqual(calls.length, 1)
  const { command, args, opts } = calls[0]
  assert.strictEqual(opts.shell, false, 'real .exe must NOT use a shell')
  assert.strictEqual(command, 'C:\\Program Files\\nodejs\\opencode.exe')
  assert.deepStrictEqual(args, ['serve', '--port', '4096'])
})
