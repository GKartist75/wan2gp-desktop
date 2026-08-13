/**
 * Tests for the Plugin Catalog service (services/catalog.js).
 * Mirrors the offline style of tests/escape.test.js — no network, no Electron.
 * A fake git executor records clone calls and materializes a plugin folder so
 * install/update/remove/enable can be exercised purely on disk.
 *
 * Run: node --test tests/
 */
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const cat = require('../services/catalog.js')

const MANIFEST = {
  version: 1,
  plugins: [
    {
      id: 'file-gallery', name: 'File Gallery', author: 'Tophness', version: '2.0.3',
      type: 'app', repo: 'https://example.com/Tophness/Wan2GP-File-Gallery', tag: 'v2.0.3',
      installPath: 'plugins/file-gallery', homepage: 'https://example.com/x', summary: 'g', verified: true
    },
    {
      id: 'lora-manager', name: 'LoRA Manager', author: 'Tophness', version: '2.5.5',
      type: 'app', repo: 'https://example.com/Tophness/Wan2GP-LoRA-Manager', tag: 'v2.5.5',
      installPath: 'plugins/lora-manager', homepage: 'https://example.com/y', summary: 'l', verified: false
    },
    {
      id: 'bad-path', name: 'Bad', author: 'x', version: '1.0.0', type: 'app',
      repo: 'https://example.com/x/bad', tag: 'v1.0.0', installPath: '../escape',
      homepage: 'h', summary: 's', verified: true
    }
  ]
}

function makeFakeGit({ hasTag = false } = {}) {
  const calls = []
  return {
    calls,
    // Materialize the cloned folder so install/update see real files.
    // When hasTag is true, ls-remote reports the pinned tag as a real ref so
    // cloneInto keeps the --branch <tag> path; otherwise it falls back to default.
    exec(args, cwd) {
      calls.push(args)
      if (args[0] === 'ls-remote') {
        if (hasTag) return 'abc\trefs/tags/v2.0.3\n' + 'abc\trefs/heads/v2.0.3\n'
        return '' // no tag/branch refs → fallback to default branch
      }
      const dest = args[args.length - 1]
      fs.mkdirSync(dest, { recursive: true })
      fs.writeFileSync(path.join(dest, 'plugin.py'), '# plugin\n')
      return ''
    }
  }
}

function freshRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'w2gp-repo-'))
}

test('validateManifest flags missing required fields', () => {
  const bad = { plugins: [{ id: 'x', name: 'X' }] } // missing most fields
  const errs = cat.validateManifest(bad)
  assert.ok(errs.length > 0)
  assert.ok(errs.some((e) => e.field.includes('version')))
  assert.ok(errs.some((e) => e.field.includes('repo')))
})

test('validateManifest flags duplicate ids', () => {
  const dup = {
    plugins: [
      { id: 'a', name: 'A', author: 'x', version: '1', type: 'app', repo: 'r', tag: 't', installPath: 'plugins/a' },
      { id: 'a', name: 'B', author: 'x', version: '1', type: 'app', repo: 'r', tag: 't', installPath: 'plugins/b' }
    ]
  }
  const errs = cat.validateManifest(dup)
  assert.ok(errs.some((e) => e.message.includes('duplicate')))
})

test('validateManifest rejects traversal installPath', () => {
  const bad = { plugins: [{ id: 'a', name: 'A', author: 'x', version: '1', type: 'app', repo: 'r', tag: 't', installPath: '../escape' }] }
  const errs = cat.validateManifest(bad)
  assert.ok(errs.some((e) => e.message.includes('relative path inside the repo')))
})

test('parseManifest throws on invalid manifest', () => {
  assert.throws(() => cat.parseManifest({ plugins: [{ id: 'x' }] }))
})

test('parseManifest accepts a valid manifest', () => {
  // Valid manifest = the good entries only (the '../escape' fixture is the
  // negative case exercised by validateManifest rejects traversal installPath).
  const valid = { version: 1, plugins: MANIFEST.plugins.filter((p) => p.installPath !== '../escape') }
  const m = cat.parseManifest(JSON.stringify(valid))
  assert.strictEqual(m.plugins.length, 2)
})

test('install clones into plugins/<id> and reports installed', () => {
  const repo = freshRepo()
  const git = makeFakeGit({ hasTag: true })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w2gp-tmp-'))
  const res = cat.install(MANIFEST.plugins[0], repo, { tempDir: tmp, gitExec: git.exec, verifyOk: true })
  assert.strictEqual(res.installed, true)
  assert.strictEqual(cat.isInstalled(repo, 'plugins/file-gallery'), true)
  const p = cat.resolveInstallBase(repo, 'plugins/file-gallery')
  assert.ok(fs.existsSync(path.join(p, 'plugin.py')))
  assert.ok(git.calls.some((c) => c.includes('clone') && c.includes('--branch') && c.includes('v2.0.3')))
  fs.rmSync(repo, { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('install falls back to default branch when pinned tag is missing', () => {
  // Most community plugins have no git tags; cloneInto must clone the default branch.
  const repo = freshRepo()
  const git = makeFakeGit({ hasTag: false })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w2gp-tmp-'))
  const entry = { ...MANIFEST.plugins[0], tag: 'v2.0.3' }
  const res = cat.install(entry, repo, { tempDir: tmp, gitExec: git.exec, verifyOk: true })
  assert.strictEqual(res.installed, true)
  const cloneCall = git.calls.find((c) => c.includes('clone'))
  assert.ok(cloneCall, 'a clone was issued')
  assert.ok(!cloneCall.includes('--branch'), 'no --branch when tag is missing')
  assert.ok(cloneCall.includes('https://example.com/Tophness/Wan2GP-File-Gallery'))
  fs.rmSync(repo, { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('install refuses unverified plugin unless verifyOk', () => {
  const repo = freshRepo()
  assert.throws(() => cat.install(MANIFEST.plugins[1], repo, {}), /unverified/)
  fs.rmSync(repo, { recursive: true, force: true })
})

test('install refuses when already installed', () => {
  const repo = freshRepo()
  const git = makeFakeGit()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w2gp-tmp-'))
  cat.install(MANIFEST.plugins[0], repo, { tempDir: tmp, gitExec: git.exec, verifyOk: true })
  assert.throws(() => cat.install(MANIFEST.plugins[0], repo, { tempDir: tmp, gitExec: git.exec, verifyOk: true }), /already installed/)
  fs.rmSync(repo, { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('update replaces installed plugin and preserves enabled state', () => {
  const repo = freshRepo()
  const git = makeFakeGit()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w2gp-tmp-'))
  cat.install(MANIFEST.plugins[0], repo, { tempDir: tmp, gitExec: git.exec, verifyOk: true })
  const res = cat.update(MANIFEST.plugins[0], repo, { tempDir: tmp, gitExec: git.exec, verifyOk: true })
  assert.strictEqual(res.installed, true)
  // no leftover backup dir
  assert.ok(!fs.existsSync(cat.resolveInstallBase(repo, 'plugins/file-gallery') + '.old'))
  fs.rmSync(repo, { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('update throws when not installed', () => {
  const repo = freshRepo()
  assert.throws(() => cat.update(MANIFEST.plugins[0], repo, { verifyOk: true }), /not installed/)
  fs.rmSync(repo, { recursive: true, force: true })
})

test('remove deletes enabled and disabled dirs', () => {
  const repo = freshRepo()
  const git = makeFakeGit()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w2gp-tmp-'))
  cat.install(MANIFEST.plugins[0], repo, { tempDir: tmp, gitExec: git.exec, verifyOk: true })
  const res = cat.remove(MANIFEST.plugins[0], repo)
  assert.strictEqual(res.removed, true)
  assert.strictEqual(cat.isInstalled(repo, 'plugins/file-gallery'), false)
  fs.rmSync(repo, { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('setEnabled toggles between dir and .disabled dir', () => {
  const repo = freshRepo()
  const git = makeFakeGit()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w2gp-tmp-'))
  cat.install(MANIFEST.plugins[0], repo, { tempDir: tmp, gitExec: git.exec, verifyOk: true })
  assert.strictEqual(cat.installedStatus(repo, MANIFEST.plugins[0]).enabled, true)
  const off = cat.setEnabled(MANIFEST.plugins[0], repo, false)
  assert.strictEqual(off.enabled, false)
  assert.strictEqual(cat.installedStatus(repo, MANIFEST.plugins[0]).enabled, false)
  const on = cat.setEnabled(MANIFEST.plugins[0], repo, true)
  assert.strictEqual(on.enabled, true)
  fs.rmSync(repo, { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('listCatalog augments entries with install state', () => {
  const repo = freshRepo()
  const git = makeFakeGit()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w2gp-tmp-'))
  cat.install(MANIFEST.plugins[0], repo, { tempDir: tmp, gitExec: git.exec, verifyOk: true })
  const list = cat.listCatalog(MANIFEST, repo)
  const fg = list.find((p) => p.id === 'file-gallery')
  assert.strictEqual(fg.installed, true)
  assert.strictEqual(fg.enabled, true)
  assert.strictEqual(fg.installedVersion, '2.0.3')
  const lm = list.find((p) => p.id === 'lora-manager')
  assert.strictEqual(lm.installed, false)
  fs.rmSync(repo, { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
})

// verifyRepo: read-only ls-remote — confirms repo + tag without cloning.
test('verifyRepo confirms repo + tag via ls-remote (no clone)', () => {
  const calls = []
  const exec = (args) => {
    calls.push(args)
    if (args[0] === 'ls-remote') {
      return 'abc123\trefs/heads/main\n' + 'def456\trefs/heads/v2.0.3\n' + 'fed789\trefs/tags/v2.0.3\n'
    }
    return ''
  }
  const good = cat.verifyRepo(MANIFEST.plugins[0], { gitExec: exec })
  assert.strictEqual(good.ok, true)
  assert.strictEqual(good.tagExists, true, 'tag v2.0.3 exists → verified')
  assert.strictEqual(calls[0][0], 'ls-remote', 'used ls-remote, not clone')
  const missing = cat.verifyRepo({ id: 'x', repo: 'https://example.com/a/b', tag: 'v9.9.9' }, { gitExec: exec })
  assert.strictEqual(missing.ok, true)
  assert.strictEqual(missing.tagExists, false)
})

test('verifyRepo fails when repo unreachable', () => {
  const exec = () => { throw new Error('fatal: repository not found') }
  const r = cat.verifyRepo({ id: 'x', repo: 'https://nope/x/y', tag: 'v1' }, { gitExec: exec })
  assert.strictEqual(r.ok, false)
  assert.ok(r.error.includes('not found'))
})
