const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { DEEPY_ENGINE_MAP, PROFILE_TO_UI, DEEPY_MODES, currentMode, readStatus, setDeepy } = require('../services/deepy-config.js')

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

test('DEEPY_MODES carry canonical enabled/type values', () => {
  assert.deepStrictEqual(DEEPY_MODES.disabled, { enabled: 0, type: 'zero' })
  assert.deepStrictEqual(DEEPY_MODES.zero, { enabled: 1, type: 'zero' })
  assert.deepStrictEqual(DEEPY_MODES.prime, { enabled: 1, type: 'prime' })
})

test('currentMode derives disabled/zero/prime from persisted fields', () => {
  assert.strictEqual(currentMode({ deepy_enabled: 0, deepy_type: 'prime' }), 'disabled')
  assert.strictEqual(currentMode({ deepy_enabled: 1, deepy_type: 'zero' }), 'zero')
  assert.strictEqual(currentMode({ deepy_enabled: 1, deepy_type: 'prime' }), 'prime')
  assert.strictEqual(currentMode(null), 'disabled')
})

test('readStatus surfaces current mode', () => {
  const s = readStatus({ deepy_enabled: 1, deepy_type: 'prime', llm_engines: { deepy: 'claude', profiles: {} } })
  assert.strictEqual(s.available, true)
  assert.strictEqual(s.mode, 'prime')
  assert.strictEqual(s.currentEngine, 'claude')
})

test('setDeepy disabled writes enabled=0 and leaves engine untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepy-'))
  try {
    const cfgPath = makeRepo(dir)
    const r = setDeepy({ fs, path, resolveCmd: null }, dir, 'disabled', null)
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.mode, 'disabled')
    const after = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    assert.strictEqual(after.deepy_enabled, 0)
    assert.strictEqual(after.deepy_type, 'zero')
    assert.strictEqual(after.llm_engines.deepy, 'opencode') // untouched
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('setDeepy zero writes enabled=1, type=zero (local model, no engine needed)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepy-'))
  try {
    const cfgPath = makeRepo(dir)
    const r = setDeepy({ fs, path, resolveCmd: null }, dir, 'zero', null)
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.mode, 'zero')
    assert.strictEqual(r.engine, null)
    const after = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    assert.strictEqual(after.deepy_enabled, 1)
    assert.strictEqual(after.deepy_type, 'zero')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('setDeepy prime wires the chosen engine + executable + base_url', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepy-'))
  try {
    const cfgPath = makeRepo(dir)
    const resolveCmd = (n) => n === 'opencode' ? 'C:\\nvm4w\\nodejs\\opencode.cmd' : n
    const r = setDeepy({ fs, path, resolveCmd }, dir, 'prime', 'opencode')
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.mode, 'prime')
    assert.strictEqual(r.engine, 'opencode')
    assert.strictEqual(r.executable, 'C:\\nvm4w\\nodejs\\opencode.cmd')
    assert.ok(fs.existsSync(cfgPath + '.deepy-bak'), 'backup created')
    const after = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    assert.strictEqual(after.deepy_enabled, 1)
    assert.strictEqual(after.deepy_type, 'prime')
    assert.strictEqual(after.llm_engines.deepy, 'opencode')
    assert.strictEqual(after.llm_engines.prompt_enhancer, 'same_as_deepy')
    assert.strictEqual(after.llm_engines.profiles.opencode.base_url, 'http://127.0.0.1:4096')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('setDeepy prime requires an engine', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepy-'))
  try {
    const r = setDeepy({ fs, path, resolveCmd: null }, dir, 'prime', null)
    assert.strictEqual(r.ok, false)
    assert.match(r.error, /requires an engine/i)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('setDeepy rejects unknown mode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepy-'))
  try {
    const r = setDeepy({ fs, path, resolveCmd: null }, dir, 'bogus', null)
    assert.strictEqual(r.ok, false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('setDeepy errors when wgp_config.json missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepy-'))
  try {
    const r = setDeepy({ fs, path, resolveCmd: null }, dir, 'disabled', null)
    assert.strictEqual(r.ok, false)
    assert.match(r.error, /wgp_config.json not found/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
