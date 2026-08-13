/**
 * Tests for the shared data-dir path validator (services/validate-data-dir.js).
 * Locks the same guard the `set-data-dir` IPC handler relies on, without
 * booting Electron. Run: node --test tests/
 */
const { test } = require('node:test')
const assert = require('node:assert')
const validateDataDir = require('../services/validate-data-dir.js')
const path = require('path')

test('accepts an absolute canonical path', () => {
  const p = path.join('C:', 'Users', 'me', 'Wan2GPData')
  assert.strictEqual(validateDataDir(p), path.resolve(p))
})

test('rejects non-string / empty input', () => {
  assert.strictEqual(validateDataDir(null), null)
  assert.strictEqual(validateDataDir(undefined), null)
  assert.strictEqual(validateDataDir(42), null)
  assert.strictEqual(validateDataDir(''), null)
})

test('rejects a relative path', () => {
  assert.strictEqual(validateDataDir('some/relative/dir'), null)
})

test('rejects path-traversal components', () => {
  assert.strictEqual(validateDataDir('/ok/../escape'), null)
  assert.strictEqual(validateDataDir('../escape'), null)
  assert.strictEqual(validateDataDir('C:\\ok\\..\\escape'), null)
})
