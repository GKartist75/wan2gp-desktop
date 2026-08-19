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
const CFG = {
  gpu_profiles: {
    RTX_20:  { kernels: ['nunchaku', 'gguf'] },
    RTX_30:  { kernels: ['nunchaku', 'gguf'] },
    RTX_40:  { kernels: ['nunchaku', 'gguf'] },
    RTX_50:  { kernels: ['nunchaku', 'lightx2v', 'gguf'] },
    GTX_10:  { kernels: [] },
    AMD_GFX110X: { kernels: [] },
    MPS:     { kernels: [] },
  },
  components: {
    kernels: {
      nunchaku:           { cmd: { win: 'https://x/nunchaku-1.2.1+cu130torch2.10-cp311-cp311-win_amd64.whl' } },
      gguf:               { cmd: { win: 'https://x/llamacpp_gguf_cuda-1.0.11-cp311-cp311-win_amd64.whl' } },
      lightx2v:           { cmd: { win: 'https://x/lightx2v-0.0.2-cp311-cp311-win_amd64.whl' } },
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

// ── buildOverviewWheels: profile-driven, real dist names ──
test('RTX 50 overview lists nunchaku + lightx2v + gguf with configured versions', () => {
  const wheels = k.buildOverviewWheels(CFG, { vendor: 'NVIDIA', name: 'RTX 5090' }, 'win')
  const keys = wheels.map(w => w.key)
  assert.deepStrictEqual(keys, ['nunchaku', 'lightx2v', 'gguf'])
  const gguf = wheels.find(w => w.key === 'gguf')
  assert.strictEqual(gguf.pipName, 'llamacpp_gguf_cuda', 'uses the CUDA kernel dist, not the `gguf` quant tool')
  assert.strictEqual(gguf.configured, '1.0.11')
  assert.strictEqual(gguf.label, 'GGUF (llamacpp)')
})

test('RTX 40 overview omits lightx2v (RTX 50-only NVFP4 kernel)', () => {
  const wheels = k.buildOverviewWheels(CFG, { vendor: 'NVIDIA', name: 'RTX 4080' }, 'win')
  assert.deepStrictEqual(wheels.map(w => w.key), ['nunchaku', 'gguf'])
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
  assert.deepStrictEqual(r.kernels, ['nunchaku', 'lightx2v', 'gguf'])
})
