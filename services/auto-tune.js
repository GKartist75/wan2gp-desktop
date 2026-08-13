/**
 * Performance Auto-Tune for Wan2GP
 *
 * Detect hardware → recommend optimal settings → apply to wgp_config.json.
 *
 * Reworked 2026-08: tiers/coefficient/audio-profile aligned with Wan2GP's own
 * calibrations, verified against wgp.py thresholds and the vae2_2 VAE tiling
 * table. Detection is fully async — nothing blocks the Electron main process
 * (previously up to ~30s of frozen UI from execSync probes).
 *
 * Pure functions — no side effects in detect()/recommend(). apply() writes
 * to Wan2GP's wgp_config.json on disk.
 *
 * @module auto-tune
 */

const { execFile } = require('child_process')
const { promisify } = require('util')
const os = require('os')
const fs = require('fs')
const path = require('path')

const execFileP = promisify(execFile)

// ──────────────────────────────────────────────
//  Bounded async runner (never blocks, never throws)
// ──────────────────────────────────────────────

/**
 * Run a command with a hard timeout. Returns trimmed stdout or null.
 * Bounded to timeoutMs so a driver/env problem can't hang the app.
 */
async function run(cmd, args, timeoutMs = 5000) {
  try {
    const { stdout } = await execFileP(cmd, args, {
      timeout: timeoutMs,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024
    })
    return stdout.trim()
  } catch {
    return null
  }
}

// ──────────────────────────────────────────────
//  Hardware Detection
// ──────────────────────────────────────────────

/**
 * Query ALL NVIDIA GPUs via nvidia-smi and pick the one with the most VRAM.
 * (Multi-GPU rigs: nvidia-smi lists in PCI order, not "primary" order, so the
 * first entry is not necessarily the discrete card.)
 *
 * Returns { name, vramMb, vramGb, capability, driver } or null.
 */
async function queryNvidiaGpu() {
  const raw = await run(
    'nvidia-smi',
    ['--query-gpu=name,memory.total,compute_cap,driver_version', '--format=csv,noheader,nounits'],
    8000
  )
  if (!raw) return null

  const gpus = raw.split('\n').filter(Boolean).map(line => {
    const parts = line.split(',').map(s => s.trim())
    const vramMb = parseFloat(parts[1]) || 0
    return {
      name: parts[0] || 'Unknown',
      vram_mb: vramMb,
      vram_gb: Math.round(vramMb / 1024),
      capability: parts[2] || '',
      driver: parts[3] || ''
    }
  })
  if (!gpus.length) return null
  // Highest-VRAM GPU wins (discrete card on hybrid laptops).
  return gpus.reduce((best, g) => (g.vram_mb > best.vram_mb ? g : best), gpus[0])
}

/**
 * Detect CUDA version via `nvidia-smi --version`.
 */
async function queryCudaVersion() {
  const raw = await run('nvidia-smi', ['--version'], 4000)
  if (!raw) return null
  const m = raw.match(/CUDA Version:\s*(\d+\.\d+)/)
  return m ? m[1] : null
}

/**
 * RAM tier from GiB, with tolerance for what the OS actually reports.
 * A "32GB" kit frequently shows 31.4-31.9 GiB and a "64GB" kit 63.5-63.9
 * (BIOS/GFX reservations eat the difference) — those still count as the
 * advertised tier so hardware isn't demoted. Pure, testable.
 *
 * @param {number} ramGb - GiB as reported by the OS (may be fractional)
 * @returns {'high'|'low'|'very_low'}
 */
function ramTierFor(ramGb) {
  if (ramGb >= 63.5) return 'high'
  if (ramGb >= 31.5) return 'low'
  return 'very_low'
}

/**
 * Full hardware detection (async — never blocks the main process).
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
 *   ram_tier           'high' (≥64GB) | 'low' (32-63GB) | 'very_low' (<32GB)
 *   vram_tier          'high' (≥24GB) | 'low' (12-23GB) | 'tight' (<12GB) | 'none'
 *   supports_fp8       bool
 *   supports_nvfp4     bool  (capability ≥ 9.0)
 *   supports_sage      bool
 *   supports_flash     bool
 *   supports_triton    bool
 */
async function detect(repoDir) {
  const gpu = await queryNvidiaGpu()
  const cudaVer = gpu ? await queryCudaVersion() : null

  const cudaAvailable = gpu !== null
  const gpuName = gpu ? gpu.name : '—'
  const gpuVramGb = gpu ? gpu.vram_gb : 0
  const gpuCap = gpu ? gpu.capability : ''

  // System RAM — keep one decimal so a 32GB kit that reports 31.8 GiB to the
  // OS is still recognizably 32GB ("low"), instead of rounding away the truth.
  const ramGb = Math.round((os.totalmem() / 1073741824) * 10) / 10
  const cpuCount = os.cpus().length

  // ── Tiers (match Wan2GP's own thresholds) ──
  // VRAM tier
  let vramTier = 'none'
  if (cudaAvailable) {
    if (gpuVramGb >= 24) vramTier = 'high'
    else if (gpuVramGb >= 12) vramTier = 'low'
    else vramTier = 'tight'
  }

  // RAM tier (system memory)
  // Boundary tolerance: a "32GB" kit often reports 31.4-31.9 GiB to the OS
  // (BIOS/GFX reservations), and a "64GB" kit 63.5-63.9 — treat those as the
  // advertised size so real-world kits don't get demoted to a worse tier.
  const ramTier = ramTierFor(ramGb)

  // ── Capability-based flags ──
  const capMajor = parseFloat(gpuCap) || 0
  const supportsFp8 = capMajor >= 7.0  // Turing+ (all RTX cards)
  const supportsNvfp4 = capMajor >= 9.0  // Blackwell only

  // ── Kernel support ──
  // In Node.js we can't import Python modules directly. We probe by trying a
  // bounded one-liner import from the active env. Parallel + 4s cap each so
  // the whole detection stays well under ~10s.
  const env = repoDir ? getActiveEnv(repoDir) : null
  const py = env ? getPythonForEnv(env) : null

  const [supportsTriton, supportsFlash, supportsSage] = await Promise.all([
    checkPythonImport(py, 'triton'),
    checkPythonImport(py, 'flash_attn'),
    checkPythonImport(py, 'sageattention')
  ])

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

/**
 * Run a shell pipeline with a hard timeout (bounded, async — pipes are needed
 * for the few lspci/grep style probes). Returns trimmed stdout or null.
 */
async function runShell(cmd, timeoutMs = 10000) {
  try {
    const { stdout } = await execFileP(cmd, {
      timeout: timeoutMs,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      shell: true
    })
    return stdout.trim()
  } catch {
    return null
  }
}

/**
 * Async, bounded GPU enumeration — never blocks the main process.
 * nvidia-smi lists every NVIDIA GPU (index + VRAM); WMI/system_profiler/lspci
 * fall back for AMD/Intel/Apple hardware. Same output shape as the old sync
 * 'detect-gpus' IPC so the multi-GPU device picker keeps working unchanged.
 *
 * @returns {Promise<Array<{index:number, name:string, vramMB:number, vendor:string}>>}
 */
async function queryGpuList() {
  const gpus = []
  const ns = await run('nvidia-smi', ['--query-gpu=index,name,memory.total', '--format=csv,noheader'], 10000)
  if (ns) {
    for (const line of ns.split('\n')) {
      const [idx, name, mem] = line.split(',').map(s => s.trim())
      const mi = parseInt(idx)
      if (!Number.isNaN(mi) && name) gpus.push({ index: mi, name, vramMB: parseFloat(mem) || 0, vendor: 'NVIDIA' })
    }
  }
  if (gpus.length) return gpus
  if (process.platform === 'win32') {
    const wmi = await run('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + '|' + $_.AdapterRAM }"], 8000)
    if (wmi) {
      wmi.split('\n').forEach((line, i) => {
        const [name, ram] = line.split('|').map(s => s.trim())
        if (name) gpus.push({ index: i, name, vramMB: Math.round((parseInt(ram) || 0) / (1024 * 1024)), vendor: /radeon|amd/i.test(name) ? 'AMD' : 'INTEL' })
      })
    }
  } else if (process.platform === 'darwin') {
    const sp = await run('system_profiler', ['SPDisplaysDataType'], 10000)
    if (sp) {
      const names = sp.split('\n').filter(l => /Chipset Model/.test(l)).map(l => l.replace('Chipset Model:', '').trim()).filter(Boolean)
      const vramLine = sp.split('\n').find(l => /VRAM \(Dynamic, Max\)|VRAM \(Total\)/.test(l))
      const vramMb = vramLine ? (parseFloat(vramLine.split(':')[1]) || 0) * 1024 : 0
      names.forEach((name, i) => gpus.push({ index: i, name, vramMB: Math.round(vramMb), vendor: 'APPLE' }))
    }
  } else if (process.platform === 'linux') {
    const l = await runShell('lspci | grep -iE "vga|3d" | head -1', 10000)
    if (l) {
      const name = l.split(':')[2]?.trim() || l.trim()
      let vendor = 'UNKNOWN'
      if (/nvidia/i.test(l)) vendor = 'NVIDIA'
      else if (/amd|radeon/i.test(l)) vendor = 'AMD'
      gpus.push({ index: 0, name, vramMB: 0, vendor })
    }
  }
  return gpus
}

/**
 * Async, bounded single-GPU summary — same {vendor, name} shape as the old
 * sync 'detect-gpu' IPC.
 *
 * @returns {Promise<{vendor:string, name:string}>}
 */
async function detectGpuInfo() {
  const gpus = await queryGpuList()
  if (gpus.length) return { vendor: gpus[0].vendor, name: gpus[0].name }
  return { vendor: 'UNKNOWN', name: 'Unknown' }
}

/**
 * Async hardware summary for the dashboard/installer spec cards — same
 * {cpu, ram, gpu, vram} display-string shape as the old sync 'detect-hardware'
 * IPC. CPU/RAM come from node os (instant, no subprocess); GPU/VRAM come from
 * bounded async probes, so the main process never blocks.
 *
 * @returns {Promise<{cpu:string, ram:string, gpu:string, vram:string}>}
 */
async function hardwareInfo() {
  const info = { cpu: '—', ram: '—', gpu: '—', vram: '—' }
  try {
    const model = (os.cpus()[0]?.model || '').trim()
    if (model) info.cpu = model.length > 45 ? model.substring(0, 42) + '...' : model
  } catch {}
  try {
    const ramGb = Math.round(os.totalmem() / 1073741824)
    if (ramGb > 0) info.ram = ramGb + ' GB'
  } catch {}
  try {
    const gpus = await queryGpuList()
    if (gpus.length) {
      info.gpu = gpus.map(g => g.name).join(' + ')
      const vram = gpus.map(g => g.vramMB).filter(Boolean)
      if (vram.length) info.vram = vram.map(mb => (mb >= 1024 ? Math.round(mb / 1024) + ' GB' : Math.round(mb) + ' MB')).join(' + ')
    }
  } catch {}
  return info
}

// ──────────────────────────────────────────────
//  Recommendation Engine
// ──────────────────────────────────────────────

/**
 * Profile matrix keyed by (vram_tier, ram_tier).
 * Maps to Wan2GP's mmgp profile_type with 7 numeric profiles:
 *   1   = HighRAM_HighVRAM       — ≥64GB RAM + ≥24GB VRAM
 *   2   = HighRAM_LowVRAM        — ≥64GB RAM + 12-23GB VRAM
 *   3   = LowRAM_HighVRAM        — 32-63GB RAM + ≥24GB VRAM
 *   3.5 = VeryLowRAM_HighVRAM    — <32GB RAM + ≥24GB VRAM (no reserved mem)
 *   4   = LowRAM_LowVRAM         — 32-63GB RAM + 12-23GB VRAM (Recommended)
 *   4.5 = LowRAM_LowVRAM+        — 32-63GB RAM + <12GB VRAM (slightly slower, less VRAM)
 *   5   = VerylowRAM_LowVRAM     — <32GB RAM + <12GB VRAM (Fail safe)
 *
 * Thresholds (aligned with Wan2GP's memory profile table):
 *   VRAM tiers: high ≥ 24 GB | low 12-23 GB | tight < 12 GB | none (no CUDA)
 *   RAM  tiers: high ≥ 64 GB | low 32-63 GB | very_low < 32 GB
 */
const PROFILE_MATRIX = {
  //         RAM→high      low        very_low
  high:   { high: 1, low: 3, very_low: 3.5 },  // ≥24GB VRAM
  low:    { high: 2, low: 4, very_low: 5 },    // 12-23GB VRAM
  tight:  { high: 4, low: 4.5, very_low: 5 }   // <12GB VRAM
}

/**
 * Audio profile — the fast-LM-decoder rule.
 *
 * Wan2GP only engages the fast LM decoders (vllm / cg) when the memory profile
 * loads the main models fully in VRAM (wgp.py: int(profile) in (1, 3)); any
 * other profile silently falls back to the legacy LM decoder at <1 token/sec,
 * making ACE audio generation take 10-15 minutes and look hung. On cards with
 * ≥12GB pick profile 3 (LowRAM_HighVRAM) for audio so the LM stack engages;
 * below 12GB the LM stack wouldn't fit anyway — inherit the video profile.
 */
function audioProfile(vramGb, videoProfile) {
  if ((vramGb || 0) >= 12 && ![1, 3].includes(Number(videoProfile))) return 3
  return videoProfile
}

/**
 * Quantization — recommends Scaled Int8 ("int8") for best balance.
 * This is Wan2GP's own recommended default and the mmgp offloader's
 * quantizeTransformer=True uses int8 by default (A/B tested:
 * no meaningful quality gain from BF16, slower loads).
 */
function quantForProfile(profile) {
  return 'int8'
}

/** All supported transformer quantization options. */
const QUANT_OPTIONS = [
  { value: 'int8',    label: 'Scaled Int8 \u2705 recommended' },
  { value: 'fp8',     label: 'FP8' },
  { value: 'nvfp4',   label: 'NVFP4' },
  { value: 'no_quant', label: 'None (no quantization)' }
]

/**
 * VAE config — per-tier picker, labels verified against
 * models/wan/modules/vae2_2.py get_VAE_tile_size():
 *   0 = Auto (runtime: ≥24GB → 1, ≥8GB → 2, else 3)
 *   1 = No tiling (fast, high VRAM)
 *   2 = Tiling 256
 *   3 = Tiling 128 (aggressive)
 */
function vaeConfigForTier(vramTier) {
  if (vramTier === 'high') return 1   // full VAE — VRAM is plentiful
  if (vramTier === 'low') return 0   // auto — let the runtime decide
  return 3                            // aggressive tiling — squeeze it
}

/** All supported VAE config options (labels per vae2_2.py semantics). */
const VAE_OPTIONS = [
  { value: 0, label: 'Auto \u2705 recommended' },
  { value: 1, label: 'Full (no tiling)' },
  { value: 2, label: 'Tiling 256' },
  { value: 3, label: 'Tiling 128 (aggressive)' }
]

/**
 * VRAM safety coefficient — calibrated flat policy:
 *   0.80 for ≥12 GB VRAM, 0.70 for <12 GB.
 * Real-world data shows even 24 GB cards OOM at 0.80 on heavy workloads;
 * anything above 0.80 is actively harmful, per-tier tables under-reserve.
 */
function vramCoefficientForTier(vramTier) {
  return vramTier === 'tight' || vramTier === 'none' ? 0.70 : 0.80
}

/** Wan2GP's official profile labels from wgp.py memory_profile_choices. */
const PROFILE_LABELS = {
  1:   'HighRAM \u00b7 HighVRAM',
  2:   'HighRAM \u00b7 LowVRAM',
  3:   'LowRAM \u00b7 HighVRAM',
  3.5: 'VeryLowRAM \u00b7 HighVRAM',
  4:   'LowRAM \u00b7 LowVRAM',
  4.5: 'LowRAM \u00b7 LowVRAM+',
  5:   'VerylowRAM \u00b7 LowVRAM'
}

/** Wan2GP's official profile descriptions from wgp.py. */
const PROFILE_REASONS = {
  1:   'HighRAM_HighVRAM — at least 64 GB RAM + 24 GB VRAM: max performance for short videos on RTX 3090/4090',
  2:   'HighRAM_LowVRAM — at least 64 GB RAM + 12 GB VRAM: most versatile profile, suited for RTX 3070/3080/4070/4080 or large batches/long videos on 3090/4090',
  3:   'LowRAM_HighVRAM — at least 32 GB RAM + 24 GB VRAM: adapted for 3090/4090 with limited RAM for good speed on short video',
  3.5: 'VeryLowRAM_HighVRAM — at least 32 GB RAM + 24 GB VRAM: variant of P3 that won\'t use Reserved Memory, reducing RAM usage',
  4:   'LowRAM_LowVRAM (Recommended) — at least 32 GB RAM + 12 GB VRAM: balanced, good for longer videos with limited VRAM',
  4.5: 'LowRAM_LowVRAM+ — at least 32 GB RAM + 12 GB VRAM: variant of P4, slightly slower but needs less VRAM',
  5:   'VerylowRAM_LowVRAM (Fail safe) — at least 24 GB RAM + 10 GB VRAM: minimum compatibility, won\'t be fast but may work'
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
 * @param {object} hw     - Output from detect()
 * @param {object} [opts] - Options: { failsafe: boolean } forces the P5
 *                          max-compatibility profile regardless of the matrix
 *                          (for users who prefer stability over speed).
 * @returns {object} Settings dict with keys matching appliedKeys() plus
 *                   _recommendation_label and _recommendation_reason.
 */
function recommend(hw, opts) {
  // No CUDA — conservative fallback, clearly labeled. Never silently pick
  // P5: the user needs to know auto-tune can't help their hardware.
  if (hw && hw.cuda_available === false) {
    return {
      video_profile: 4.5,
      image_profile: 4.5,
      audio_profile: 4.5,
      transformer_quantization: 'int8',
      vae_config: 3,
      vram_safety_coefficient: 0.70,
      _recommendation_label: 'Auto-tune unavailable on this hardware',
      _recommendation_reason: 'No CUDA-capable GPU detected. Conservative profile applied — generation may be limited.'
    }
  }

  const vramTier = hw && hw.vram_tier ? hw.vram_tier : 'low'
  const ramTier = hw && hw.ram_tier ? hw.ram_tier : 'low'
  const vramGb = hw && hw.gpu_vram_gb ? hw.gpu_vram_gb : 0

  // Failsafe preference: ignore the matrix, force the P5 minimum-compatibility
  // profile (Wan2GP: "won't be fast but may work") plus the lowest VRAM ceiling.
  const failsafe = !!(opts && opts.failsafe)
  let profile, coeff, vaeCfg
  if (failsafe) {
    profile = 5
    coeff = 0.60 // deliberately below the calibrated 0.70/0.80 — max headroom
    vaeCfg = 3   // aggressive tiling everywhere
  } else {
    // Lookup base profile from matrix
    const ramRow = PROFILE_MATRIX[vramTier] || PROFILE_MATRIX.low
    profile = ramRow[ramTier]
    if (profile === undefined) profile = 4
    coeff = vramCoefficientForTier(vramTier)
    // Detect leaves VAE on AUTO (0): the runtime picks tiling from actual VRAM
    // (≥24GB → full, ≥8GB → 256, else 128). Avoids forcing a suboptimal fixed
    // tiling that wastes VRAM or adds banding.
    vaeCfg = 0
  }

  const videoProfile = profile
  const imageProfile = profile
  const audioProfileValue = audioProfile(vramGb, videoProfile)

  const quant = quantForProfile(videoProfile)

  return {
    video_profile: videoProfile,
    image_profile: imageProfile,
    audio_profile: audioProfileValue,
    vram_safety_coefficient: coeff,
    vae_config: vaeCfg,
    transformer_quantization: quant,
    _recommendation_label: failsafe
      ? 'Failsafe · P5 (maximum compatibility)'
      : (PROFILE_LABELS[videoProfile] || 'Custom'),
    _recommendation_reason: failsafe
      ? 'Failsafe preference: P5 (VerylowRAM_LowVRAM) — minimum compatibility profile, won\'t be fast but maximizes the chance that generation works.'
      : (PROFILE_REASONS[videoProfile] || 'Custom configuration')
  }
}

// ──────────────────────────────────────────────
//  Config I/O
// ──────────────────────────────────────────────

/**
 * Find Wan2GP's wgp_config.json.
 *
 * Strategy — repo dir FIRST, never process.cwd() (a packaged exe's cwd can
 * hold a stray wgp_config.json; writing there would be invisible to Wan2GP,
 * which reads the repo dir):
 *   1. Repo dir (cloned Wan2GP)
 *   2. User data dir
 *   3. CWD (last resort)
 *
 * @param {string} repoDir - Wan2GP repo directory (from main.js)
 * @param {string} dataDir - User data directory
 * @returns {string|null} Full path to wgp_config.json or null
 */
function findWgpConfig(repoDir, dataDir) {
  const candidates = [
    path.join(repoDir || '', 'wgp_config.json'),
    path.join(dataDir || '', 'wgp_config.json'),
    path.join(dataDir || '', 'Wan2GP', 'wgp_config.json'),
    path.join(process.cwd(), 'wgp_config.json')
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
 * Full auto-tune pipeline: detect → recommend → apply. (async detect)
 *
 * @param {string} repoDir - Wan2GP repo directory
 * @param {string} dataDir - User data directory
 * @returns {Promise<{ hardware: object, recommendation: object, applyResult: object }>}
 */
async function fullTune(repoDir, dataDir) {
  const hw = await detect(repoDir)
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

async function checkPythonImport(py, moduleName) {
  if (!py) return false
  const out = await run(py, ['-c', `import ${moduleName}`], 4000)
  return out !== null
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
  computePerJobCoefficient,
  // async hardware probes (non-blocking IPC backends)
  queryGpuList,
  detectGpuInfo,
  hardwareInfo,
  // exposed for tests
  audioProfile,
  vramCoefficientForTier,
  vaeConfigForTier,
  ramTierFor,
  PROFILE_MATRIX
}