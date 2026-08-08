/**
 * Smoke tests for the settings-repair module (issue #7 fix).
 * Run: node --test tests/
 */
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DROPDOWN_CLAMPS, clampSettingsFile, collectSettingsFiles } = require('../services/settings-repair')

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wan2gp-repair-test-'))
}

test('clamps out-of-range dropdown values to the first allowed value', () => {
  const dir = tmpdir()
  const f = path.join(dir, '_settings.json')
  fs.writeFileSync(f, JSON.stringify({ apg_switch: 2, cfg_star_switch: 7, multi_images_gen_type: -1, foo: 1 }))
  const r = clampSettingsFile(f)
  assert.strictEqual(r.fixed, 3)
  assert.ok(r.backup && r.backup.endsWith('.bak-repair'))
  const after = JSON.parse(fs.readFileSync(f, 'utf8'))
  assert.strictEqual(after.apg_switch, 0)
  assert.strictEqual(after.cfg_star_switch, 0)
  assert.strictEqual(after.multi_images_gen_type, 0)
  assert.strictEqual(after.foo, 1) // untouched key survives
  fs.rmSync(dir, { recursive: true, force: true })
})

test('leaves valid values alone and reports fixed: 0', () => {
  const dir = tmpdir()
  const f = path.join(dir, 't2v_settings.json')
  fs.writeFileSync(f, JSON.stringify({ apg_switch: 1, cfg_star_switch: 0, multi_images_gen_type: 1 }))
  const r = clampSettingsFile(f)
  assert.strictEqual(r.fixed, 0)
  assert.strictEqual(r.backup, undefined) // no backup written for clean files
  fs.rmSync(dir, { recursive: true, force: true })
})

test('creates a backup with the ORIGINAL values before editing', () => {
  const dir = tmpdir()
  const f = path.join(dir, '_settings.json')
  fs.writeFileSync(f, JSON.stringify({ apg_switch: 2 }))
  clampSettingsFile(f)
  const backup = JSON.parse(fs.readFileSync(f + '.bak-repair', 'utf8'))
  assert.strictEqual(backup.apg_switch, 2) // original kept
  fs.rmSync(dir, { recursive: true, force: true })
})

test('preserves CRLF line endings when rewriting', () => {
  const dir = tmpdir()
  const f = path.join(dir, '_settings.json')
  fs.writeFileSync(f, '{\r\n  "apg_switch": 2,\r\n  "foo": 1\r\n}\r\n')
  clampSettingsFile(f)
  const raw = fs.readFileSync(f, 'utf8')
  assert.ok(raw.includes('\r\n'), 'file should stay CRLF')
  assert.ok(!/^[^\r]*\n(?!\r)/m.test(raw.replace(/\r\n/g, '')), 'no lone LF')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('clamps nested {label, value} choice shapes', () => {
  const dir = tmpdir()
  const f = path.join(dir, '_settings.json')
  fs.writeFileSync(f, JSON.stringify({ apg_switch: [{ label: 'ON', value: 2 }] }))
  const r = clampSettingsFile(f)
  assert.strictEqual(r.fixed, 1)
  const after = JSON.parse(fs.readFileSync(f, 'utf8'))
  assert.strictEqual(after.apg_switch[0].value, 0)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('reports invalid JSON instead of crashing', () => {
  const dir = tmpdir()
  const f = path.join(dir, 'bad_settings.json')
  fs.writeFileSync(f, 'not json at all')
  const r = clampSettingsFile(f)
  assert.strictEqual(r.error, 'invalid-json')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('reports unreadable files instead of crashing', () => {
  const r = clampSettingsFile(path.join('Z:', 'does-not-exist', '_settings.json'))
  assert.strictEqual(r.error, 'unreadable')
})

test('DROPDOWN_CLAMPS covers the three known 0/1 dropdowns', () => {
  assert.deepStrictEqual(Object.keys(DROPDOWN_CLAMPS).sort(), ['apg_switch', 'cfg_star_switch', 'multi_images_gen_type'])
  for (const allowed of Object.values(DROPDOWN_CLAMPS)) {
    assert.deepStrictEqual(allowed, [0, 1])
  }
})

test('collectSettingsFiles finds _settings.json across models/, settings/, finetunes/', () => {
  const dir = tmpdir()
  fs.mkdirSync(path.join(dir, 'models'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'settings'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'finetunes', 'sub', 'nested'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'models', '_settings.json'), '{}')
  fs.writeFileSync(path.join(dir, 'models', 't2v_settings.json'), '{}')
  fs.writeFileSync(path.join(dir, 'settings', 'fid1_settings.json'), '{}')
  fs.writeFileSync(path.join(dir, 'finetunes', 'sub', 'nested', 'ft_settings.json'), '{}')
  // non-settings files must be ignored
  fs.writeFileSync(path.join(dir, 'models', 'readme.txt'), 'x')
  fs.writeFileSync(path.join(dir, 'models', 'foo.json'), '{}')
  const files = collectSettingsFiles(dir)
  assert.strictEqual(files.length, 4)
  assert.ok(files.every(f => f.endsWith('_settings.json')))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('collectSettingsFiles returns [] for a repo with no settings', () => {
  const dir = tmpdir()
  fs.mkdirSync(path.join(dir, 'models'), { recursive: true })
  assert.deepStrictEqual(collectSettingsFiles(dir), [])
  fs.rmSync(dir, { recursive: true, force: true })
})
