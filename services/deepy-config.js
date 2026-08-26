/**
 * deepy-config.js — pure helpers for configuring Deepy in Wan2GP's
 * wgp_config.json (user DATA, never Wan2GP source).
 *
 * Supported Deepy modes (canonical values from Wan2GP's shared/deepy/config.py):
 *   - disabled : deepy_enabled = 0  (deepy_type ignored)
 *   - zero     : deepy_enabled = 1, deepy_type = "zero"   (LOCAL Qwen model, no remote LLM)
 *   - prime    : deepy_enabled = 1, deepy_type = "prime"  (requires a remote LLM engine)
 *
 * Local Deepy model: Wan2GP's Prompt Enhancer (top-level "enhancer_enabled")
 * maps 3=Qwen3.5-4B, 4=Qwen3.5-9B, 5=Qwen3.8-27B. Deepy Zero ("local model")
 * only works if enhancer_enabled is one of {3,4,5}, so we default it to 3
 * (Qwen3.5-4B, the recommended local model) when enabling Zero.
 * Kept free of Electron/Node-only deps so it is unit-testable. The caller
 * passes in fs / path / resolveCmd (injected); in production main.js wires
 * the real ones.
 */

// UI engine id -> { profile: wgp_config key, exe: executable name }
const DEEPY_ENGINE_MAP = {
  opencode: { profile: 'opencode', exe: 'opencode' },
  'claude-code': { profile: 'claude', exe: 'claude' },
  codex: { profile: 'codex', exe: 'codex' }
}
const PROFILE_TO_UI = { opencode: 'opencode', claude: 'claude-code', codex: 'codex' }

// Canonical Deepy mode -> { enabled, type }
const DEEPY_MODES = {
  disabled: { enabled: 0, type: 'zero' },
  zero: { enabled: 1, type: 'zero' },
  prime: { enabled: 1, type: 'prime' }
}

// Full Deepy Zero default preset — mirrors Wan2GP's
// shared/deepy/config.py get_deepy_default_runtime_config() so the launcher
// applies the exact working combination (VRAM mode, context tokens, KV-cache
// quantization, compaction type, tool variants, local model). Read-only source
// of truth; values copied here so the service has no Wan2GP import dep.
const DEEPY_ZERO_PRESET = {
  deepy_vram_mode: 'unload',
  deepy_context_tokens: 16386,
  deepy_kv_cache_quantization: 'auto',
  deepy_compaction_type: 'discard',
  deepy_tool_gen_image: 'Krea 2 Turbo (8 Steps)',
  deepy_tool_edit_image: 'Flux Klein 9B',
  deepy_tool_gen_video: 'LTX-2 2.5 Distilled',
  deepy_tool_gen_video_with_speech: 'LTX-2.5 Distilled With Sound',
  deepy_tool_gen_song: 'ACE-Step 1.5 Turbo LM 1.7B',
  deepy_tool_gen_speech_from_description: 'Qwen3 1.7B',
  deepy_tool_gen_speech_from_sample: 'Index TTS 2',
  deepy_zero_custom_system_prompt: '',
  deepy_auto_cancel_queue_tasks: true,
  deepy_separate_requests_with_empty_line: true
}

// Full Deepy Prime default preset — mirrors Wan2GP's
// shared/deepy/config.py get_deepy_default_runtime_config() (the Prime-specific
// keys beyond enabled/type/engine). Values copied from read-only source.
const DEEPY_PRIME_PRESET = {
  deepy_prime_custom_system_prompt: 'When several models can satisfy the request, prefer the highest-quality base or full model unless the user explicitly prioritizes speed or names another model.',
  deepy_prime_mcp_servers: {},
  deepy_mcp_auto_discover_paths: false,
  deepy_allow_read_file_system: false,
  deepy_file_system_paths: [],
  deepy_read_everywhere: false,
  deepy_auto_cancel_queue_tasks: true,
  deepy_separate_requests_with_empty_line: true
}

// Derive the current Deepy mode from the persisted fields.
function currentMode(cfg) {
  if (!cfg) return 'disabled'
  const enabled = parseInt(cfg.deepy_enabled, 10)
  if (!enabled) return 'disabled'
  return (cfg.deepy_type === 'prime') ? 'prime' : 'zero'
}

function readStatus(cfg) {
  if (!cfg) return { available: false, reason: 'wgp_config.json not found' }
  const le = cfg.llm_engines || {}
  const mode = currentMode(cfg)
  return {
    available: true,
    mode,
    deepyEnabled: currentMode(cfg) !== 'disabled',
    deepyType: cfg.deepy_type || null,
    currentEngine: le.deepy || null,
    promptEnhancer: le.prompt_enhancer || null,
    engines: Object.keys(le.profiles || {})
  }
}

/**
 * Configure Deepy mode.
 * @param {{fs,path,resolveCmd}} deps
 * @param {string} repoDir  Wan2GP repo dir (wgp_config.json lives here)
 * @param {string} mode     'disabled' | 'zero' | 'prime'
 * @param {string|null} engineId  UI engine id ('opencode'|'claude-code'|'codex');
 *                                 required only when mode === 'prime'
 * @returns {{ok:boolean, mode?:string, engine?:string, executable?:string, backup?:string, message?:string, error?:string}}
 */
function setDeepy(deps, repoDir, mode, engineId) {
  const { fs, path, resolveCmd } = deps
  if (!DEEPY_MODES[mode]) return { ok: false, error: 'Unknown Deepy mode: ' + mode }
  if (mode === 'prime' && !DEEPY_ENGINE_MAP[engineId]) {
    return { ok: false, error: 'Prime requires an engine (OpenCode / Claude Code / Codex).' }
  }
  const cfgPath = path.join(repoDir, 'wgp_config.json')
  if (!fs.existsSync(cfgPath)) return { ok: false, error: 'wgp_config.json not found — install Wan2GP first.' }
  let cfg
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) }
  catch (e) { return { ok: false, error: 'wgp_config.json is corrupted: ' + e.message } }

  const bak = cfgPath + '.deepy-bak'
  fs.copyFileSync(cfgPath, bak)

  const m = DEEPY_MODES[mode]
  cfg.deepy_enabled = m.enabled
  cfg.deepy_type = m.type

  // Only Prime wires a remote LLM engine. Zero uses a local Qwen model and
  // Disabled leaves the engine config untouched.
  if (mode === 'prime') {
    const map = DEEPY_ENGINE_MAP[engineId]
    cfg.llm_engines = cfg.llm_engines || {}
    cfg.llm_engines.deepy = map.profile
    cfg.llm_engines.prompt_enhancer = 'same_as_deepy'
    cfg.llm_engines.profiles = cfg.llm_engines.profiles || {}
    cfg.llm_engines.profiles[map.profile] = cfg.llm_engines.profiles[map.profile] || {}
    const resolved = resolveCmd
      ? resolveCmd(map.exe, { path: process.env.PATH, appData: process.env.LOCALAPPDATA, programFiles: process.env.ProgramFiles, systemDrive: process.env.SystemDrive || 'C:\\' })
      : null
    cfg.llm_engines.profiles[map.profile].executable = resolved || map.exe
    if (map.profile === 'opencode') {
      cfg.llm_engines.profiles.opencode.base_url = 'http://127.0.0.1:4096'
    }
    // Apply the full Deepy Prime default preset (guidance, MCP servers, file
    // system access, etc.) so it matches Wan2GP's working Deepy Prime config.
    Object.assign(cfg, DEEPY_PRIME_PRESET)
  } else if (mode === 'zero') {
    // Local model path: apply the full Deepy Zero default preset (VRAM mode,
    // context tokens, KV-cache quantization, compaction type, tool variants)
    // so it matches Wan2GP's working combination, then ensure the Prompt
    // Enhancer is a valid Qwen3.5/3.8 VL local model.
    // 3 = Qwen3.5-4B (recommended default local model). Leave it alone only if
    // it is already a valid local Qwen variant; otherwise default to 3.
    Object.assign(cfg, DEEPY_ZERO_PRESET)
    const valid = new Set([3, 4, 5])
    const cur = parseInt(cfg.enhancer_enabled, 10)
    if (!valid.has(cur)) cfg.enhancer_enabled = 3
  } else if (mode === 'disabled') {
    // Disabled: reset the Prompt Enhancer to the default local model
    // (Florence 2 + Llama 3.2 3B), i.e. enhancer_enabled = 1.
    cfg.enhancer_enabled = 1
  }

  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
  const label = mode === 'prime'
    ? `Deepy Prime set to ${DEEPY_ENGINE_MAP[engineId].profile}`
    : (mode === 'zero' ? 'Deepy Zero enabled (local model)' : 'Deepy disabled')
  return {
    ok: true,
    mode,
    engine: mode === 'prime' ? DEEPY_ENGINE_MAP[engineId].profile : null,
    executable: (mode === 'prime') ? cfg.llm_engines.profiles[DEEPY_ENGINE_MAP[engineId].profile].executable : null,
    backup: bak,
    message: label + '. Launch Wan2GP and click "Ask Deepy".'
  }
}

module.exports = { DEEPY_ENGINE_MAP, PROFILE_TO_UI, DEEPY_MODES, currentMode, readStatus, setDeepy }
