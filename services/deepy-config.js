/**
 * deepy-config.js — pure helpers for configuring Deepy in Wan2GP's
 * wgp_config.json (user DATA, never Wan2GP source).
 *
 * Supported Deepy modes (canonical values from Wan2GP's shared/deepy/config.py):
 *   - disabled : deepy_enabled = 0  (deepy_type ignored)
 *   - zero     : deepy_enabled = 1, deepy_type = "zero"   (LOCAL Qwen model, no remote LLM)
 *   - prime    : deepy_enabled = 1, deepy_type = "prime"  (requires a remote LLM engine)
 *
 * Local model / Prompt Enhancer: Wan2GP's top-level "enhancer_enabled" selects
 * the local model. Canonical mapping (shared/remote_llm/config.py):
 *   1 = Florence 2 + Llama 3.2 3B (local)        — the default when Deepy is off
 *   2 = Florence 2 + Llama Joy 8B (local)
 *   3 = Qwen3.5 VL Abliterated 4B (local, recommended)
 *   4 = Qwen3.5 VL Abliterated 9B (local)
 *   5 = Qwen3.8 VL Uncensored 27B (local)
 * Deepy Zero/Prime("local model") only works if enhancer_enabled is one of
 * {3,4,5} (deepy_requirement_error), so the launcher exposes those for Zero and
 * Florence 2 (1) for Disabled.
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
// Local Prime engine (no external binary — runs on the Qwen3.8 VL 27B local model).
const LOCAL_QWEN38 = 'local-qwen38'
const PROFILE_TO_UI = { opencode: 'opencode', claude: 'claude-code', codex: 'codex', qwen38_27b: 'local-qwen38' }

// Canonical Deepy mode -> { enabled, type }
const DEEPY_MODES = {
  disabled: { enabled: 0, type: 'zero' },
  zero: { enabled: 1, type: 'zero' },
  prime: { enabled: 1, type: 'prime' }
}

// Local-model (Prompt Enhancer) choices exposed in the Deepy panel, keyed by
// enhancer_enabled id. Data-driven: one entry = one selectable option; no UI
// branch per model. `modes` lists which Deepy modes the option is valid for.
//   - 1 (Florence 2 + Llama 3.2 3B) is the default local model when Deepy is off.
//   - 3/4/5 are the Qwen3.5/3.8 VL variants Deepy Zero/Prime require.
const DEEPY_ENHANCER_OPTIONS = [
  { id: 1, label: 'Florence 2 + Llama 3.2 3B (local)', modes: ['disabled'], recommended: false },
  { id: 2, label: 'Florence 2 + Llama Joy 8B (local)', modes: ['disabled'], recommended: false },
  { id: 3, label: 'Qwen3.5 VL Abliterated 4B (local, recommended)', modes: ['zero'], recommended: true },
  { id: 4, label: 'Qwen3.5 VL Abliterated 9B (local)', modes: ['zero'], recommended: false },
  { id: 5, label: 'Qwen3.8 VL Uncensored 27B (local)', modes: ['zero'], recommended: false }
]

// Valid enhancer ids per Deepy mode (mirrors Wan2GP's requirement check).
const ENHANCER_IDS_BY_MODE = {
  disabled: [1, 2],
  zero: [3, 4, 5],
  prime: [] // Prime uses a remote LLM; local model not used
}

// enhancer_enabled id -> Wan2GP llm_engines.deepy engine string (shared/remote_llm/config.py).
// Wan2GP's Deepy Zero/Disabled "LLM engine" dropdown reads llm_engines.deepy and
// DERIVES enhancer_enabled from it (local_enhancer_id). So the launcher must set
// BOTH to a consistent pair, or Wan2GP will ignore the enhancer_enabled value and
// show/keep the wrong model.
const ENHANCER_ID_TO_ENGINE = {
  1: 'local_florence_llama32',   // Florence 2 + Llama 3.2 3B
  2: 'local_florence_llamajoy',  // Florence 2 + Llama Joy 8B
  3: 'qwen35_4b',                // Qwen3.5 VL Abliterated 4B
  4: 'qwen35_9b',                // Qwen3.5 VL Abliterated 9B
  5: 'qwen38_27b'                // Qwen3.8 VL Uncensored 27B
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
  deepy_repetition_penalty: true,
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
  deepy_separate_requests_with_empty_line: true,
  deepy_repetition_penalty: true
}

// Resolve the local-model (enhancer_enabled) id for a given mode + user choice.
// Returns { id, fallback } where fallback is true when the user's id was
// invalid for the mode and we substituted the mode's default.
function resolveEnhancerId(mode, chosenId) {
  const valid = ENHANCER_IDS_BY_MODE[mode] || []
  if (mode === 'prime') return { id: null, fallback: false } // not used for Prime
  if (chosenId != null && valid.includes(parseInt(chosenId, 10))) {
    return { id: parseInt(chosenId, 10), fallback: false }
  }
  // Default: first valid option (Florence 2=1 for disabled, Qwen3.5-4B=3 for zero)
  return { id: valid[0], fallback: true }
}

// Derive the current Deepy mode from the persisted fields.
function currentMode(cfg) {
  if (!cfg) return 'disabled'
  const enabled = parseInt(cfg.deepy_enabled, 10)
  if (!enabled) return 'disabled'
  return (cfg.deepy_type === 'prime') ? 'prime' : 'zero'
}

// Derive the current local-model id from the persisted enhancer_enabled.
function currentEnhancerId(cfg) {
  if (!cfg) return null
  const v = parseInt(cfg.enhancer_enabled, 10)
  return Number.isNaN(v) ? null : v
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
    enhancerEnabled: currentEnhancerId(cfg),
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
 * @param {number|null} enhancerId  local-model (enhancer_enabled) id (1/3/4/5);
 *                                 used for disabled/zero; for zero it must be a
 *                                 valid Qwen variant (3/4/5), else defaults to 3.
 * @returns {{ok:boolean, mode?:string, engine?:string, executable?:string, enhancerId?:number, backup?:string, message?:string, error?:string}}
 */
function setDeepy(deps, repoDir, mode, engineId, enhancerId) {
  const { fs, path, resolveCmd } = deps
  if (!DEEPY_MODES[mode]) return { ok: false, error: 'Unknown Deepy mode: ' + mode }
  if (mode === 'prime' && engineId !== LOCAL_QWEN38 && !DEEPY_ENGINE_MAP[engineId]) {
    return { ok: false, error: 'Prime requires an engine (OpenCode / Claude Code / Codex / local Qwen3.8 27B).' }
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

  // Local-model (Prompt Enhancer) selection — only meaningful for disabled/zero.
  const enhancer = resolveEnhancerId(mode, enhancerId)
  if (mode !== 'prime') cfg.enhancer_enabled = enhancer.id

  if (mode === 'prime') {
    if (engineId === LOCAL_QWEN38) {
      // Local Prime: runs on Qwen3.8 VL 27B — upstream requires the 27B model
      // plus context >= 32000 and Summarize compaction, and the Configuration
      // UI auto-raises both, so mirror that here.
      cfg.enhancer_enabled = 5
      cfg.llm_engines = cfg.llm_engines || {}
      cfg.llm_engines.deepy = 'qwen38_27b'
      cfg.llm_engines.prompt_enhancer = 'same_as_deepy'
      if ((parseInt(cfg.deepy_context_tokens, 10) || 0) < 32000) cfg.deepy_context_tokens = 32000
      cfg.deepy_compaction_type = 'summarize'
      cfg.deepy_repetition_penalty = true
    } else {
    const map = DEEPY_ENGINE_MAP[engineId]
    cfg.llm_engines = cfg.llm_engines || {}
    cfg.llm_engines.deepy = map.profile
    cfg.llm_engines.prompt_enhancer = 'same_as_deepy'
    cfg.llm_engines.profiles = cfg.llm_engines.profiles || {}
    cfg.llm_engines.profiles[map.profile] = cfg.llm_engines.profiles[map.profile] || {}
    // Write the LITERAL engine name ("opencode"), not a resolved absolute path.
    // Wan2GP auto-detects the binary itself (shared/remote_llm/opencode_backend.py
    // _resolve_opencode_executable) — an absolute path is brittle and bypasses that.
    cfg.llm_engines.profiles[map.profile].executable = map.exe
    if (map.profile === 'opencode') {
      cfg.llm_engines.profiles.opencode.base_url = 'http://127.0.0.1:4096'
    }
    // Apply the full Deepy Prime default preset (guidance, MCP servers, file
    // system access, etc.) so it matches Wan2GP's working Deepy Prime config.
    Object.assign(cfg, DEEPY_PRIME_PRESET)
    }
  } else if (mode === 'zero') {
    // Apply the full Deepy Zero default preset (VRAM mode, context tokens,
    // KV-cache quantization, compaction type, tool variants) and the chosen
    // local Qwen model. Wan2GP's Deepy Zero "LLM engine" dropdown reads
    // llm_engines.deepy and DERIVES enhancer_enabled from it, so we must set
    // BOTH to a consistent pair (here: qwen35_4b / 9b / qwen38_27b + id 3/4/5).
    cfg.llm_engines = cfg.llm_engines || {}
    cfg.llm_engines.deepy = ENHANCER_ID_TO_ENGINE[enhancer.id] || 'qwen35_4b'
    cfg.llm_engines.prompt_enhancer = 'same_as_deepy'
    Object.assign(cfg, DEEPY_ZERO_PRESET)
  } else if (mode === 'disabled') {
    // Disabled: keep the chosen local model (Florence 2 + Llama 3.2/3B). Set
    // llm_engines.deepy to the matching engine string AND enhancer_enabled so
    // the value is consistent and persisted for when Deepy is toggled back on.
    cfg.llm_engines = cfg.llm_engines || {}
    cfg.llm_engines.deepy = ENHANCER_ID_TO_ENGINE[enhancer.id] || 'local_florence_llama32'
    cfg.llm_engines.prompt_enhancer = 'same_as_deepy'
  }

  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
  const primeLabel = engineId === LOCAL_QWEN38 ? 'Qwen3.8 VL 27B (local)'
    : (DEEPY_ENGINE_MAP[engineId] ? DEEPY_ENGINE_MAP[engineId].profile : 'unknown engine')
  const label = mode === 'prime'
    ? `Deepy Prime set to ${primeLabel}`
    : (mode === 'zero' ? 'Deepy Zero enabled (local model)' : 'Deepy disabled')
  return {
    ok: true,
    mode,
    engine: mode === 'prime' ? (engineId === LOCAL_QWEN38 ? 'qwen38_27b' : DEEPY_ENGINE_MAP[engineId].profile) : null,
    executable: (mode === 'prime' && engineId !== LOCAL_QWEN38) ? cfg.llm_engines.profiles[DEEPY_ENGINE_MAP[engineId].profile].executable : null,
    enhancerId: (mode !== 'prime') ? enhancer.id : null,
    backup: bak,
    message: label + '. Launch Wan2GP and click "Ask Deepy".'
  }
}

module.exports = {
  DEEPY_ENGINE_MAP, PROFILE_TO_UI, DEEPY_MODES, DEEPY_ENHANCER_OPTIONS,
  ENHANCER_IDS_BY_MODE, ENHANCER_ID_TO_ENGINE, currentMode, currentEnhancerId, readStatus, setDeepy,
  resolveEnhancerId
}
