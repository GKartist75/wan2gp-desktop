/**
 * Tests for the VRAM/RAM Adjuster memory-profile service (services/memory-profile.js).
 * Pure, offline — no Electron, no network.
 * Run: node --test tests/
 */
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const mp = require('../services/memory-profile.js')

test('validateMemorySettings accepts a valid override set', () => {
  const r = mp.validateMemorySettings({ video_profile: 4, vram_safety_coefficient: 0.7, vae_config: 2, transformer_quantization: 'int8' })
  assert.strictEqual(r.ok, true)
})

test('validateMemorySettings rejects an out-of-range profile', () => {
  const r = mp.validateMemorySettings({ video_profile: 9 })
  assert.strictEqual(r.ok, false)
  assert.ok(r.errors.some((e) => e.field === 'video_profile'))
})

test('validateMemorySettings rejects an invalid coefficient', () => {
  assert.strictEqual(mp.validateMemorySettings({ vram_safety_coefficient: 1.5 }).ok, false)
  assert.strictEqual(mp.validateMemorySettings({ vram_safety_coefficient: 0 }).ok, false)
})

test('validateMemorySettings rejects an unknown quant', () => {
  assert.strictEqual(mp.validateMemorySettings({ transformer_quantization: 'bf16' }).ok, false)
})

test('validateMemorySettings ignores keys not in MEMORY_KEYS', () => {
  const r = mp.validateMemorySettings({ something_else: 'x', video_profile: 3 })
  assert.strictEqual(r.ok, true)
})

test('readMemorySettings returns null for unset keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w2gp-mp-'))
  const s = mp.readMemorySettings(dir, dir)
  assert.strictEqual(s.video_profile, null)
  assert.strictEqual(s.vram_safety_coefficient, null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('readMemorySettings reads existing config keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w2gp-mp-'))
  fs.writeFileSync(path.join(dir, 'wgp_config.json'), JSON.stringify({ video_profile: 2, vram_safety_coefficient: 0.8 }))
  const s = mp.readMemorySettings(dir, dir)
  assert.strictEqual(s.video_profile, 2)
  assert.strictEqual(s.vram_safety_coefficient, 0.8)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('applyMemorySettings merges without clobbering other keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w2gp-mp-'))
  fs.writeFileSync(path.join(dir, 'wgp_config.json'), JSON.stringify({ server_port: 7860, image_profile: 3 }))
  const r = mp.applyMemorySettings({ video_profile: 4, vram_safety_coefficient: 0.65 }, dir, dir)
  assert.strictEqual(r.success, true)
  assert.ok(r.applied.includes('video_profile'))
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'wgp_config.json'), 'utf8'))
  assert.strictEqual(cfg.server_port, 7860)            // untouched
  assert.strictEqual(cfg.video_profile, 4)
  assert.strictEqual(cfg.vram_safety_coefficient, 0.65)
  assert.strictEqual(cfg.image_profile, 3)             // untouched
  assert.strictEqual(cfg.services.auto_performance_applied, false)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('applyMemorySettings rejects invalid values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w2gp-mp-'))
  const r = mp.applyMemorySettings({ video_profile: 99 }, dir, dir)
  assert.strictEqual(r.success, false)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('applyMemorySettings writes to default path if no config exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w2gp-mp-'))
  const repo = path.join(dir, 'Wan2GP')
  const r = mp.applyMemorySettings({ video_profile: 5 }, repo, dir)
  assert.strictEqual(r.success, true)
  const cfg = JSON.parse(fs.readFileSync(path.join(repo, 'wgp_config.json'), 'utf8'))
  assert.strictEqual(cfg.video_profile, 5)
  fs.rmSync(dir, { recursive: true, force: true })
})
