/**
 * Tests for services/resolve-cmd.js — locates Windows .cmd shims for npm /
 * npx / opencode so the launcher can spawn them (avoids ENOENT when a double-
 * clicked .exe doesn't inherit the user's PATH).
 *
 * These tests verify Windows-only .cmd shim resolution. The launcher only ever
 * runs on Windows, and resolveCmd only considers `.cmd` candidates on win32
 * (on other platforms ext === ''), so the Windows-specific assertions are
 * skipped off-Windows — there is nothing meaningful to assert there.
 */
const { test } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const { resolveCmd } = require('../services/resolve-cmd.js')

// Only assert Windows shim behavior where it actually applies.
const winOnly = process.platform === 'win32'

// Fake fs that only reports the listed paths as existing.
function fakeFs(existing) {
  return { existsSync: (p) => existing.includes(p) }
}
const ROOT = 'C:\\nvm4w\\nodejs'
const NPM_CMD = path.join(ROOT, 'npm.cmd')

test('resolves npm.cmd from an extra dir when not on PATH', { skip: !winOnly }, () => {
  const fs = fakeFs([NPM_CMD])
  const got = resolveCmd('npm', { fs, path: '', extraDirs: [ROOT] })
  assert.strictEqual(got, NPM_CMD)
})

test('prefers the .cmd shim over a bare name', { skip: !winOnly }, () => {
  const fs = fakeFs([path.join(ROOT, 'npm.cmd'), path.join(ROOT, 'npm')])
  const got = resolveCmd('npm', { fs, path: '', extraDirs: [ROOT] })
  assert.strictEqual(got, path.join(ROOT, 'npm.cmd'))
})

test('returns null when nothing matches', () => {
  const fs = fakeFs([])
  assert.strictEqual(resolveCmd('npm', { fs, path: '', extraDirs: [ROOT] }), null)
})

test('checks nvm4w nodejs at the drive root (C:\\nvm4w) by default', { skip: !winOnly }, () => {
  const fs = fakeFs([NPM_CMD])
  // no appData/extraDirs — relies on the built-in drive-root nvm4w check
  const got = resolveCmd('npm', { fs, path: '', systemDrive: 'C:\\' })
  assert.strictEqual(got, NPM_CMD)
})
