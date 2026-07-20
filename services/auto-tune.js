/**
 * Performance Auto-Tune for Wan2GP
 *
 * Detect hardware → recommend optimal settings → apply to wgp_config.json.
 *
 * Port of the Python reference:
 *   - hardware_detect.py  (GPU/RAM detection + kernel classification)
 *   - perf_recommend.py   (triple-profile recommendation engine)
 *
 * Pure functions — no side effects in detect()/recommend(). apply() writes
 * to Wan2GP's wgp_config.json on disk.
 *
 * @module auto-tune
 */

const { execSync } = require('child_process')
const os = require('os')
const fs = require('fs')
const path = require('path')

// ──────────────────────────────────────────────
//  Hardware Detection
// ──────────────────────────────────────────────

/**
 * Run nvidia-smi and parse structured GPU info.
 * Returns null if no NVIDIA GPU is found.
 */
function queryNvidiaSmi() {
  try {
    const raw = execSync(
      'nvidia-smi --query-gpu=name,memory.total,compute_cap --format=csv,noheader,nounits',
      { encoding: 'utf8', timeout: 10000, windowsHide: true }
    ).trim()
    const lines = raw.split('\n').filter(Boolean)
    if (!lines.length) return null

    // Parse first GPU (primary)
    const parts = lines[0].split(',').map(s => s.trim())
    const name = parts[0] || 'Unknown'
    let vramMb = parseInt(parts[1], 10)
    const capability = parts[2] || ''

    // nvidia-smi sometimes reports MiB — unify to MB
    if (isNaN(vramMb)) {
      // Try fallback with MiB suffix
      const raw2 = execSync(
        'nvidia-smi --query-gpu=memory.total --format=csv,noheader',
        { encoding: 'utf8', timeout: 10000, windowsHide: true }
      ).trim()
      const m = raw2.match(/([\d.]+)\s*(MiB|MB)/)
      vramMb = m ? parseFloat(m[1]) : 0
    }

    return {
      gpu_name: name,
      gpu_vram_mb: vramMb || 0,
      gpu_vram_gb: Math.round((vramMb || 0) / 1024),
      gpu_capability: capability
    }
  } catch {
    return null
  }
}

/**
 * Detect CUDA version via `nvidia-smi` top-level header.
 * Returns e.g. "12.8" or null.
 */
function queryCudaVersion() {
  try {
    const raw = execSync('nvidia-smi --version', { encoding: 'utf8', timeout: 5000, windowsHide: true })
    const m = raw.match(/CUDA Version:\s*(\d+\.\d+)/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

/**
 * Full hardware detection.
 *
 * @param {string} [repoDir] - Wan2GP repo directory (needed for Python import checks).
 *                             Pass null/undefined to skip Python-import checks.
 *
 * Returns a flat dict similar to the Python hardware_detect.detect_hardware():
 *
 *   cuda_available     bool
 *   gpu_name           string
 *   gpu_vram_gb        number
 *   gpu_capability     string (e.g. "8.9")
 *   ram_gb             number
 *   cpu_count          number
 *   ram_tier           'low' | 'mid' | 'high'
 *   vram_tier          'low' | 'mid' | 'high' | 'very_high'
 *   supports_fp8       bool
 *   supports_nvfp4     bool  (capability ≥ 9.0)
 *   supports_sage      bool
 *   supports_flash     bool
 *   supports_triton    bool
 */
function detect(repoDir) {
  const nv = queryNvidiaSmi()
  const cudaVer = queryCudaVersion()

  const cudaAvailable = nv !== null
  const gpuName = nv ? nv.gpu_name : '—'
  const gpuVramGb = nv ? nv.gpu_vram_gb : 0
  const gpuCap = nv ? nv.gpu_capability : ''

  // System RAM
  const ramGb = Math.round(os.totalmem() / 1073741824)
  const cpuCount = os.cpus().length

  // ── Tiers ──
  // VRAM tier
  let vramTier = 'low'
  if (gpuVramGb >= 24) vramTier = 'very_high'
  else if (gpuVramGb >= 16) vramTier = 'high'
  else if (gpuVramGb >= 10) vramTier = 'mid'

  // RAM tier (system memory)
  let ramTier = 'low'
  if (ramGb >= 64) ramTier = 'high'
  else if (ramGb >= 32) ramTier = 'mid'

  // ── Capability-based flags ──
  const capMajor = parseFloat(gpuCap) || 0
  const supportsFp8 = capMajor >= 7.0  // Turing+ (all RTX cards)
  const supportsNvfp4 = capMajor >= 9.0  // Blackwell only

  // ── Kernel support ──
  // In Node.js we can't import Python modules directly. We check by trying
  // a lightweight shell probe (import in a python one-liner from the active env).
  // Falls back to capability-based estimation.
  // repoDir must be provided to find the envs.json; if omitted, skip import checks.
  const env = repoDir ? getActiveEnv(repoDir) : null
  const py = env ? getPythonForEnv(env) : null

  const supportsTriton = checkPythonImport(py, 'triton')
  const supportsFlash = checkPythonImport(py, 'flash_attn')
  const supportsSage = checkPythonImport(py, 'sageattention')

  return {
    cuda_available: cudaAvailable,
    cuda_version: cudaVer,
    gpu_name: gpuName,
    gpu_vram_gb: gpuVramGb,
    gpu_capability: gpuCap,
    ram_gb: ramGb,
    cpu_count: cpuCount,
    ram_tier: ramTier,
    vram_tier: vramTier,
    supports_fp8: supportsFp8,
    supports_nvfp4: supportsNvfp4,
    supports_sage: supportsSage,
    supports_flash: supportsFlash,
    supports_triton: supportsTriton
  }
}

// ──────────────────────────────────────────────
//  Recommendation Engine
// ──────────────────────────────────────────────

/**
 * Profile matrix keyed by (vram_tier, ram_tier).
 * Maps to Wan2GP's mmgp profile_type (only profiles 1–5 are valid):
 *   1 = HighRAM_HighVRAM   — pinned all, no budgets
 *   2 = HighRAM_LowVRAM    — pinned all, budgets["*"]=3000
 *   3 = LowRAM_HighVRAM    — pinned transformer, no budgets, quant encoders
 *   4 = LowRAM_LowVRAM     — pinned transformer, budgets["*"]=3000, quant encoders
 *   5 = VerylowRAM_LowVRAM — no pinned, budgets["transformer"]=400, quant encoders
 *
 * Thresholds:
 *   VRAM tiers: very_high ≥ 24 GB | high ≥ 16 GB | mid ≥ 10 GB | low < 10 GB
 *   RAM  tiers: high ≥ 64 GB | mid ≥ 32 GB | low < 32 GB
 */
const PROFILE_MATRIX = {
  very_high: { high: 1, mid: 1, low: 1 },  // ≥24GB VRAM: profile 1 regardless of RAM
  high:      { high: 1, mid: 2, low: 2 },   // ≥16GB VRAM: 1 with high RAM, 2 otherwise
  mid:       { high: 3, mid: 4, low: 4 },   // ≥10GB VRAM: CPU offload w/ high RAM, balanced otherwise
  low:       { high: 3, mid: 5, low: 5 }    // <10GB VRAM: CPU offload w/ high RAM, max compat otherwise
}

/**
 * Audio profile override.
 * Audio models are much smaller than video/image, so they can use less
 * aggressive profiles (lower number = more VRAM, faster).
 * - VRAM ≥ 12 GB → audio capped at profile 3 (generous headroom)
 * - otherwise → same as video
 */
function audioProfile(vramGb, videoProf) {
  if (vramGb >= 12 && videoProf > 3) return 3
  return videoProf
}

/**
 * Quantization — always Scaled Int8 ("int8").
 * This is Wan2GP's own recommended default (wgp.py line ~3225) and the
 * mmgp offloader's quantizeTransformer=True uses int8 by default.
 * Scaled Int8 offers the best balance of quality, speed, and VRAM usage
 * across all hardware tiers.
 */
function quantForProfile(profile) {
  return 'int8'
}

/**
 * VAE config — always 0 (Auto).
 * 0 = auto (Wan2GP decides when tiling is needed)
 * 1 = tiling, 2 = split-tiling, 3 = no-encode
 * Auto is the safest choice for quality — higher presets save VRAM but
 * introduce banding artifacts.
 */
function vaeConfigForProfile(profile) {
  return 0
}

/**
 * VRAM safety coefficient per profile.
 * Higher = more headroom (slower but safer).
 * Controls vram_safety_coefficient passed to mmgp offloader.
 */
function vramCoefficientForProfile(profile) {
  const map = {
    1: 0.80, 2: 0.75, 3: 0.70, 4: 0.60, 5: 0.50
  }
  return map[profile] ?? 0.70
}

const PROFILE_LABELS = {
  1: 'HighRAM \u00b7 HighVRAM',
  2: 'HighRAM \u00b7 LowVRAM',
  3: 'LowRAM \u00b7 HighVRAM',
  4: 'LowRAM \u00b7 LowVRAM',
  5: 'Very LowRAM \u00b7 LowVRAM'
}

const PROFILE_REASONS = {
  1: 'Ample RAM + VRAM — max quality: full models in VRAM, pinned memory for fast reload',
  2: 'High RAM, limited VRAM — modules in VRAM on demand within budget, pinned for speed',
  3: 'Limited RAM, high VRAM — transformer stays in VRAM, text encoders quantized for offload',
  4: 'Limited RAM + VRAM — balanced: transformer partially pinned, quantized encoders, budgets',
  5: 'Very limited RAM + VRAM — max compatibility: no pinned memory, tight budgets, all quantized'
}

/**
 * Compute per-job coefficient for a given job type and base coefficient.
 *
 * jobType: 'video' | 'image' | 'audio'
 * baseCoeff: the vram_safety_coefficient from recommend()
 *
 * Returns a job-specific multiplier (lower = safer for VRAM-heavy tasks).
 * Video is the heaviest → gets the lowest multiplier.
 */
function computePerJobCoefficient(baseCoeff, jobType) {
  const jobScale = { video: 0.90, image: 1.0, audio: 1.10 }
  const scale = jobScale[jobType] || 1.0
  return Math.round(baseCoeff * scale * 100) / 100
}

/**
 * Keys that apply() should write to wgp_config.json.
 */
function appliedKeys() {
  return [
    'video_profile',
    'image_profile',
    'audio_profile',
    'vram_safety_coefficient',
    'vae_config',
    'transformer_quantization'
  ]
}

/**
 * Recommend optimal settings based on hardware detection result.
 *
 * @param {object} hw - Output from detect()
 * @returns {object} Settings dict with keys matching appliedKeys() plus
 *                   _recommendation_label and _recommendation_reason.
 */
function recommend(hw) {
  const vramTier = hw.vram_tier || 'low'
  const ramTier = hw.ram_tier || 'low'
  const vramGb = hw.gpu_vram_gb || 0

  // Lookup base profile from matrix
  const ramRow = PROFILE_MATRIX[vramTier] || PROFILE_MATRIX.low
  let profile = ramRow[ramTier]
  if (profile === undefined) profile = 4

  const videoProfile = profile
  const imageProfile = profile
  const audioProf = audioProfile(vramGb, videoProfile)

  const quant = quantForProfile(videoProfile)
  const vaeCfg = vaeConfigForProfile(videoProfile)
  const coeff = vramCoefficientForProfile(videoProfile)

  return {
    video_profile: videoProfile,
    image_profile: imageProfile,
    audio_profile: audioProf,
    vram_safety_coefficient: coeff,
    vae_config: vaeCfg,
    transformer_quantization: quant,
    _recommendation_label: PROFILE_LABELS[videoProfile] || 'Custom',
    _recommendation_reason: PROFILE_REASONS[videoProfile] || 'Custom configuration'
  }
}

// ──────────────────────────────────────────────
//  Config I/O
// ──────────────────────────────────────────────

/**
 * Find Wan2GP's wgp_config.json.
 *
 * Strategy:
 *   1. CWD (where desktop is launched)
 *   2. Repo dir (cloned Wan2GP)
 *   3. User data dir
 *
 * @param {string} repoDir - Wan2GP repo directory (from main.js)
 * @param {string} dataDir - User data directory
 * @returns {string|null} Full path to wgp_config.json or null
 */
function findWgpConfig(repoDir, dataDir) {
  const candidates = [
    path.join(process.cwd(), 'wgp_config.json'),
    path.join(repoDir || '', 'wgp_config.json'),
    path.join(dataDir || '', 'wgp_config.json'),
    path.join(dataDir || '', 'Wan2GP', 'wgp_config.json')
  ]
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p
  }
  // Fallback: first writable location
  return path.join(repoDir || dataDir || process.cwd(), 'wgp_config.json')
}

/**
 * Read wgp_config.json.
 *
 * @param {string} repoDir
 * @param {string} dataDir
 * @returns {{ path: string, config: object }} The config path and parsed content.
 */
function readWgpConfig(repoDir, dataDir) {
  const cfgPath = findWgpConfig(repoDir, dataDir)
  let config = {}
  if (fs.existsSync(cfgPath)) {
    try {
      config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    } catch {
      config = {}
    }
  }
  return { path: cfgPath, config }
}

/**
 * Apply recommended settings to wgp_config.json.
 *
 * @param {object} settings - Output from recommend()
 * @param {string} repoDir - Wan2GP repo directory
 * @param {string} dataDir - User data directory
 * @returns {{ success: boolean, path: string, applied: string[], error?: string }}
 */
function apply(settings, repoDir, dataDir) {
  try {
    const { path: cfgPath, config } = readWgpConfig(repoDir, dataDir)
    const keys = appliedKeys()
    const applied = []

    for (const key of keys) {
      if (key in settings) {
        config[key] = settings[key]
        applied.push(key)
      }
    }

    // Mark auto_tune as applied so manual settings aren't overwritten
    if (!config.services) config.services = {}
    config.services.auto_performance_applied = true

    fs.mkdirSync(path.dirname(cfgPath), { recursive: true })
    fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf8')

    return { success: true, path: cfgPath, applied }
  } catch (e) {
    return { success: false, error: e.message, path: null, applied: [] }
  }
}

/**
 * Full auto-tune pipeline: detect → recommend → apply.
 *
 * @param {string} repoDir - Wan2GP repo directory
 * @param {string} dataDir - User data directory
 * @returns {{ hardware: object, recommendation: object, applyResult: object }}
 */
function fullTune(repoDir, dataDir) {
  const hw = detect(repoDir)
  const rec = recommend(hw)
  const app = apply(rec, repoDir, dataDir)
  return { hardware: hw, recommendation: rec, applyResult: app }
}

// ── Helpers for resolving Python env ──

function getEnvsFile(repoDir) {
  return path.join(repoDir || '', 'envs.json')
}

function getActiveEnv(repoDir) {
  const envsFile = getEnvsFile(repoDir)
  if (!fs.existsSync(envsFile)) return null
  try {
    const d = JSON.parse(fs.readFileSync(envsFile, 'utf8'))
    const name = d.active
    return name && d.envs[name] ? d.envs[name] : null
  } catch {
    return null
  }
}

function getPythonForEnv(env) {
  if (!env || !env.path) return null
  const py = path.join(env.path, process.platform === 'win32' ? 'python.exe' : 'bin/python3')
  return fs.existsSync(py) ? py : null
}

function checkPythonImport(py, moduleName) {
  if (!py) return false
  try {
    execSync(`"${py}" -c "import ${moduleName}"`, {
      stdio: 'pipe',
      timeout: 5000,
      windowsHide: true
    })
    return true
  } catch {
    return false
  }
}

// ──────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────

module.exports = {
  detect,
  recommend,
  apply,
  fullTune,
  findWgpConfig,
  readWgpConfig,
  appliedKeys,
  computePerJobCoefficient
}
