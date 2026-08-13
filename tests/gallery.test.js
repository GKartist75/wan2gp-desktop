/**
 * Tests for the Gallery service (services/gallery.js). Pure, offline — no Electron/ffmpeg.
 * Run: node --test tests/
 */
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const g = require('../services/gallery.js')

function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'w2gp-gallery-'))
  const out = path.join(root, 'outputs')
  fs.mkdirSync(out, { recursive: true })
  // A finished image with a sidecar
  fs.writeFileSync(path.join(out, 'img1.png'), 'IMG')
  fs.writeFileSync(path.join(out, 'img1.json'), JSON.stringify({
    prompt: 'a cat', negative_prompt: 'blur', model: 'wan2.1', seed: 42,
    params: { steps: 20, width: 832, height: 480 }, created_at: '2026-01-01'
  }))
  // A video
  fs.writeFileSync(path.join(out, 'vid1.mp4'), 'VID')
  // A frame folder (should be skipped by scan, joinable separately)
  const frames = path.join(out, 'frames_run1')
  fs.mkdirSync(frames)
  for (let i = 1; i <= 3; i++) fs.writeFileSync(path.join(frames, `frame_${String(i).padStart(4, '0')}.png`), 'F')
  return { root, out, frames }
}

test('resolveOutputDirs finds outputs/ fallback', () => {
  const { root } = makeTree()
  const dirs = g.resolveOutputDirs({ repoDir: root })
  assert.ok(dirs.includes(path.join(root, 'outputs')))
  fs.rmSync(root, { recursive: true, force: true })
})

test('resolveOutputDirs honors savePath', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'w2gp-g2-'))
  const custom = path.join(root, 'my_out')
  fs.mkdirSync(custom, { recursive: true })
  const dirs = g.resolveOutputDirs({ repoDir: root, savePath: 'my_out' })
  assert.ok(dirs.includes(custom))
  fs.rmSync(root, { recursive: true, force: true })
})

test('scanOutputs lists media with metadata and skips frame folders', () => {
  const { root, out } = makeTree()
  const items = g.scanOutputs({ repoDir: root, recursive: true })
  const names = items.map((i) => i.name).sort()
  assert.deepStrictEqual(names, ['img1.png', 'vid1.mp4'])
  const img = items.find((i) => i.name === 'img1.png')
  assert.strictEqual(img.type, 'image')
  assert.strictEqual(img.hasSidecar, true)
  assert.strictEqual(img.metadata.prompt, 'a cat')
  assert.strictEqual(img.metadata.steps, 20)
  assert.strictEqual(img.metadata.width, 832)
  fs.rmSync(root, { recursive: true, force: true })
})

test('normalizeMeta tolerates missing/invalid sidecar', () => {
  assert.deepStrictEqual(g.normalizeMeta(null), {})
  assert.deepStrictEqual(g.normalizeMeta('not json'), {})
  assert.strictEqual(g.normalizeMeta({ prompt: 'x' }).prompt, 'x')
})

test('collectFrames orders numerically and reports count', () => {
  const { root, frames } = makeTree()
  const r = g.collectFrames(frames, 30)
  assert.strictEqual(r.count, 3)
  assert.strictEqual(r.fps, 30)
  assert.ok(r.frames[0].endsWith('frame_0001.png'))
  assert.ok(r.frames[2].endsWith('frame_0003.png'))
  fs.rmSync(root, { recursive: true, force: true })
})

test('buildJoinCommand errors when fewer than 2 frames', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'w2gp-j1-'))
  fs.writeFileSync(path.join(d, 'frame_0001.png'), 'F')
  const r = g.buildJoinCommand({ folder: d })
  assert.ok(r.error)
  fs.rmSync(d, { recursive: true, force: true })
})

test('buildJoinCommand builds correct ffmpeg args', () => {
  const { root, frames } = makeTree()
  const r = g.buildJoinCommand({ folder: frames, outName: 'out.mp4', fps: 25, ffmpegPath: '/bin/ffmpeg', crf: 20 })
  assert.ok(!r.error, r.error || '')
  assert.strictEqual(r.cmd, '/bin/ffmpeg')
  assert.ok(r.args.includes('-framerate'))
  assert.ok(r.args.includes('25'))
  // pattern derived from first frame
  const pat = r.args[r.args.indexOf('-i') + 1]
  assert.strictEqual(pat, 'frame_%04d.png')
  assert.ok(r.args.includes('libx264'))
  assert.ok(r.args.includes('yuv420p'))
  assert.ok(r.outPath.endsWith('out.mp4'))
  fs.rmSync(root, { recursive: true, force: true })
})

test('buildJoinCommand errors if folder missing', () => {
  const r = g.buildJoinCommand({ folder: '/no/such/dir' })
  assert.ok(r.error)
})
