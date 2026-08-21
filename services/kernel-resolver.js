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
 * GGUF llama.cpp CUDA kernel target version.
 *
 * The doc (docs/INSTALLATION.md) documents 1.0.11 as the current wheel. The
 * wheel IS published — but its build suffix differs from the 1.0.8 entry that
 * setup_config.json carries: 1.0.8 uses `torch210cu13py311`, 1.0.11 uses
 * `torch210cu130py311` (CUDA 13.0, not "cu13"). A naive version-number bump on
 * the URL therefore 404s. So we map to the FULL published URLs (verified 302)
 * keyed by the profile's torch code, rather than string-surgerying the version.
 *
 * @type {string}
 */
const GGUF_TARGET_VERSION = '1.0.11'

// Full published wheel URLs for GGUF_TARGET_VERSION, keyed by torch code from
// setup_config.json's gpu_profiles (cu130 / cu128). Verified live 302 (exists).
// RTX 20/30/40/50 → cu130; legacy GTX 10/16 → cu128. AMD/Apple have no GGUF wheel.
const GGUF_TARGET_URLS = {
  cu130: 'https://github.com/deepbeepmeep/kernels/releases/download/GGUF_Kernels/llamacpp_gguf_cuda-1.0.11+torch210cu130py311-cp311-cp311',
  cu128: 'https://github.com/deepbeepmeep/kernels/releases/download/GGUF_Kernels/llamacpp_gguf_cuda-1.0.11+torch271cu128py310-cp310-cp310',
}

/**
 * Resolve the GGUF wheel URL for the target version, preserving the platform
 * suffix (win_amd64 / linux_x86_64) of the profile's own URL.
 *
 * @param {string} key kernel profile key (e.g. 'gguf')
 * @param {string} cmd the setup_config.json wheel URL (e.g. ...1.0.8+torch210cu13py311-...-win_amd64.whl)
 * @param {string} torchCode profile torch code (e.g. 'cu130', 'cu128'); when
 *                 omitted, inferred from the cmd URL's `torchNNNcuXXX` segment.
 * @returns {string} a 1.0.11 URL with the same platform suffix, or the original
 *          cmd on any mismatch (so install never 404s on an unknown profile).
 */
function applyGgufOverride(key, cmd, torchCode) {
  if (key !== 'gguf' || typeof cmd !== 'string') return cmd
  const code = torchCode
    || (/(torch\d+)(cu\d+)/.exec(cmd) && RegExp.$2)
    || ''
  const base = GGUF_TARGET_URLS[code]
  if (!base) return cmd // unknown torch code → fall back to profile's own URL
  const ext = /\.whl$/i.test(cmd) ? '.whl' : ''
  const plat = (/-win_amd64/.test(cmd) && 'win_amd64') || (/-linux_x86_64/.test(cmd) && 'linux_x86_64') || 'win_amd64'
  return `${base}-${plat}${ext}`
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
// Keys MUST match setup_config.json's gpu_profiles[].kernels entries.
// nunchaku_cu13 + light2xv are the real keys upstream uses (not bare
// "nunchaku"/"lightx2v"). pipName is the importlib dist name used to detect
// the installed version (wheels: nunchaku-1.2.1..., lightx2v_kernel-0.0.2...).
const KERNEL_DISPLAY = {
  nunchaku_cu13:       { label: 'Nunchaku',        pipName: 'nunchaku' },
  nunchaku:            { label: 'Nunchaku',        pipName: 'nunchaku' },
  gguf:                { label: 'GGUF (llamacpp)', pipName: 'llamacpp_gguf_cuda' },
  llamacpp_gguf_cuda:  { label: 'GGUF (llamacpp)', pipName: 'llamacpp_gguf_cuda' },
  light2xv:            { label: 'LightX2V',        pipName: 'lightx2v_kernel' },
  lightx2v_kernel:     { label: 'LightX2V',        pipName: 'lightx2v_kernel' },
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
  const profile = (cfg && cfg.gpu_profiles && cfg.gpu_profiles[profileKey]) || null
  const torchCode = (profile && profile.torch) || null
  const components = (cfg && cfg.components && cfg.components.kernels) || {}
  return kernels.map((name) => {
    const def = KERNEL_DISPLAY[name] || { label: name, pipName: name }
    const cmd = components[name] && components[name].cmd && components[name].cmd[osKey]
    const url = applyGgufOverride(name, cmd, torchCode) // GGUF → 1.0.11 (doc target)
    let configured = null
    if (url) {
      const wi = wheelDistVersion(url)
      if (wi) configured = wi.version
    }
    return { key: name, label: def.label, pipName: def.pipName, configured }
  })
}

/**
 * SageAttention wheel safety override.
 *
 * ROOT CAUSE (issue #64, upstream #2178/#199): the upstream profile wheel
 * `sage.v220_cu13` = `sageattention-2.2.0+cu130torch2.9.0andhigher.post4`
 * ships CUDA kernels built against torch 2.9. Under the torch 2.10 + CUDA 13
 * runtime the launcher installs, its fp8-PV kernel (`sageattn_qk_int8_pv_fp8_cuda`)
 * corrupts the CUDA context on RTX 40/50 (sm89/sm120) → false OOM / stall /
 * abort and silent black frames in MiniMax H3's VAE decode.
 *
 * SageAttention deliberately ignores CUDA *minor* (12.8 vs 13.0), and the
 * `sage.v220` wheel (`sageattention-2.2.0+cu128torch2.7.1-...`) is the
 * stable fp8 build (cu128 >= 12.8 satisfies the fp32+fp16 path). So for
 * RTX 40/50 we swap the cu130 wheel for the cu128 wheel, keeping the
 * SageAttention2++ speedup while dispatching the kernel correctly.
 *
 * RTX 20 is untouched (uses sage v1, no fp8 kernel). RTX 30 is sm86 → routes
 * to the safe Triton fp16 kernel, also left as-is. GTX 10/16 have no sage.
 *
 * @param {string} key kernel name from the profile (e.g. 'sage')
 * @param {string} cmd the setup_config.json wheel URL for this key
 * @param {{name?:string, vendor?:string}} gpu detected GPU
 * @param {object} [opts] extra context
 * @param {boolean} [opts.torchGte210] whether the active env runs torch >= 2.10
 * @returns {string} the (possibly overridden) wheel URL
 */
const SAGE_CU130_WHEEL = 'sageattention-2.2.0+cu130torch2.9.0andhigher.post4'
// Stable, fp8-safe SageAttention2++ replacement for the broken `cu130torch2.9.0andhigher.post4`
// wheel on RTX 40/50 under torch >= 2.10.
//
// IMPORTANT — must be **cu130-native**, NOT cu128:
// the launcher installs torch 2.10 + CUDA 13.0 (cu130). A `cu128` SageAttention wheel's
// compiled `_fused.pyd` links against CUDA 12.8 runtimes that are NOT present in a cu130
// env, so it fails at import with "DLL load failed while importing _fused". The correct
// replacement is the **cu130** build from the same v2.2.0-windows.post6 release:
//   sageattention-2.2.0+cu130torch2.10.0andhigher.post6-cp310-abi3-win_amd64.whl
// `cp310-abi3` → installs fine on Python 3.11 (abi3, not cp310-only). `.post6` is the
// build where the fp8 out-of-bounds bug (black/noise outputs) is fixed — see SageAttention #98.
const SAGE_CU130_SAFE_WHEEL = 'sageattention-2.2.0+cu130torch2.10.0andhigher.post6-cp310-abi3-win_amd64.whl'
const SAGE_CU130_SAFE_BASE  = 'https://github.com/woct0rdho/SageAttention/releases/download/v2.2.0-windows.post6/'

function applySageOverride(key, cmd, gpu, opts = {}) {
  if (key !== 'sage' || typeof cmd !== 'string') return cmd
  const prof = kernelProfileKey(gpu)
  // Only RTX 40/50 are on the broken fp8-PV path under torch >= 2.10.
  if (prof !== 'RTX_40' && prof !== 'RTX_50') return cmd
  if (!(opts.torchGte210)) return cmd
  if (!cmd.includes(SAGE_CU130_WHEEL)) return cmd
  // Swap the broken cu130 (torch2.9.0andhigher.post4) build for the stable
  // cu130.post6 build (same CUDA 13.0 stack, fp8 out-of-bounds fixed).
  return `${SAGE_CU130_SAFE_BASE}${SAGE_CU130_SAFE_WHEEL}`
}

/**
 * Normalize a SageAttention wheel URL to its canonical dist-version fragment so
 * the sync version check treats a *good* wheel (cu128) as equivalent to the
 * (broken) cu130 wheel the profile declares. Without this, a user who landed on
 * the working cu128 wheel would have it overwritten on the next sync by the
 * broken cu130 wheel (the old code compared exact parsed versions).
 *
 * @param {string} url wheel URL
 * @returns {string|null} e.g. 'sageattention-2.2.0' (version stripped of CUDA/torch tag)
 */
function sageWheelFamily(url) {
  if (typeof url !== 'string') return null
  const base = url.split('/').pop().replace(/\.whl$/i, '')
  const m = /^(sageattention-2\.2\.0)/i.exec(base)
  return m ? m[1] : null
}

module.exports = {
  kernelProfileKey,
  wheelDistVersion,
  resolveKernelWheels,
  buildOverviewWheels,
  applyGgufOverride,
  applySageOverride,
  sageWheelFamily,
  SAGE_CU130_WHEEL,
  SAGE_CU130_SAFE_WHEEL,
  SAGE_CU130_SAFE_BASE,
  GGUF_TARGET_VERSION,
  KERNEL_DISPLAY,
}
