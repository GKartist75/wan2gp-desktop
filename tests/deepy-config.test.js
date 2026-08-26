const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { DEEPY_ENGINE_MAP, PROFILE_TO_UI, readStatus, activate } = require('../services/deepy-config.js')

// Fake wgp_config.json tree in a temp dir.
function makeRepo(base, mutate) {
  const cfg = {
    deepy_enabled: 0,
    deepy_type: 'disabled',
    llm_engines: {
      deepy: 'opencode',
      prompt_enhancer: 'same_as_deepy',
      profiles: {
        opencode: { executable: 'opencode', base_url: 'http://127.0.0.1:4096' },
        claude: { executable: 'claude' },
        codex: { executable: 'codex' }
      }
    }
  }
  if (mutate) mutate(cfg)
  const p = path.join(base, 'wgp_config.json')
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2))
  return p
}

test('DEEPY_ENGINE_MAP maps UI ids to profile keys', () => {
  assert.strictEqual(DEEPY_ENGINE_MAP.opencode.profile, 'opencode')
  assert.strictEqual(DEEPY_ENGINE_MAP['claude-code'].profile, 'claude')
  assert.strictEqual(DEEPY_ENGINE_MAP.codex.profile, 'codex')
})

test('PROFILE_TO_UI inverts the mapping', () => {
  assert.strictEqual(PROFILE_TO_UI.claude, 'claude-code')
  assert.strictEqual(PROFILE_TO_UI.opencode, 'opencode')
})

test('readStatus reports not-found for missing config', () => {
  assert.strictEqual(readStatus(null).available, false)
})

test('readStatus surfaces current engine + enabled flag', () => {
  const s = readStatus({
    deepy_enabled: 1, deepy_type: 'prime',
    llm_engines: { deepy: 'claude', prompt_enhancer: 'same_as_deepy', profiles: { claude: {}, opencode: {} } }
  })
  assert.strictEqual(s.available, true)
  assert.strictEqual(s.currentEngine, 'claude')
  assert.strictEqual(s.deepyEnabled, true)
  assert.strictEqual(s.deepyType, 'prime')
})

test('activate writes only known Deepy keys and backs up', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepy-'))
  try {
    const cfgPath = makeRepo(dir)
    const resolveCmd = (name) => name === 'opencode' ? 'C:\\nvm4w\\nodejs\\opencode.cmd' : name
    const r = activate({ fs, path, resolveCmd }, dir, 'opencode')
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.engine, 'opencode')
    assert.strictEqual(r.executable, 'C:\\nvm4w\\nodejs\\opencode.cmd')
    assert.ok(fs.existsSync(cfgPath + '.deepy-bak'), 'backup created')

    const after = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    assert.strictEqual(after.deepy_enabled, 1)
    assert.strictEqual(after.deepy_type, 'prime')
    assert.strictEqual(after.llm_engines.deepy, 'opencode')
    assert.strictEqual(after.llm_engines.prompt_enhancer, 'same_as_deepy')
    assert.strictEqual(after.llm_engines.profiles.opencode.base_url, 'http://127.0.0.1:4096')
    // unrelated sections preserved
    assert.ok(after.llm_engines.profiles.claude, 'other profiles untouched')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('activate rejects unknown engine', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepy-'))
  try {
    const r = activate({ fs, path, resolveCmd: null }, dir, 'nope')
    assert.strictEqual(r.ok, false)
    assert.match(r.error, /Unknown engine/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('activate errors when wgp_config.json missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepy-'))
  try {
    const r = activate({ fs, path, resolveCmd: null }, dir, 'opencode')
    assert.strictEqual(r.ok, false)
    assert.match(r.error, /wgp_config.json not found/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
