/**
 * Tests for the auto-tune recommendation engine (2026-08 rework).
 * Run: npm test  (node --test tests/)
 *
 * Covers the Wan2GP-aligned tier matrix, the audio-profile rule,
 * calibrated vram_safety_coefficient, VAE config tiers and the no-CUDA
 * fallback. detect() is async and requires a GPU — kept out of unit tests.
 */
const { test } = require('node:test')
const assert = require('node:assert')
const { recommend, computePerJobCoefficient, audioProfile, findWgpConfig } = require('../services/auto-tune')

// ── Profile matrix: VRAM tier × RAM tier → profile ──
// Realigned to Wan2GP's own profile table (wgp.py memory_profile_choices) and
// Wan2GP's tiers: high ≥24GB / low 12–23GB / tight <12GB VRAM;
// high ≥64GB / low ≥32GB / very_low <32GB RAM.
const MATRIX = {
  high:  { high: 1, low: 3, very_low: 3.5 }, // ≥24GB VRAM
  low:   { high: 2, low: 4, very_low: 5 },   // 12–23GB VRAM
  tight: { high: 4, low: 4.5, very_low: 5 }  // <12GB VRAM
}

test('recommend() maps every VRAM×RAM tier to the Wan2GP-aligned profile', () => {
  for (const [vramTier, ramRows] of Object.entries(MATRIX)) {
    for (const [ramTier, expectedProfile] of Object.entries(ramRows)) {
      const r = recommend({ vram_tier: vramTier, ram_tier: ramTier, gpu_vram_gb: 24 })
      assert.strictEqual(r.video_profile, expectedProfile,
        `vram=${vramTier} ram=${ramTier} → expected ${expectedProfile}, got ${r.video_profile}`)
      assert.strictEqual(r.image_profile, expectedProfile, 'image follows video profile')
    }
  }
})

test('12GB VRAM + 32GB RAM lands on P4, not P5 (the old downgrade bug)', () => {
  const r = recommend({ vram_tier: 'low', ram_tier: 'low', gpu_vram_gb: 12 })
  assert.strictEqual(r.video_profile, 4)
})

test('recommend() falls back to profile 4 on unknown tiers', () => {
  const r = recommend({ vram_tier: 'bogus', ram_tier: 'bogus', gpu_vram_gb: 0 })
  assert.strictEqual(r.video_profile, 4)
})

// ── Failsafe preference (P5 forced regardless of tier) ──
test('failsafe forces P5 + 0.60 coeff + VAE-3 on any hardware', () => {
  // A high-end machine that still wants max compatibility
  const r = recommend({ vram_tier: 'high', ram_tier: 'high', gpu_vram_gb: 24 }, { failsafe: true })
  assert.strictEqual(r.video_profile, 5)
  assert.strictEqual(r.image_profile, 5)
  assert.strictEqual(r.vram_safety_coefficient, 0.60)
  assert.strictEqual(r.vae_config, 3)
  assert.strictEqual(r.transformer_quantization, 'int8')
  assert.match(r._recommendation_label, /Failsafe/)
  // Audio still honors the ≥12GB LM-decoder rule, not the failsafe profile
  assert.strictEqual(r.audio_profile, 3)
})

test('failsafe on a tight card keeps audio inheriting video (P5)', () => {
  const r = recommend({ vram_tier: 'tight', ram_tier: 'low', gpu_vram_gb: 10 }, { failsafe: true })
  assert.strictEqual(r.video_profile, 5)
  assert.strictEqual(r.audio_profile, 5)
})

test('no failsafe flag → unchanged matrix behavior', () => {
  const r = recommend({ vram_tier: 'tight', ram_tier: 'low', gpu_vram_gb: 10 })
  assert.strictEqual(r.video_profile, 4.5)
  assert.strictEqual(r.vram_safety_coefficient, 0.70)
})

// ── Audio profile rule (wan2gp fast LM decoder gate) ──
test('audio_profile is 3 for ≥12GB cards whose video profile is not 1 or 3', () => {
  // 12–23GB video P4/P4.5/P5 → audio must be 3 (engages vllm/cg LM decoders)
  assert.strictEqual(audioProfile(12, 4), 3)
  assert.strictEqual(audioProfile(16, 4.5), 3)
  assert.strictEqual(audioProfile(24, 5), 3)
  // P1/P3 already use the fast decoders — audio inherits the video profile
  assert.strictEqual(audioProfile(24, 1), 1)
  assert.strictEqual(audioProfile(24, 3), 3)
  // <12GB: LM stack wouldn't fit — inherit the video profile
  assert.strictEqual(audioProfile(8, 5), 5)
  assert.strictEqual(audioProfile(8, 4), 4)
})

test('recommend() audio_profile honors the rule for typical machines', () => {
  const r = recommend({ vram_tier: 'low', ram_tier: 'low', gpu_vram_gb: 16 })
  assert.strictEqual(r.video_profile, 4)
  assert.strictEqual(r.audio_profile, 3)
  const p1 = recommend({ vram_tier: 'high', ram_tier: 'high', gpu_vram_gb: 24 })
  assert.strictEqual(p1.video_profile, 1)
  assert.strictEqual(p1.audio_profile, 1)
})

// ── VRAM safety coefficient (calibrated flat policy) ──
test('vram_safety_coefficient: 0.80 for ≥12GB VRAM, 0.70 for <12GB', () => {
  assert.strictEqual(recommend({ vram_tier: 'high', ram_tier: 'high', gpu_vram_gb: 24 }).vram_safety_coefficient, 0.80)
  assert.strictEqual(recommend({ vram_tier: 'low', ram_tier: 'low', gpu_vram_gb: 12 }).vram_safety_coefficient, 0.80)
  assert.strictEqual(recommend({ vram_tier: 'tight', ram_tier: 'low', gpu_vram_gb: 8 }).vram_safety_coefficient, 0.70)
})

// ── VAE config tiers ──
test('vae_config: 1 (untiled) for ≥24GB, 0 (auto) for 12–23GB, 3 (aggressive) for tight', () => {
  assert.strictEqual(recommend({ vram_tier: 'high', ram_tier: 'high', gpu_vram_gb: 24 }).vae_config, 1)
  assert.strictEqual(recommend({ vram_tier: 'low', ram_tier: 'low', gpu_vram_gb: 16 }).vae_config, 0)
  assert.strictEqual(recommend({ vram_tier: 'tight', ram_tier: 'low', gpu_vram_gb: 8 }).vae_config, 3)
})

test('recommend() always returns int8 quantization', () => {
  const r = recommend({ vram_tier: 'low', ram_tier: 'low', gpu_vram_gb: 12 })
  assert.strictEqual(r.transformer_quantization, 'int8')
})

test('recommend() attaches a human-readable label + reason', () => {
  const r = recommend({ vram_tier: 'high', ram_tier: 'high', gpu_vram_gb: 24 })
  assert.ok(typeof r._recommendation_label === 'string' && r._recommendation_label.length > 0)
  assert.ok(typeof r._recommendation_reason === 'string' && r._recommendation_reason.length > 0)
})

// ── No-CUDA fallback ──
test('recommend() without CUDA returns the labeled conservative fallback', () => {
  const r = recommend({ cuda_available: false, vram_tier: 'none', ram_tier: 'very_low', gpu_vram_gb: 0 })
  assert.strictEqual(r.video_profile, 4.5)
  assert.strictEqual(r.audio_profile, 4.5)
  assert.strictEqual(r.vram_safety_coefficient, 0.70)
  assert.strictEqual(r.vae_config, 3)
  assert.match(r._recommendation_label, /unavailable/i)
})

// ── Config discovery order ──
test('findWgpConfig prefers repoDir over dataDir over cwd', () => {
  const os = require('os')
  const path = require('path')
  const fs = require('fs')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autotune-'))
  try {
    const repo = path.join(tmp, 'repo')
    const data = path.join(tmp, 'data')
    fs.mkdirSync(repo, { recursive: true })
    fs.mkdirSync(path.join(data, 'Wan2GP'), { recursive: true })
    // Only dataDir/Wan2GP exists → picked even though cwd has one
    fs.writeFileSync(path.join(repo, 'wgp_config.json'), '{}')
    assert.strictEqual(findWgpConfig(repo, data), path.join(repo, 'wgp_config.json'))
    fs.unlinkSync(path.join(repo, 'wgp_config.json'))
    fs.writeFileSync(path.join(data, 'Wan2GP', 'wgp_config.json'), '{}')
    assert.strictEqual(findWgpConfig(repo, data), path.join(data, 'Wan2GP', 'wgp_config.json'))
    // Nothing exists → repo dir is the write target (never cwd)
    fs.unlinkSync(path.join(data, 'Wan2GP', 'wgp_config.json'))
    assert.strictEqual(findWgpConfig(repo, data), path.join(repo, 'wgp_config.json'))
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// ── Per-job coefficient helpers ──
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