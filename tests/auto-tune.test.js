/**
 * Tests for the auto-tune recommendation engine (2026-08 rework).
 * Run: npm test  (node --test tests/)
 *
 * Covers the Wan2GP-aligned tier matrix, the audio-profile rule,
 * calibrated vram_safety_coefficient, the always-Auto VAE recommendation and
 * the no-CUDA fallback. detect() is async and requires a GPU — kept out of
 * unit tests.
 */
const { test } = require('node:test')
const assert = require('node:assert')
const { recommend, apply, computePerJobCoefficient, audioProfile, findWgpConfig, ramTierFor, PROFILE_MATRIX } = require('../services/auto-tune')

// ── Profile matrix: VRAM tier × RAM tier → profile ──
// Imported from the module itself (single source of truth) so the test can
// never silently validate a stale copy if the matrix changes.
const MATRIX = PROFILE_MATRIX

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

// ── RAM tier boundary tolerance ──
// Real "32GB"/"64GB" kits report 31.4-31.9 / 63.5-63.9 GiB to the OS
// (BIOS/GFX reservations). They must not be demoted to a worse tier —
// that's what produced "recommends P5 on a 5080 + 32GB" reports.
test('ramTierFor() treats real-world 32GB kits as low tier', () => {
  assert.strictEqual(ramTierFor(31.9), 'low')
  assert.strictEqual(ramTierFor(31.5), 'low')
  assert.strictEqual(ramTierFor(32), 'low')
  assert.strictEqual(ramTierFor(34), 'low')
})

test('ramTierFor() treats real-world 64GB kits as high tier', () => {
  assert.strictEqual(ramTierFor(63.9), 'high')
  assert.strictEqual(ramTierFor(63.5), 'high')
  assert.strictEqual(ramTierFor(64), 'high')
})

test('ramTierFor() only demotes genuinely small RAM', () => {
  assert.strictEqual(ramTierFor(31.4), 'very_low')
  assert.strictEqual(ramTierFor(16), 'very_low')
  assert.strictEqual(ramTierFor(63.4), 'low')
})

test('32GB RAM detected a hair under the line still lands on P4, not P5', () => {
  const r = recommend({ vram_tier: 'low', ram_tier: ramTierFor(31.8), gpu_vram_gb: 16 })
  assert.strictEqual(r.video_profile, 4)
  assert.strictEqual(r.audio_profile, 3)
})

test('recommend() falls back to profile 4 on unknown tiers', () => {
  const r = recommend({ vram_tier: 'bogus', ram_tier: 'bogus', gpu_vram_gb: 0 })
  assert.strictEqual(r.video_profile, 4)
})

// ── Failsafe preference (P5 forced regardless of tier) ──
test('failsafe forces P5 + 0.60 coeff + VAE-auto on any hardware', () => {
  // A high-end machine that still wants max compatibility
  const r = recommend({ vram_tier: 'high', ram_tier: 'high', gpu_vram_gb: 24 }, { failsafe: true })
  assert.strictEqual(r.video_profile, 5)
  assert.strictEqual(r.image_profile, 5)
  assert.strictEqual(r.vram_safety_coefficient, 0.60)
  assert.strictEqual(r.vae_config, 0)
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

test('Detect leaves VAE on AUTO (0) for every normal tier', () => {
  // The runtime picks tiling from actual VRAM (≥24GB→full, ≥8GB→256, else 128);
  // Detect must not force a fixed tiling that wastes VRAM or adds banding.
  for (const vramTier of ['low', 'tight', 'high']) {
    const r = recommend({ vram_tier: vramTier, ram_tier: 'high', gpu_vram_gb: 24 })
    assert.strictEqual(r.vae_config, 0, `VAE should be AUTO (0) for tier ${vramTier}`)
  }
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

// ── VAE config ──
test('vae_config is always Auto (0) — runtime decides tiling by actual headroom', () => {
  assert.strictEqual(recommend({ vram_tier: 'high', ram_tier: 'high', gpu_vram_gb: 24 }).vae_config, 0)
  assert.strictEqual(recommend({ vram_tier: 'low', ram_tier: 'low', gpu_vram_gb: 16 }).vae_config, 0)
  assert.strictEqual(recommend({ vram_tier: 'tight', ram_tier: 'low', gpu_vram_gb: 8 }).vae_config, 0)
  // Failsafe + no-CUDA fallback also advise Auto
  assert.strictEqual(recommend({ vram_tier: 'high', ram_tier: 'high', gpu_vram_gb: 24 }, { failsafe: true }).vae_config, 0)
  assert.strictEqual(recommend({ cuda_available: false, vram_tier: 'none', ram_tier: 'very_low', gpu_vram_gb: 0 }).vae_config, 0)
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
  assert.strictEqual(r.vae_config, 0)
  assert.match(r._recommendation_label, /unavailable/i)
})

test('recommend(null/undefined) — failed detection — returns the same conservative fallback', () => {
  for (const bad of [null, undefined]) {
    const r = recommend(bad)
    assert.strictEqual(r.video_profile, 4.5)
    assert.strictEqual(r.vae_config, 0)
    assert.match(r._recommendation_label, /unavailable/i)
  }
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

// ── apply() writes to wgp_config.json ──
test('apply() writes the recommended keys and preserves unrelated ones', () => {
  const os = require('os')
  const path = require('path')
  const fs = require('fs')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autotune-apply-'))
  try {
    const repo = path.join(tmp, 'repo')
    fs.mkdirSync(repo, { recursive: true })
    fs.writeFileSync(path.join(repo, 'wgp_config.json'), JSON.stringify({ unrelated_key: 'keep-me', video_profile: 5 }, null, 2))
    const rec = recommend({ vram_tier: 'low', ram_tier: 'low', gpu_vram_gb: 16 })
    const result = apply(rec, repo, tmp)
    assert.strictEqual(result.success, true)
    assert.ok(result.applied.includes('vae_config'))
    const cfg = JSON.parse(fs.readFileSync(path.join(repo, 'wgp_config.json'), 'utf8'))
    assert.strictEqual(cfg.video_profile, 4)
    assert.strictEqual(cfg.vae_config, 0)
    assert.strictEqual(cfg.unrelated_key, 'keep-me', 'unrelated config keys must survive')
    assert.strictEqual(cfg.services.auto_performance_applied, true)
    // No .tmp residue from the atomic write
    assert.strictEqual(fs.existsSync(path.join(repo, 'wgp_config.json.tmp')), false)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('apply() with empty settings is a no-op (unchanged, no file touch)', () => {
  const os = require('os')
  const path = require('path')
  const fs = require('fs')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autotune-apply-'))
  try {
    const repo = path.join(tmp, 'repo')
    fs.mkdirSync(repo, { recursive: true })
    fs.writeFileSync(path.join(repo, 'wgp_config.json'), JSON.stringify({ keep: 1 }, null, 2))
    const result = apply({}, repo, tmp)
    assert.strictEqual(result.success, true)
    assert.strictEqual(result.unchanged, true)
    const cfg = JSON.parse(fs.readFileSync(path.join(repo, 'wgp_config.json'), 'utf8'))
    assert.deepStrictEqual(cfg, { keep: 1 })
    assert.ok(!('services' in cfg), 'no-op must not stamp the auto_performance marker')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})