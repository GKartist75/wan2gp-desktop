/**
 * Tests for services/resolve-cmd.js — locates Windows .cmd shims for npm /
 * npx / opencode so the launcher can spawn them (avoids ENOENT when a double-
 * clicked .exe doesn't inherit the user's PATH).
 */
const { test } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const { resolveCmd } = require('../services/resolve-cmd.js')

// Fake fs that only reports <root>/nvm4w/nodejs/npm.cmd as existing.
function fakeFs(existing) {
  return { existsSync: (p) => existing.includes(p) }
}
const ROOT = 'C:\\nvm4w\\nodejs'
const NPM_CMD = path.join(ROOT, 'npm.cmd')

test('resolves npm.cmd from an extra dir when not on PATH', () => {
  const fs = fakeFs([NPM_CMD])
  const got = resolveCmd('npm', { fs, path: '', extraDirs: [ROOT] })
  assert.strictEqual(got, NPM_CMD)
})

test('prefers the .cmd shim over a bare name', () => {
  const fs = fakeFs([path.join(ROOT, 'npm.cmd'), path.join(ROOT, 'npm')])
  const got = resolveCmd('npm', { fs, path: '', extraDirs: [ROOT] })
  assert.strictEqual(got, path.join(ROOT, 'npm.cmd'))
})

test('returns null when nothing matches', () => {
  const fs = fakeFs([])
  assert.strictEqual(resolveCmd('npm', { fs, path: '', extraDirs: [ROOT] }), null)
})

test('checks nvm4w nodejs at the drive root (C:\\nvm4w) by default', () => {
  const fs = fakeFs([NPM_CMD])
  // no appData/extraDirs — relies on the built-in drive-root nvm4w check
  const got = resolveCmd('npm', { fs, path: '', systemDrive: 'C:\\' })
  assert.strictEqual(got, NPM_CMD)
})
