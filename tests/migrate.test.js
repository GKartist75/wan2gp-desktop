'use strict'
// Real migration test: simulates a legacy roaming AppData install (repo nested
// one level in, wgp_config.json with model paths) and proves the 3.0.1 move
// flattens the repo, rewrites model paths, and removes the roaming wrapper.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { getDirSize, mergeDirContents, flattenRepo, rewriteModelPaths } = require('../lib/migrate.js')

function makeLegacyRoaming(root) {
  // Mirror: AppData\Roaming\wan2gp-desktop\Wan2GP\<repo with wgp.py + config>
  const legacy = path.join(root, 'Roaming', 'wan2gp-desktop', 'Wan2GP')
  fs.mkdirSync(legacy, { recursive: true })
  const repo = path.join(legacy, 'Wan2GP')
  fs.mkdirSync(repo, { recursive: true })
  fs.writeFileSync(path.join(repo, 'wgp.py'), '# wan2gp entry')
  fs.writeFileSync(path.join(repo, 'wgp_config.json'),
    JSON.stringify({ checkpoints_paths: ['C:\\Users\\x\\AppData\\Roaming\\wan2gp-desktop\\Wan2GP\\ckpts', '.'], loras_root: 'C:\\Users\\x\\AppData\\Roaming\\wan2gp-desktop\\Wan2GP\\loras', save_path: 'OLD' }))
  // A stray data file at the legacy data-dir root (desktop-config.json)
  fs.writeFileSync(path.join(legacy, 'desktop-config.json'), '{}')
  return legacy
}

test('fast path: legacy roaming → C:\\Wan2GP (flat repo, config rewritten, wrapper removed)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'))
  try {
    const legacy = makeLegacyRoaming(root)
    const target = path.join(root, 'Wan2GP')
    const progressCalls = []
    const ok = mergeDirContents(legacy, target, (p) => progressCalls.push(p))
    assert.strictEqual(ok, true)
    flattenRepo(target)
    rewriteModelPaths(target, {
      dataDir: target,
      ckpts: 'C:\\Wan2GP-Models\\ckpts',
      loras: 'C:\\Wan2GP-Models\\loras',
      output: 'C:\\Wan2GP-Models\\outputs'
    })
    // 1. Repo is flat (no Wan2GP\Wan2GP double-nest); wgp.py at target root.
    assert.ok(fs.existsSync(path.join(target, 'wgp.py')), 'repo should be flat at target/wgp.py')
    assert.ok(!fs.existsSync(path.join(target, 'Wan2GP', 'wgp.py')), 'no doubled Wan2GP/Wan2GP')
    // 2. Model paths rewritten to the chosen non-roaming locations.
    const cfg = JSON.parse(fs.readFileSync(path.join(target, 'wgp_config.json'), 'utf8'))
    assert.deepStrictEqual(cfg.checkpoints_paths, ['C:\\Wan2GP-Models\\ckpts', '.'])
    assert.strictEqual(cfg.loras_root, 'C:\\Wan2GP-Models\\loras')
    assert.strictEqual(cfg.save_path, 'C:\\Wan2GP-Models\\outputs')
    assert.strictEqual(cfg.image_save_path, 'C:\\Wan2GP-Models\\outputs')
    // 3. Legacy roaming wrapper removed (best-effort empty cleanup).
    assert.ok(!fs.existsSync(legacy), 'legacy leaf removed')
    // 4. Fast path never emits progress (instant rename).
    assert.strictEqual(progressCalls.length, 0, 'no progress on instant rename path')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('slow path: copy fallback reports byte progress and still migrates', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'))
  try {
    const legacy = makeLegacyRoaming(root)
    const target = path.join(root, 'Wan2GP')
    // Force the copy fallback by making rename refuse (cross-volume simulation).
    const origRename = fs.renameSync
    fs.renameSync = () => { throw new Error('EXDEV simulated') }
    const progressCalls = []
    const ok = mergeDirContents(legacy, target, (p) => progressCalls.push(p))
    fs.renameSync = origRename
    assert.strictEqual(ok, true)
    // The whole legacy tree relocated into target.
    assert.ok(fs.existsSync(path.join(target, 'Wan2GP', 'wgp.py')), 'repo copied into target')
    assert.ok(fs.existsSync(path.join(target, 'desktop-config.json')), 'stray root file copied')
    // Progress was reported and ended below 100 (capped at 99 on the copy path).
    assert.ok(progressCalls.length > 0, 'progress should be emitted on copy path')
    assert.ok(progressCalls.every(p => p >= 0 && p <= 99), 'progress within [0,99]')
    assert.ok(progressCalls[progressCalls.length - 1] >= progressCalls[0], 'progress is non-decreasing')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('rewriteModelPaths: picks nested config when repo not flattened', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'))
  try {
    const target = path.join(root, 'Wan2GP')
    const nested = path.join(target, 'Wan2GP')
    fs.mkdirSync(nested, { recursive: true })
    fs.writeFileSync(path.join(nested, 'wgp_config.json'), JSON.stringify({ save_path: 'OLD' }))
    rewriteModelPaths(target, { ckpts: 'X:\\ck', loras: 'X:\\lor', output: 'X:\\out' })
    const cfg = JSON.parse(fs.readFileSync(path.join(nested, 'wgp_config.json'), 'utf8'))
    assert.strictEqual(cfg.loras_root, 'X:\\lor')
    assert.strictEqual(cfg.save_path, 'X:\\out')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('getDirSize: sums file bytes including nested dirs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'))
  try {
    fs.mkdirSync(path.join(root, 'sub'), { recursive: true })
    fs.writeFileSync(path.join(root, 'a.bin'), Buffer.alloc(100))
    fs.writeFileSync(path.join(root, 'sub', 'b.bin'), Buffer.alloc(250))
    assert.strictEqual(getDirSize(root), 350)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
