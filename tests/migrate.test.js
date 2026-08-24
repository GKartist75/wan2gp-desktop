'use strict'
// Real migration test: simulates a legacy roaming AppData install (repo nested
// one level in, wgp_config.json with model paths) and proves the 3.0.1 move
// flattens the repo, rewrites model paths, and removes the roaming wrapper.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { getDirSize, mergeDirContents, flattenRepo, rewriteModelPaths, reconcileModelFolders, ensureRepoGit, cleanupLegacyRuntime } = require('../lib/migrate.js')

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

// Regression for issue #74: when the moved data lands in the data dir (C:\Wan2GP)
// but the model paths point at a SEPARATE models root (C:\Wan2GP-Models\…), the
// real ckpts/loras/outputs must be relocated to the configured destinations so
// Wan2GP finds them instead of re-downloading.
test('reconcileModelFolders: moves data-dir model folders to chosen destinations (#74)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'))
  try {
    const target = path.join(root, 'Wan2GP')         // migrated data dir
    fs.mkdirSync(target, { recursive: true })
    // Real model data that mergeDirContents dropped inside the data dir.
    fs.mkdirSync(path.join(target, 'ckpts'), { recursive: true })
    fs.writeFileSync(path.join(target, 'ckpts', 'model.safetensors'), Buffer.alloc(1024))
    fs.mkdirSync(path.join(target, 'loras'), { recursive: true })
    fs.writeFileSync(path.join(target, 'loras', 'lora.safetensors'), Buffer.alloc(512))
    fs.mkdirSync(path.join(target, 'outputs'), { recursive: true })

    const choices = {
      dataDir: target,
      ckpts: path.join(root, 'Wan2GP-Models', 'ckpts'),
      loras: path.join(root, 'Wan2GP-Models', 'loras'),
      output: path.join(root, 'Wan2GP-Models', 'outputs')
    }
    const touched = reconcileModelFolders(target, choices)
    assert.strictEqual(touched, true)
    // Bytes now live at the configured destinations.
    assert.ok(fs.existsSync(path.join(choices.ckpts, 'model.safetensors')))
    assert.ok(fs.existsSync(path.join(choices.loras, 'lora.safetensors')))
    assert.ok(fs.existsSync(path.join(choices.output)))
    // And are gone from the data dir.
    assert.ok(!fs.existsSync(path.join(target, 'ckpts')))
    assert.ok(!fs.existsSync(path.join(target, 'loras')))
    assert.ok(!fs.existsSync(path.join(target, 'outputs')))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('reconcileModelFolders: no-op when destinations already exist (idempotent)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'))
  try {
    const target = path.join(root, 'Wan2GP')
    fs.mkdirSync(target, { recursive: true })
    const dst = path.join(root, 'Wan2GP-Models', 'ckpts')
    fs.mkdirSync(dst, { recursive: true })   // destination already present
    fs.writeFileSync(path.join(dst, 'already.safetensors'), Buffer.alloc(10))
    const choices = { dataDir: target, ckpts: dst, loras: '', output: '' }
    const touched = reconcileModelFolders(target, choices)
    assert.strictEqual(touched, false)        // nothing moved; no clobber
    assert.ok(fs.existsSync(path.join(dst, 'already.safetensors')))
    // With no model folders in target at all, still a clean no-op.
    assert.strictEqual(reconcileModelFolders(target, { dataDir: target, ckpts: dst }), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// Regression for the "what stays in the old directory after migrate?" question:
// the repo's .git MUST travel with the move (git pull / updates depend on it),
// while the launcher's runtime state (.electron, boot.log — children of the data
// dir) gets moved too but is swept from the OLD location by cleanupLegacyRuntime.
test('migration leaves user repo intact and sweeps launcher runtime from old dir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'))
  try {
    const legacy = path.join(root, 'old', 'Wan2GP')
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(legacy, 'wgp.py'), '# entry')
    // git is real repo data -> must move with the repo
    fs.mkdirSync(path.join(legacy, '.git'), { recursive: true })
    fs.writeFileSync(path.join(legacy, '.git', 'HEAD'), 'ref: refs/heads/main')
    // launcher runtime/state (children of the data dir) -> moved, then swept old
    fs.mkdirSync(path.join(legacy, '.electron'), { recursive: true })
    fs.writeFileSync(path.join(legacy, '.electron', 'state.json'), '{}')
    fs.writeFileSync(path.join(legacy, 'boot.log'), 'launched')
    const target = path.join(root, 'Wan2GP')
    const ok = mergeDirContents(legacy, target)
    assert.strictEqual(ok, true)
    // .git arrived at target (fact: it must, for git pull/updates)
    assert.ok(fs.existsSync(path.join(target, '.git', 'HEAD')), '.git must travel with the repo')
    // launcher runtime moved into the new install (harmless; recreated next run)
    assert.ok(fs.existsSync(path.join(target, '.electron')), '.electron carried into new install')
    // Now sweep the OLD location: leftovers must be gone.
    cleanupLegacyRuntime(legacy)
    assert.ok(!fs.existsSync(path.join(legacy, 'boot.log')), 'boot.log cleaned from old dir')
    assert.ok(!fs.existsSync(path.join(legacy, '.electron')), '.electron cleaned from old dir')
    assert.ok(!fs.existsSync(path.join(path.dirname(legacy), '.electron')), '.electron sibling cleaned from old dir')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// ensureRepoGit must recover a missing .git when the generic merge skipped it
// (e.g. target already had a partial .git, or a cross-volume copy dropped it).
test('ensureRepoGit: lifts nested or legacy .git into the flat target repo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'))
  try {
    const target = path.join(root, 'Wan2GP')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'wgp.py'), '# entry')
    // Simulated doubled layout: the repo's .git landed nested.
    fs.mkdirSync(path.join(target, 'Wan2GP', '.git'), { recursive: true })
    fs.writeFileSync(path.join(target, 'Wan2GP', '.git', 'HEAD'), 'ref: refs/heads/nested')
    const legacy = path.join(root, 'old', 'Wan2GP')
    fs.mkdirSync(legacy, { recursive: true })
    fs.mkdirSync(path.join(legacy, '.git'), { recursive: true })
    fs.writeFileSync(path.join(legacy, '.git', 'HEAD'), 'ref: refs/heads/legacy')
    ensureRepoGit(target, legacy)
    // flat target now has a .git (nested lifted wins; legacy not duplicated)
    assert.ok(fs.existsSync(path.join(target, '.git', 'HEAD')), 'target repo has .git')
    assert.strictEqual(fs.readFileSync(path.join(target, '.git', 'HEAD'), 'utf8'), 'ref: refs/heads/nested')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// Regression for issues #76 / #73: the INITIAL INSTALL clone path (main.js
// mergeDir -> moveDirAtomic) merges %TEMP%/wan2gp-clone-* into the target install
// dir. When that dir is on a different drive than %TEMP%, rename throws EXDEV.
// moveDirAtomic must fall back to copy + remove so the clone step succeeds
// cross-drive. We load both functions from main.js and simulate EXDEV.
test('mergeDir/install clone: cross-drive (EXDEV) falls back to copy, no throw (#76/#73)', () => {
  const fs2 = require('fs')
  const src = fs2.readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8')
  // Brace-match a function starting at `startIdx` so we never over/under-grab.
  function extractFn(startIdx) {
    let i = src.indexOf('{', startIdx), depth = 0
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(startIdx, i + 1) }
    }
    return ''
  }
  const mdaStart = src.indexOf('function moveDirAtomic')
  const mdStart = src.indexOf('function mergeDir')
  const code = extractFn(mdaStart) + '\n' + extractFn(mdStart) + '\nreturn { moveDirAtomic, mergeDir };'
  const fn = new Function('fs', 'path', 'logError', code)
  const { mergeDir } = fn(fs2, require('path'), () => {})

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'))
  try {
    const srcDir = path.join(root, 'wan2gp-clone-123')
    const dstDir = path.join(root, 'Wan2GP')
    fs2.mkdirSync(path.join(srcDir, '.git'), { recursive: true })
    fs2.writeFileSync(path.join(srcDir, '.git', 'config'), 'gitdir')
    fs2.writeFileSync(path.join(srcDir, 'wgp.py'), '# entry')
    fs2.mkdirSync(path.join(srcDir, 'sub'), { recursive: true })
    fs2.writeFileSync(path.join(srcDir, 'sub', 'x.txt'), 'data')

    // Force every rename to throw EXDEV (cross-drive simulation).
    const origRename = fs2.renameSync
    fs2.renameSync = () => {
      const e = new Error('EXDEV: cross-device link not permitted')
      e.code = 'EXDEV'
      throw e
    }
    let threw = null
    try { mergeDir(srcDir, dstDir) } catch (e) { threw = e }
    fs2.renameSync = origRename
    assert.strictEqual(threw, null, 'mergeDir should not throw on EXDEV')
    assert.ok(fs2.existsSync(path.join(dstDir, 'wgp.py')), 'entry copied')
    assert.ok(fs2.existsSync(path.join(dstDir, '.git', 'config')), '.git copied')
    assert.ok(fs2.existsSync(path.join(dstDir, 'sub', 'x.txt')), 'nested file copied')
    // Source content moved into destination (copy+remove fallback consumed children;
    // the empty top dir is removed by the caller at main.js:1211).
    assert.ok(fs2.readdirSync(srcDir).length === 0, 'temp clone emptied after merge')
  } finally {
    fs2.rmSync(root, { recursive: true, force: true })
  }
})
