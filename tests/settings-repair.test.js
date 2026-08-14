/**
 * Smoke tests for the settings-repair module (issue #7 fix).
 * Run: node --test tests/
 */
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DROPDOWN_CLAMPS, clampSettingsFile, collectSettingsFiles, repairNestedModelPaths } = require('../services/settings-repair')

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

test('repairs a UTF-8 BOM-prefixed settings file (previously skipped as invalid-json)', () => {
  const dir = tmpdir()
  const f = path.join(dir, '_settings.json')
  fs.writeFileSync(f, '\uFEFF' + JSON.stringify({ apg_switch: 2 }))
  const r = clampSettingsFile(f)
  assert.strictEqual(r.error, undefined, 'BOM file must not be reported invalid')
  assert.strictEqual(r.fixed, 1)
  const after = JSON.parse(fs.readFileSync(f, 'utf8'))
  assert.strictEqual(after.apg_switch, 0)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('repairs nested model paths case-insensitively on win32 (issue #18 lowercase form)', () => {
  const dir = tmpdir()
  const repo = path.join(dir, 'repo')
  fs.mkdirSync(path.join(repo, 'Wan2GP'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'wgp_config.json'), JSON.stringify({ checkpoints_paths: ['./wan2gp/ckpts'] }))
  const r = repairNestedModelPaths(repo, path.join(dir, 'data'))
  // On win32 the lowercase './wan2gp/ckpts' must be caught; on POSIX it is a
  // genuinely different (non-nested) directory and must be left alone.
  if (process.platform === 'win32') {
    assert.strictEqual(r.fixed, true)
    assert.strictEqual(r.replacements.length, 1)
  } else {
    assert.strictEqual(r.fixed, false)
  }
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

// ── repairNestedModelPaths (issue #18) ──

function repoWithConfig(cfg) {
  const dir = tmpdir()
  fs.mkdirSync(path.join(dir, 'Wan2GP', 'ckpts'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'wgp_config.json'), JSON.stringify(cfg, null, 2))
  return dir
}

test('repairs checkpoints_paths entries that resolve inside the repo (issue #18)', () => {
  const dir = repoWithConfig({})
  // relative ./Wan2GP/ckpts + absolute <repo>\Wan2GP\Wan2GP\ckpts are both
  // nested; a sibling C:\Models\ckpt is healthy and must survive untouched.
  fs.writeFileSync(path.join(dir, 'wgp_config.json'), JSON.stringify({
    checkpoints_paths: ['./Wan2GP/ckpts', path.join(dir, 'Wan2GP', 'Wan2GP', 'ckpts'), path.join('C:', 'Models', 'ckpt')],
    loras_root: './Wan2GP/lora'
  }, null, 2))
  const r = repairNestedModelPaths(dir, path.join('C:', 'data'))
  assert.strictEqual(r.fixed, true)
  assert.strictEqual(r.replacements.length, 3) // 2 ckpts + 1 loras
  assert.ok(r.backup && r.backup.endsWith('.bak-repair'))
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'wgp_config.json'), 'utf8'))
  assert.deepStrictEqual(after.checkpoints_paths, [path.join('C:', 'data', 'ckpt'), path.join('C:', 'data', 'ckpt'), path.join('C:', 'Models', 'ckpt')])
  assert.strictEqual(after.loras_root, path.join('C:', 'data', 'lora'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('repairs absolute paths nested under <repo>\\Wan2GP', () => {
  const dir = tmpdir()
  fs.mkdirSync(path.join(dir, 'Wan2GP', 'Wan2GP'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'wgp_config.json'), JSON.stringify({ checkpoints_paths: [path.join(dir, 'Wan2GP', 'Wan2GP', 'ckpts')] }))
  const r = repairNestedModelPaths(dir, path.join(dir, 'data'))
  assert.strictEqual(r.fixed, true)
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'wgp_config.json'), 'utf8'))
  assert.strictEqual(after.checkpoints_paths[0], path.join(dir, 'data', 'ckpt'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('leaves healthy configs untouched (fixed: false, no backup)', () => {
  const dir = repoWithConfig({
    checkpoints_paths: [path.join('C:', 'data', 'ckpt')],
    loras_root: path.join('C:', 'data', 'lora'),
    save_path: path.join('C:', 'data', 'outputs')
  })
  const r = repairNestedModelPaths(dir, path.join('C:', 'data'))
  assert.strictEqual(r.fixed, false)
  assert.deepStrictEqual(r.replacements, [])
  assert.ok(!fs.existsSync(path.join(dir, 'wgp_config.json.bak-repair')))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('missing or invalid wgp_config.json is a no-op', () => {
  const dir = tmpdir()
  assert.deepStrictEqual(repairNestedModelPaths(dir, dir), { fixed: false, replacements: [] })
  fs.writeFileSync(path.join(dir, 'wgp_config.json'), 'not json')
  assert.deepStrictEqual(repairNestedModelPaths(dir, dir), { fixed: false, replacements: [] })
  fs.rmSync(dir, { recursive: true, force: true })
})

test('save_path family (save/image/audio) is repaired too', () => {
  const dir = repoWithConfig({})
  fs.writeFileSync(path.join(dir, 'wgp_config.json'), JSON.stringify({
    save_path: './Wan2GP/outputs',
    image_save_path: './Wan2GP/images',
    audio_save_path: path.join(dir, 'Wan2GP', 'Wan2GP', 'audio'),
    checkpoints_paths: [path.join('C:', 'Models', 'ckpt')]
  }, null, 2))
  const r = repairNestedModelPaths(dir, path.join('C:', 'data'))
  assert.strictEqual(r.fixed, true)
  assert.strictEqual(r.replacements.length, 3)
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'wgp_config.json'), 'utf8'))
  assert.strictEqual(after.save_path, path.join('C:', 'data', 'outputs'))
  assert.strictEqual(after.image_save_path, path.join('C:', 'data', 'outputs'))
  assert.strictEqual(after.audio_save_path, path.join('C:', 'data', 'outputs'))
  assert.strictEqual(after.checkpoints_paths[0], path.join('C:', 'Models', 'ckpt')) // non-nested entry untouched
  fs.rmSync(dir, { recursive: true, force: true })
})
