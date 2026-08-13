/**
 * Tests for the Install Plan service (services/install-plan.js). Pure, offline.
 * Run: node --test tests/
 */
const { test } = require('node:test')
const assert = require('node:assert')
const p = require('../services/install-plan.js')

test('RTX 40 → CUDA 13 + PyTorch 2.10, no driver warn at R580+', () => {
  const plan = p.buildPlan({ vendor: 'NVIDIA', name: 'NVIDIA GeForce RTX 4070', vramGb: 12, ramGb: 32, capability: '8.9', driverVersion: '582.10' })
  assert.strictEqual(plan.cuda, 'CUDA 13 (cu130)')
  assert.strictEqual(plan.torch, 'PyTorch 2.10')
  assert.strictEqual(plan.driverWarning, '')
  assert.ok(plan.attention.includes('SageAttention'))
  assert.ok(plan.attention.includes('FlashAttention'))
})

test('RTX 40 with old driver < R580 → driver warning', () => {
  const plan = p.buildPlan({ vendor: 'NVIDIA', name: 'RTX 4080', vramGb: 16, ramGb: 64, capability: '8.9', driverVersion: '472.12' })
  assert.ok(plan.driverWarning.includes('R580'), 'warns about R580')
})

test('GTX 1060 → CUDA 12.8, no driver warn, legacy stack', () => {
  const plan = p.buildPlan({ vendor: 'NVIDIA', name: 'NVIDIA GeForce GTX 1060 6GB', vramGb: 6, ramGb: 16, capability: '6.1', driverVersion: '472.12' })
  assert.strictEqual(plan.cuda, 'CUDA 12.8')
  assert.strictEqual(plan.torch, 'PyTorch 2.7.1')
  assert.strictEqual(plan.driverWarning, '', 'GTX 10/16 exempt from R580 gate')
})

test('RTX 50 → includes Nunchaku + LightX2V', () => {
  const plan = p.buildPlan({ vendor: 'NVIDIA', name: 'RTX 5090', vramGb: 32, ramGb: 64, capability: '10.0' })
  assert.ok(plan.attention.includes('Nunchaku + GGUF'))
  assert.ok(plan.attention.includes('LightX2V'))
})

test('AMD Windows → ROCm + numpy pin', () => {
  const plan = p.buildPlan({ vendor: 'AMD', name: 'AMD Radeon RX 7900 XTX', vramGb: 24, ramGb: 64, capability: '11.0' })
  assert.strictEqual(plan.cuda, 'ROCm (TheRock)')
  assert.ok(plan.numpyPin.includes('1.26.4'), 'numpy pin present')
})

test('Apple → MPS, Intel → XPU', () => {
  const a = p.buildPlan({ vendor: 'APPLE', name: 'Apple M2', vramGb: 0, ramGb: 16 })
  assert.strictEqual(a.cuda, 'MPS (Metal)')
  const i = p.buildPlan({ vendor: 'INTEL', name: 'Arc A770', vramGb: 16, ramGb: 32 })
  assert.strictEqual(i.cuda, 'Intel XPU')
})

test('no GPU → CPU-only note', () => {
  const plan = p.buildPlan({ vendor: 'UNKNOWN', name: '', vramGb: 0, ramGb: 16 })
  assert.strictEqual(plan.cuda, 'CPU')
  assert.ok(plan.notes.some((n) => n.includes('CPU-only')))
})

test('ramTier / vramTier helpers', () => {
  assert.strictEqual(p.ramTier(64), 'high')
  assert.strictEqual(p.ramTier(32), 'low')
  assert.strictEqual(p.ramTier(16), 'very_low')
  assert.strictEqual(p.vramTier(24), 'high')
  assert.strictEqual(p.vramTier(16), 'low')
  assert.strictEqual(p.vramTier(8), 'tight')
})

test('diskCheck blocks when too low, warns when tight, ok when ample', () => {
  assert.strictEqual(p.diskCheck(2).ok, false)
  assert.ok(p.diskCheck(10).warn.includes('tight') || p.diskCheck(10).ok)
  assert.strictEqual(p.diskCheck(50).ok, true)
  assert.strictEqual(p.diskCheck(0).ok, true, 'unknown free space does not block')
})
