/**
 * kernel-resolver.js — single source of truth for GPU kernel-wheel resolution.
 *
 * The launcher's install logic (setup_config.json + syncKernelWheels) and the
 * dashboard overview MUST agree on which kernel wheels a given GPU expects. This
 * module holds the pure, side-effect-free helpers both paths use so the overview
 * can never drift from what actually gets installed.
 *
 * Pure module: requires no electron, no filesystem. Unit-tested in
 * tests/kernel-resolver.test.js.
 */

/**
 * Map a detected GPU to Wan2GP's setup_config.json GPU-profile key.
 * Mirrors the upstream setup.py profile names (RTX_50, RTX_40, RTX_30, RTX_20,
 * GTX_10, AMD_GFX110X, AMD_GFX1151, AMD_GFX1201, MPS) plus the Intel default.
 *
 * @param {{name?:string, vendor?:string}} gpu
 * @returns {string} profile key
 */
function kernelProfileKey(gpu) {
  const g = (gpu && gpu.name || '').toUpperCase()
  const vendor = (gpu && gpu.vendor || '').toUpperCase()
  if (vendor === 'APPLE') return 'MPS'
  if (vendor === 'NVIDIA') {
    if (/ (10|16)\d{2}/.test(g)) return 'GTX_10' // GTX 10/16 → cu128, no kernel wheels
    if (g.includes('50')) return 'RTX_50'
    if (g.includes('40')) return 'RTX_40'
    if (g.includes('30')) return 'RTX_30'
    if (g.includes('20') || g.includes('QUADRO')) return 'RTX_20'
    return 'GTX_10'
  }
  if (vendor === 'AMD') {
    // RDNA 3 desktop (gfx110X):
    if (/7600|7700|7800|7900|780M/.test(g)) return 'AMD_GFX110X'
    // RDNA 3.5 APUs (gfx1150/1151): Strix Halo, Strix Point 890M, Z1/Phoenix
    if (/890M|STRIX|HALO|Z1|PHOENIX|7000/.test(g)) return 'AMD_GFX1151'
    // RDNA 4 (gfx120X): RX 9060/9070 — upstream's old mapping missed these
    if (/9000|9060|9070|8000|1201/.test(g)) return 'AMD_GFX1201'
    return 'AMD_GFX110X'
  }
  return 'RTX_40' // setup.py default fallback for unknown/Intel
}

/**
 * Parse a wheel URL (`<dist>-<version>-cpNN-...-win_amd64.whl`) into
 * { dist, version }. The raw distribution name is returned WITH its underscores
 * preserved — importlib.metadata uses underscore names (e.g. `llamacpp_gguf_cuda`),
 * so hyphenating here breaks the installed-vs-config comparison for GGUF and any
 * other underscore-named wheel. The display layer can replace _ → - itself.
 *
 * @param {string} url
 * @returns {{dist:string, version:string}|null}
 */
function wheelDistVersion(url) {
  try {
    const base = String(url).split('/').pop().replace(/\.whl$/i, '')
    const m = /^(.+?)-(\d[^-]*?)-(?:cp|py)\d/.exec(base)
    if (!m) return null
    return { dist: m[1], version: m[2] } // raw dist (underscores kept on purpose)
  } catch {
    return null
  }
}

/**
 * Resolve the kernel wheels expected for a GPU from setup_config.json.
 *
 * @param {object} cfg parsed setup_config.json
 * @param {{name?:string, vendor?:string}} gpu detected GPU
 * @returns {{profileKey:string, kernels:string[]}} ordered kernel names for the profile
 */
function resolveKernelWheels(cfg, gpu) {
  const profileKey = kernelProfileKey(gpu)
  const profile = (cfg && cfg.gpu_profiles && cfg.gpu_profiles[profileKey]) || null
  const kernels = (profile && Array.isArray(profile.kernels)) ? profile.kernels : []
  return { profileKey, kernels }
}

// pip distribution name → friendly display label + pip install token.
// `pipName` is what `pip install` / importlib.metadata use (underscores kept).
const KERNEL_DISPLAY = {
  nunchaku:            { label: 'Nunchaku',        pipName: 'nunchaku' },
  gguf:                { label: 'GGUF (llamacpp)', pipName: 'llamacpp_gguf_cuda' },
  llamacpp_gguf_cuda:  { label: 'GGUF (llamacpp)', pipName: 'llamacpp_gguf_cuda' },
  lightx2v:            { label: 'LightX2V',        pipName: 'lightx2v' },
  sageattention:       { label: 'SageAttention',   pipName: 'sageattention' },
  spas_sage_attn:      { label: 'Sparge (Sage)',   pipName: 'spas_sage_attn' },
  flash_attn:          { label: 'FlashAttention',  pipName: 'flash_attn' },
  bitsandbytes:        { label: 'bitsandbytes NF4', pipName: 'bitsandbytes' },
}

/**
 * Build the overview wheel list for a GPU: every kernel the profile declares,
 * annotated with its configured target version (from setup_config.json) so the
 * renderer can show ✓ (installed & current) / ⚠ (installed, version mismatch) /
 * ✗ (not installed) without a second IPC.
 *
 * @param {object} cfg parsed setup_config.json
 * @param {{name?:string, vendor?:string}} gpu detected GPU
 * @param {string} osKey 'win' | 'linux'
 * @returns {Array<{key:string, label:string, pipName:string, configured:string|null}>}
 */
function buildOverviewWheels(cfg, gpu, osKey) {
  const { profileKey, kernels } = resolveKernelWheels(cfg, gpu)
  const components = (cfg && cfg.components && cfg.components.kernels) || {}
  return kernels.map((name) => {
    const def = KERNEL_DISPLAY[name] || { label: name, pipName: name }
    const cmd = components[name] && components[name].cmd && components[name].cmd[osKey]
    let configured = null
    if (cmd) {
      const wi = wheelDistVersion(cmd)
      if (wi) configured = wi.version
    }
    return { key: name, label: def.label, pipName: def.pipName, configured }
  })
}

module.exports = {
  kernelProfileKey,
  wheelDistVersion,
  resolveKernelWheels,
  buildOverviewWheels,
  KERNEL_DISPLAY,
}
