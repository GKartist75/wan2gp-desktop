/**
 * Regression tests for services/spawn-npm.js — the npm install command builder.
 *
 * These guard the "'C:\Program' is not recognized" bug: when npm lives under a
 * path with a space (e.g. the default "C:\Program Files\nodejs\npm.cmd"), the
 * launcher must spawn it directly with an argv array (no shell), so the path is
 * passed as one token and never split by cmd.exe.
 */
const { test } = require('node:test')
const assert = require('node:assert')
const { npmInstallSpawn } = require('../services/spawn-npm.js')

test('builds a global install argv without a shell', () => {
  const { cmd, args, spawnOpts } = npmInstallSpawn('C:\\Program Files\\nodejs\\npm.cmd', 'opencode-ai', { global: true })
  assert.strictEqual(cmd, 'C:\\Program Files\\nodejs\\npm.cmd')
  assert.deepStrictEqual(args, ['install', '-g', 'opencode-ai'])
  // The whole point: no shell, so the space in Program Files is never split.
  assert.strictEqual(spawnOpts.shell, undefined)
})

test('builds a local install argv without a shell', () => {
  const { cmd, args, spawnOpts } = npmInstallSpawn('C:\\nvm4w\\nodejs\\npm.cmd', '@openai/codex', { global: false })
  assert.strictEqual(cmd, 'C:\\nvm4w\\nodejs\\npm.cmd')
  assert.deepStrictEqual(args, ['install', '@openai/codex'])
  assert.strictEqual(spawnOpts.shell, undefined)
})

test('spawnOpts never enable a shell', () => {
  const { spawnOpts } = npmInstallSpawn('npm', 'opencode-ai', { global: true })
  assert.notStrictEqual(spawnOpts.shell, true)
})
