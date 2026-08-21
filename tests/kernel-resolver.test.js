/**
 * Tests for services/kernel-resolver.js — the single source of truth for which
 * GPU kernel wheels the dashboard shows and the installer syncs.
 *
 * The whole bug class this fixes ("queried but never rendered", "wrong GGUF
 * package") comes from the overview and the installer disagreeing. These tests
 * pin both to the SAME setup_config.json-derived logic.
 *
 * Run: node --test tests/kernel-resolver.test.js
 */
const { test } = require('node:test')
const assert = require('node:assert')
const k = require('../services/kernel-resolver.js')

// Minimal upstream-shaped setup_config.json (only the bits we read).
// Keys match the REAL upstream gpu_profiles[].kernels entries (nunchaku_cu13,
// light2xv) — not the bare names the dashboard display layer also accepts.
const CFG = {
  gpu_profiles: {
    RTX_20:  { torch: 'cu130', kernels: ['nunchaku_cu13', 'gguf'] },
    RTX_30:  { torch: 'cu130', kernels: ['nunchaku_cu13', 'gguf'] },
    RTX_40:  { torch: 'cu130', kernels: ['nunchaku_cu13', 'gguf'] },
    RTX_50:  { torch: 'cu130', kernels: ['nunchaku_cu13', 'light2xv', 'gguf'] },
    GTX_10:  { torch: 'cu128', kernels: [] },
    AMD_GFX110X: { kernels: [] },
    MPS:     { kernels: [] },
  },
  components: {
    kernels: {
      nunchaku_cu13:      { cmd: { win: 'https://x/nunchaku-1.2.1+cu130torch2.10-cp311-cp311-win_amd64.whl' } },
      gguf:               { cmd: { win: 'https://x/llamacpp_gguf_cuda-1.0.8-cp311-cp311-win_amd64.whl' } },
      light2xv:           { cmd: { win: 'https://x/lightx2v_kernel-0.0.2-cp311-abi3-win_amd64.whl' } },
    },
  },
}

// ── kernelProfileKey ──
test('RTX 50 → RTX_50, RTX 40 → RTX_40, GTX 1060 → GTX_10', () => {
  assert.strictEqual(k.kernelProfileKey({ vendor: 'NVIDIA', name: 'NVIDIA GeForce RTX 5090' }), 'RTX_50')
  assert.strictEqual(k.kernelProfileKey({ vendor: 'NVIDIA', name: 'RTX 4080' }), 'RTX_40')
  assert.strictEqual(k.kernelProfileKey({ vendor: 'NVIDIA', name: 'NVIDIA GeForce GTX 1060 6GB' }), 'GTX_10')
  assert.strictEqual(k.kernelProfileKey({ vendor: 'NVIDIA', name: 'NVIDIA GeForce RTX 2060' }), 'RTX_20')
})

test('Apple → MPS, AMD → gfx family, Intel → RTX_40 default', () => {
  assert.strictEqual(k.kernelProfileKey({ vendor: 'APPLE', name: 'Apple M2' }), 'MPS')
  assert.strictEqual(k.kernelProfileKey({ vendor: 'AMD', name: 'AMD Radeon RX 7900 XTX' }), 'AMD_GFX110X')
  assert.strictEqual(k.kernelProfileKey({ vendor: 'AMD', name: 'AMD Radeon RX 9070' }), 'AMD_GFX1201')
  assert.strictEqual(k.kernelProfileKey({ vendor: 'INTEL', name: 'Arc A770' }), 'RTX_40')
})

// ── wheelDistVersion: THE root-cause fix (underscores must be preserved) ──
test('wheelDistVersion keeps underscores (GGUF dist name)', () => {
  const w = k.wheelDistVersion('https://example.com/llamacpp_gguf_cuda-1.0.11-cp311-cp311-win_amd64.whl')
  assert.ok(w, 'parsed')
  assert.strictEqual(w.dist, 'llamacpp_gguf_cuda', 'dist name kept verbatim (no _→- rewrite)')
  assert.strictEqual(w.version, '1.0.11')
})

test('wheelDistVersion parses a normal wheel', () => {
  const w = k.wheelDistVersion('https://example.com/nunchaku-1.2.1+cu130torch2.10-cp311-cp311-win_amd64.whl')
  assert.strictEqual(w.dist, 'nunchaku')
  assert.strictEqual(w.version, '1.2.1+cu130torch2.10')
})

// ── applySageOverride: RTX 40/50 under torch>=2.10 swap broken cu130→safe cu130.post6 ──
const SAGE_CU130 = 'https://github.com/woct0rdho/SageAttention/releases/download/v2.2.0-windows.post4/sageattention-2.2.0+cu130torch2.9.0andhigher.post4-cp39-abi3-win_amd64.whl'
// NOTE: the safe replacement must be **cu130-native** (NOT cu128). The launcher runs
// torch 2.10 + CUDA 13.0; a cu128 wheel's `_fused.pyd` links CUDA 12.8 runtimes that
// are absent in a cu130 env → "DLL load failed while importing _fused". The correct
// replacement is the cu130.post6 build (cp310-abi3 → installs on Python 3.11, fp8 fixed).
const SAGE_CU128 = 'https://github.com/woct0rdho/SageAttention/releases/download/v2.2.0-windows.post6/sageattention-2.2.0+cu130torch2.10.0andhigher.post6-cp310-abi3-win_amd64.whl'

test('applySageOverride swaps broken cu130→safe cu130.post6 for RTX 40/50 under torch>=2.10', () => {
  const out = k.applySageOverride('sage', SAGE_CU130, { vendor: 'NVIDIA', name: 'RTX 4090' }, { torchGte210: true })
  assert.ok(out.includes('cu130torch2.10.0andhigher.post6'), 'swapped to the stable cu130.post6 build')
  assert.ok(!out.includes('cu130torch2.9.0andhigher.post4'), 'broken cu130 build gone')
})

test('applySageOverride leaves RTX 40/50 alone when torch < 2.10', () => {
  const out = k.applySageOverride('sage', SAGE_CU130, { vendor: 'NVIDIA', name: 'RTX 4090' }, { torchGte210: false })
  assert.strictEqual(out, SAGE_CU130, 'no change on older torch')
})

test('applySageOverride leaves RTX 30/20 alone (safe fp16/triton paths)', () => {
  assert.strictEqual(k.applySageOverride('sage', SAGE_CU130, { vendor: 'NVIDIA', name: 'RTX 3090' }, { torchGte210: true }), SAGE_CU130)
  assert.strictEqual(k.applySageOverride('sage', SAGE_CU130, { vendor: 'NVIDIA', name: 'RTX 2070' }, { torchGte210: true }), SAGE_CU130)
})

test('applySageOverride ignores non-sage keys and non-win cu130 wheels', () => {
  assert.strictEqual(k.applySageOverride('flash', SAGE_CU130, { vendor: 'NVIDIA', name: 'RTX 4090' }, { torchGte210: true }), SAGE_CU130)
  assert.strictEqual(k.applySageOverride('sage', SAGE_CU128, { vendor: 'NVIDIA', name: 'RTX 4090' }, { torchGte210: true }), SAGE_CU128)
})

// ── sageWheelFamily: treats cu128 as equivalent to cu130 (sync must not overwrite a good wheel) ──
test('sageWheelFamily normalizes cu130 and cu128 to the same family', () => {
  assert.strictEqual(k.sageWheelFamily(SAGE_CU130), 'sageattention-2.2.0')
  assert.strictEqual(k.sageWheelFamily(SAGE_CU128), 'sageattention-2.2.0')
})

// ── buildOverviewWheels: profile-driven, real dist names ──
test('RTX 50 overview lists nunchaku_cu13 + light2xv + gguf with configured versions', () => {
  const wheels = k.buildOverviewWheels(CFG, { vendor: 'NVIDIA', name: 'RTX 5090' }, 'win')
  const keys = wheels.map(w => w.key)
  assert.deepStrictEqual(keys, ['nunchaku_cu13', 'light2xv', 'gguf'])
  const gguf = wheels.find(w => w.key === 'gguf')
  assert.strictEqual(gguf.pipName, 'llamacpp_gguf_cuda', 'uses the CUDA kernel dist, not the `gguf` quant tool')
  assert.ok(gguf.configured.startsWith('1.0.11'), `GGUF shows 1.0.11 (got ${gguf.configured})`)
  assert.strictEqual(gguf.label, 'GGUF (llamacpp)')
})

test('RTX 40 overview omits light2xv (RTX 50-only NVFP4 kernel)', () => {
  const wheels = k.buildOverviewWheels(CFG, { vendor: 'NVIDIA', name: 'RTX 4080' }, 'win')
  assert.deepStrictEqual(wheels.map(w => w.key), ['nunchaku_cu13', 'gguf'])
})

test('GTX 10 / AMD / Apple overview is empty (no kernel section shown)', () => {
  for (const gpu of [
    { vendor: 'NVIDIA', name: 'GTX 1060' },
    { vendor: 'AMD', name: 'RX 7900' },
    { vendor: 'APPLE', name: 'M2' },
  ]) {
    const wheels = k.buildOverviewWheels(CFG, gpu, 'win')
    assert.deepStrictEqual(wheels, [], `${gpu.name} → no kernel wheels`)
  }
})

// ── resolveKernelWheels ──
test('resolveKernelWheels returns profile key + ordered kernel names', () => {
  const r = k.resolveKernelWheels(CFG, { vendor: 'NVIDIA', name: 'RTX 5090' })
  assert.strictEqual(r.profileKey, 'RTX_50')
  assert.deepStrictEqual(r.kernels, ['nunchaku_cu13', 'light2xv', 'gguf'])
})

// ── GGUF 1.0.11 override (docs/INSTALLATION.md target) ──
test('applyGgufOverride maps GGUF to full 1.0.11 URL by torch code, leaves others untouched', () => {
  const gguf = 'https://github.com/deepbeepmeep/kernels/releases/download/GGUF_Kernels/llamacpp_gguf_cuda-1.0.8+torch210cu13py311-cp311-cp311-win_amd64.whl'
  const win = k.applyGgufOverride('gguf', gguf, 'cu130')
  assert.ok(win.includes('llamacpp_gguf_cuda-1.0.11+torch210cu130py311'), 'GGUF win URL → 1.0.11 cu130')
  assert.ok(win.endsWith('-win_amd64.whl'), 'platform suffix preserved')
  const linux = k.applyGgufOverride('gguf', gguf, 'cu130')
  // linux source → linux suffix
  const linuxSrc = gguf.replace('win_amd64', 'linux_x86_64')
  assert.ok(k.applyGgufOverride('gguf', linuxSrc, 'cu130').endsWith('-linux_x86_64.whl'), 'linux suffix preserved')
  // cu128 legacy profile
  const legacy = 'https://github.com/deepbeepmeep/kernels/releases/download/GGUF_Kernels/llamacpp_gguf_cuda-1.0.8+torch271cu128py310-cp310-cp310-win_amd64.whl'
  assert.ok(k.applyGgufOverride('gguf', legacy, 'cu128').includes('1.0.11+torch271cu128py310'), 'cu128 → 1.0.11 cu128')
  assert.strictEqual(k.GGUF_TARGET_VERSION, '1.0.11')
  const nunchaku = 'https://github.com/nunchaku-ai/nunchaku/releases/download/v1.2.1/nunchaku-1.2.1+cu13.0torch2.10-cp311-cp311-win_amd64.whl'
  assert.strictEqual(k.applyGgufOverride('nunchaku_cu13', nunchaku, 'cu130'), nunchaku, 'non-GGUF kernel unchanged')
})

test('buildOverviewWheels reports GGUF configured version as 1.0.11 (doc target)', () => {
  const wheels = k.buildOverviewWheels(CFG, { vendor: 'NVIDIA', name: 'RTX 5090' }, 'win')
  const gguf = wheels.find(w => w.key === 'gguf')
  assert.ok(gguf.configured.startsWith('1.0.11'), 'overview shows doc-target 1.0.11, not the 1.0.8 profile pin')
})
