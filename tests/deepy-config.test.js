const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { DEEPY_ENGINE_MAP, PROFILE_TO_UI, DEEPY_MODES, DEEPY_ENHANCER_OPTIONS, ENHANCER_IDS_BY_MODE, currentMode, currentEnhancerId, readStatus, setDeepy, resolveEnhancerId } = require('../services/deepy-config.js')

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
    assert.strictEqual(after.enhancer_enabled, 1) // Florence 2 + Llama 3.2 3B (local)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('setDeepy zero applies the full Deepy Zero default preset + local model', () => {
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
    assert.strictEqual(after.enhancer_enabled, 3) // Qwen3.5-4B, required for local Deepy
    // Full preset from shared/deepy/config.py get_deepy_default_runtime_config()
    assert.strictEqual(after.deepy_vram_mode, 'unload')
    assert.strictEqual(after.deepy_context_tokens, 16386)
    assert.strictEqual(after.deepy_kv_cache_quantization, 'auto')
    assert.strictEqual(after.deepy_compaction_type, 'discard')
    assert.strictEqual(after.deepy_tool_gen_image, 'Krea 2 Turbo (8 Steps)')
    assert.strictEqual(after.deepy_tool_edit_image, 'Flux Klein 9B')
    assert.strictEqual(after.deepy_tool_gen_video, 'LTX-2 2.5 Distilled')
    assert.strictEqual(after.deepy_tool_gen_video_with_speech, 'LTX-2.5 Distilled With Sound')
    assert.strictEqual(after.deepy_tool_gen_song, 'ACE-Step 1.5 Turbo LM 1.7B')
    assert.strictEqual(after.deepy_tool_gen_speech_from_description, 'Qwen3 1.7B')
    assert.strictEqual(after.deepy_tool_gen_speech_from_sample, 'Index TTS 2')
    assert.strictEqual(after.deepy_zero_custom_system_prompt, '')
    assert.strictEqual(after.deepy_auto_cancel_queue_tasks, true)
    assert.strictEqual(after.deepy_separate_requests_with_empty_line, true)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('setDeepy zero with explicit enhancer_id 5 (Qwen3.8-27B) is honored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepy-'))
  try {
    const cfgPath = makeRepo(dir)
    const r = setDeepy({ fs, path, resolveCmd: null }, dir, 'zero', null, 5)
    assert.strictEqual(r.ok, true)
    const after = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    assert.strictEqual(after.enhancer_enabled, 5)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('setDeepy zero with invalid enhancer_id for mode falls back to default (3)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepy-'))
  try {
    const cfgPath = makeRepo(dir)
    // 1 (Florence) is not valid for zero; must fall back to 3 (Qwen3.5-4B)
    const r = setDeepy({ fs, path, resolveCmd: null }, dir, 'zero', null, 1)
    assert.strictEqual(r.ok, true)
    const after = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    assert.strictEqual(after.enhancer_enabled, 3)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('setDeepy disabled with explicit enhancer_id 1 (Florence) is honored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepy-'))
  try {
    const cfgPath = makeRepo(dir)
    const before = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    before.enhancer_enabled = 3 // start from a Qwen value
    fs.writeFileSync(cfgPath, JSON.stringify(before))
    const r = setDeepy({ fs, path, resolveCmd: null }, dir, 'disabled', null, 1)
    assert.strictEqual(r.ok, true)
    const after = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    assert.strictEqual(after.deepy_enabled, 0)
    assert.strictEqual(after.enhancer_enabled, 1)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('resolveEnhancerId validates per mode and defaults correctly', () => {
  assert.deepStrictEqual(resolveEnhancerId('disabled', 1), { id: 1, fallback: false })
  assert.deepStrictEqual(resolveEnhancerId('disabled', 3), { id: 1, fallback: true }) // 3 invalid for disabled
  assert.deepStrictEqual(resolveEnhancerId('zero', 4), { id: 4, fallback: false })
  assert.deepStrictEqual(resolveEnhancerId('zero', 1), { id: 3, fallback: true }) // 1 invalid for zero
  assert.deepStrictEqual(resolveEnhancerId('prime', 3), { id: null, fallback: false }) // not used for prime
})

test('readStatus exposes enhancerEnabled', () => {
  const s = readStatus({ deepy_enabled: 1, deepy_type: 'zero', enhancer_enabled: 4, llm_engines: { deepy: 'opencode', profiles: {} } })
  assert.strictEqual(s.mode, 'zero')
  assert.strictEqual(s.enhancerEnabled, 4)
})

test('DEEPY_ENHANCER_OPTIONS lists only valid per-mode ids', () => {
  for (const o of DEEPY_ENHANCER_OPTIONS) {
    for (const m of o.modes) assert.ok(ENHANCER_IDS_BY_MODE[m].includes(o.id), `option ${o.id} valid for ${m}`)
  }
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
    // Full Deepy Prime default preset
    assert.strictEqual(after.deepy_prime_custom_system_prompt, 'When several models can satisfy the request, prefer the highest-quality base or full model unless the user explicitly prioritizes speed or names another model.')
    assert.deepStrictEqual(after.deepy_prime_mcp_servers, {})
    assert.strictEqual(after.deepy_mcp_auto_discover_paths, false)
    assert.strictEqual(after.deepy_allow_read_file_system, false)
    assert.deepStrictEqual(after.deepy_file_system_paths, [])
    assert.strictEqual(after.deepy_read_everywhere, false)
    assert.strictEqual(after.deepy_auto_cancel_queue_tasks, true)
    assert.strictEqual(after.deepy_separate_requests_with_empty_line, true)
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
