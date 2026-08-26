/**
 * deepy-config.js — pure helpers for activating Deepy Prime in Wan2GP's
 * wgp_config.json (user DATA, never Wan2GP source).
 *
 * Kept free of Electron/Node-only deps so it is unit-testable. The caller
 * passes in fs + path + resolveCmd (injected) for tests; in production main.js
 * wires the real ones.
 */

// UI engine id -> { profile: wgp_config key, exe: executable name }
const DEEPY_ENGINE_MAP = {
  opencode: { profile: 'opencode', exe: 'opencode' },
  'claude-code': { profile: 'claude', exe: 'claude' },
  codex: { profile: 'codex', exe: 'codex' }
}
const PROFILE_TO_UI = { opencode: 'opencode', claude: 'claude-code', codex: 'codex' }

function readStatus(cfg) {
  if (!cfg) return { available: false, reason: 'wgp_config.json not found' }
  const le = cfg.llm_engines || {}
  return {
    available: true,
    deepyEnabled: !!cfg.deepy_enabled,
    deepyType: cfg.deepy_type || null,
    currentEngine: le.deepy || null,
    promptEnhancer: le.prompt_enhancer || null,
    engines: Object.keys(le.profiles || {})
  }
}

/**
 * Activate Deepy Prime for engineId.
 * @param {{fs,path,resolveCmd}} deps
 * @param {string} repoDir  Wan2GP repo dir (wgp_config.json lives here)
 * @param {string} engineId  'opencode' | 'claude-code' | 'codex'
 * @returns {{ok:boolean, engine?:string, executable?:string, backup?:string, message?:string, error?:string}}
 */
function activate(deps, repoDir, engineId) {
  const { fs, path, resolveCmd } = deps
  const map = DEEPY_ENGINE_MAP[engineId]
  if (!map) return { ok: false, error: 'Unknown engine: ' + engineId }
  const cfgPath = path.join(repoDir, 'wgp_config.json')
  if (!fs.existsSync(cfgPath)) return { ok: false, error: 'wgp_config.json not found — install Wan2GP first.' }
  let cfg
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) }
  catch (e) { return { ok: false, error: 'wgp_config.json is corrupted: ' + e.message } }

  const bak = cfgPath + '.deepy-bak'
  fs.copyFileSync(cfgPath, bak)

  cfg.deepy_enabled = 1
  cfg.deepy_type = 'prime'
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

  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
  return {
    ok: true,
    engine: map.profile,
    executable: cfg.llm_engines.profiles[map.profile].executable,
    backup: bak,
    message: `Deepy Prime set to ${map.profile}. Launch Wan2GP and click "Ask Deepy".`
  }
}

module.exports = { DEEPY_ENGINE_MAP, PROFILE_TO_UI, readStatus, activate }
