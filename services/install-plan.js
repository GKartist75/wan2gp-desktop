/**
 * Install Plan — pre-flight hardware-aware summary for the Wan2GP Desktop Launcher.
 *
 * Given the detected hardware, compute exactly what the automatic installer will
 * pull BEFORE cloning the repo, so the UI can show a "what will be installed"
 * confirm panel (a README promise the installer previously skipped) and surface
 * driver/space blockers up front.
 *
 * This is PURE and offline-testable: it only maps hardware → plan. No git/clone.
 *
 * Rules mirrored from main.js / services/auto-tune.js:
 *  - NVIDIA RTX 20/30/40/50 (compute ≥ 7.0, not GTX 10/16) → PyTorch 2.10 + CUDA 13
 *  - GTX 10/16 (compute 6.1) → legacy PyTorch 2.7.1 + CUDA 12.8
 *  - NVIDIA cu130 needs driver R580+ (skipped for GTX 10/16)
 *  - AMD (Windows) → ROCm "TheRock" torch 2.7.0 + numpy 1.26.4 pin
 *  - Apple/Intel → MPS/CPU (no CUDA)
 *  - Attention kernels: SageAttention, FlashAttention, SpargeAttention, LightX2V
 *    (RTX 50), Nunchaku+GGUF — installed by setup.py per its own matrix.
 */

'use strict'

const RAM_TIERS = { high: 64, low: 32 }       // ≥64 high, ≥32 low, else very_low
const VRAM_TIERS = { high: 24, low: 12 }       // ≥24 high, ≥12 low, else tight/none

function ramTier(ramGb) {
  if (ramGb >= RAM_TIERS.high) return 'high'
  if (ramGb >= RAM_TIERS.low) return 'low'
  return 'very_low'
}

function vramTier(vramGb) {
  if (vramGb >= VRAM_TIERS.high) return 'high'
  if (vramGb >= VRAM_TIERS.low) return 'low'
  if (vramGb > 0) return 'tight'
  return 'none'
}

function isGtx1016(name) {
  return / (10|16)\d{2}/.test(name || '') // GTX 1050/1060/1650 etc.
}

/**
 * Build the resolved install plan.
 * @param {object} hw { vendor, name, vramGb, driverVersion, capability, ramGb }
 * @returns {object} { vendor, cuda, torch, attention, numpyPin, driverWarning, notes[] }
 */
function buildPlan(hw = {}) {
  const vendor = (hw.vendor || 'UNKNOWN').toUpperCase()
  const name = hw.name || ''
  const vramGb = Number(hw.vramGb) || 0
  const ramGb = Number(hw.ramGb) || 0
  const cap = parseFloat(hw.capability) || 0
  const notes = []

  let cuda = 'n/a'
  let torch = 'n/a'
  let numpyPin = null
  let attention = []
  let driverWarning = ''

  if (vendor === 'NVIDIA') {
    const gtx = isGtx1016(name)
    if (gtx) {
      cuda = 'CUDA 12.8'
      torch = 'PyTorch 2.7.1'
      notes.push('Legacy GTX 10/16 series → CUDA 12.8 stack (no R580 driver required).')
    } else {
      cuda = 'CUDA 13 (cu130)'
      torch = 'PyTorch 2.10'
      const dv = parseFloat(hw.driverVersion)
      if (dv && dv < 580) {
        driverWarning = `NVIDIA driver ${hw.driverVersion} is older than R580. The cu130 packages need driver R580+. Update the driver before installing, or generation will fail with CUDA errors.`
      }
      notes.push('RTX 20/30/40/50 → CUDA 13 stack (needs R580+ driver).')
    }
    // Attention kernels Wan2GP installs for NVIDIA
    attention = ['SageAttention', 'FlashAttention', 'SpargeAttention']
    if (cap >= 9.0) attention.push('Nunchaku + GGUF', 'LightX2V')
    if (cap >= 7.0) attention.push('SpargeAttention')
  } else if (vendor === 'AMD') {
    cuda = 'ROCm (TheRock)'
    torch = 'PyTorch 2.7.0'
    numpyPin = 'numpy==1.26.4 (ROCm torch compatibility on Windows)'
    attention = ['SageAttention (ROCm)', 'FlashAttention (ROCm)']
    notes.push('AMD detected — ROCm torch build; Windows needs the numpy 1.26.4 pin.')
  } else if (vendor === 'APPLE') {
    cuda = 'MPS (Metal)'
    torch = 'PyTorch (MPS)'
    attention = ['(MPS path — kernels limited)']
    notes.push('Apple Silicon → MPS backend (no CUDA).')
  } else if (vendor === 'INTEL') {
    cuda = 'Intel XPU'
    torch = 'PyTorch (XPU)'
    attention = []
    notes.push('Intel GPU detected — XPU backend.')
  } else {
    cuda = 'CPU'
    torch = 'PyTorch (CPU)'
    attention = []
    notes.push('No compatible GPU detected — CPU-only (very slow). Install a GPU driver or check detection.')
  }

  const rt = ramTier(ramGb)
  const vt = vramTier(vramGb)
  if (vt === 'none' && vendor === 'NVIDIA') {
    notes.push('VRAM not reported — CUDA may be unavailable; install will still run but generation needs a GPU.')
  }

  return {
    vendor: vendor || 'UNKNOWN',
    gpuName: name,
    vramGb,
    ramGb,
    ramTier: rt,
    vramTier: vt,
    cuda,
    torch,
    attention,
    numpyPin,
    driverWarning,
    notes,
    envType: 'venv (uv, Python 3.11)',
    python: 'Python 3.11 (uv-managed)'
  }
}

/**
 * Disk-space gate: warn if free space is below a safe threshold.
 * @param {number} freeGb
 * @param {number} minGb default 8
 */
function diskCheck(freeGb, minGb = 8) {
  const f = Number(freeGb)
  if (!f) return { ok: true, warn: '' } // unknown → don't block
  if (f < minGb) return { ok: false, warn: `Only ${f.toFixed(1)} GB free — install needs ~${minGb} GB (env + models download more later). Free space first.` }
  if (f < minGb * 2) return { ok: true, warn: `Free space is tight (${f.toFixed(1)} GB). Models download additional space later.` }
  return { ok: true, warn: '' }
}

module.exports = { buildPlan, diskCheck, ramTier, vramTier, isGtx1016, RAM_TIERS, VRAM_TIERS }
