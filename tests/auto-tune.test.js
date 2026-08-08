/**
 * Smoke tests for the auto-tune recommendation engine.
 * Run: node --test tests/
 */
const { test } = require('node:test')
const assert = require('node:assert')
const { recommend, computePerJobCoefficient } = require('../services/auto-tune')

// ── Profile matrix: VRAM tier × RAM tier → profile ──
// (mirrors the README table and services/auto-tune.js PROFILE_MATRIX)
const MATRIX = {
  very_high: { high: 1, mid: 3, low: 3.5 }, // ≥24GB VRAM
  high:      { high: 2, mid: 4, low: 4.5 }, // ≥16GB VRAM
  mid:       { high: 4, mid: 5, low: 5 },   // ≥10GB VRAM
  low:       { high: 5, mid: 5, low: 5 }    // <10GB VRAM
}

test('recommend() maps every VRAM×RAM tier to the documented profile', () => {
  for (const [vramTier, ramRows] of Object.entries(MATRIX)) {
    for (const [ramTier, expectedProfile] of Object.entries(ramRows)) {
      const r = recommend({ vram_tier: vramTier, ram_tier: ramTier, gpu_vram_gb: 24 })
      assert.strictEqual(r.video_profile, expectedProfile,
        `vram=${vramTier} ram=${ramTier} → expected ${expectedProfile}, got ${r.video_profile}`)
      // image/audio follow the video profile
      assert.strictEqual(r.image_profile, expectedProfile)
      assert.strictEqual(r.audio_profile, expectedProfile)
    }
  }
})

test('recommend() falls back to profile 4 on unknown tiers', () => {
  const r = recommend({ vram_tier: 'bogus', ram_tier: 'bogus', gpu_vram_gb: 0 })
  assert.strictEqual(r.video_profile, 4)
})

test('vram_safety_coefficient decreases as profile gets more conservative', () => {
  // Documented coefficient table (services/auto-tune.js vramCoefficientForProfile)
  const expected = { 1: 0.80, 2: 0.75, 3: 0.70, 3.5: 0.65, 4: 0.60, 4.5: 0.55, 5: 0.50 }
  // Find one (vram_tier, ram_tier) combo that yields each profile, then check its coeff.
  const tierToProfile = []
  for (const [vt, rows] of Object.entries(MATRIX)) {
    for (const [rt, p] of Object.entries(rows)) tierToProfile.push([vt, rt, p])
  }
  for (const p of Object.keys(expected)) {
    const combo = tierToProfile.find(([, , pp]) => pp === Number(p))
    if (!combo) continue
    const r = recommend({ vram_tier: combo[0], ram_tier: combo[1], gpu_vram_gb: 24 })
    assert.strictEqual(r.vram_safety_coefficient, expected[p], `profile ${p} coeff`)
  }
})

test('recommend() always returns int8 quantization and vae_config 0', () => {
  const r = recommend({ vram_tier: 'mid', ram_tier: 'low', gpu_vram_gb: 12 })
  assert.strictEqual(r.transformer_quantization, 'int8')
  assert.strictEqual(r.vae_config, 0)
})

test('recommend() attaches a human-readable label + reason', () => {
  const r = recommend({ vram_tier: 'very_high', ram_tier: 'high', gpu_vram_gb: 24 })
  assert.ok(typeof r._recommendation_label === 'string' && r._recommendation_label.length > 0)
  assert.ok(typeof r._recommendation_reason === 'string' && r._recommendation_reason.length > 0)
})

test('computePerJobCoefficient: video is the most conservative, audio the least', () => {
  const video = computePerJobCoefficient(0.60, 'video')
  const image = computePerJobCoefficient(0.60, 'image')
  const audio = computePerJobCoefficient(0.60, 'audio')
  assert.ok(video <= image, 'video coeff must be ≤ image coeff')
  assert.ok(image <= audio, 'image coeff must be ≤ audio coeff')
  assert.ok(video > 0 && video <= 0.60)
})

test('computePerJobCoefficient returns base coefficient for unknown job types', () => {
  const r = computePerJobCoefficient(0.60, 'unknown-job')
  assert.strictEqual(r, 0.60)
})

test('recommend() handles a real-world mid-range machine (12GB VRAM, 32GB RAM)', () => {
  const r = recommend({ vram_tier: 'mid', ram_tier: 'mid', gpu_vram_gb: 12 })
  // mid×mid → 5 per the matrix (README: mid VRAM + mid RAM → P5)
  assert.strictEqual(r.video_profile, 5)
})
