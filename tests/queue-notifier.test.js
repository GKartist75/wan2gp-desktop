/**
 * Tests for the Queue Notifier service (services/queue-notifier.js). Pure, offline.
 * Run: node --test tests/
 */
const { test } = require('node:test')
const assert = require('node:assert')
const q = require('../services/queue-notifier.js')

test('classifyLine detects completion markers', () => {
  assert.strictEqual(q.classifyLine('Task completed')[0]?.kind || q.classifyLine('Task completed').kind, 'complete')
  assert.strictEqual(q.classifyLine('[*] Saved to outputs/vid.mp4').kind, 'complete')
  assert.strictEqual(q.classifyLine('✓ generation finished').kind, 'complete')
})

test('classifyLine detects failure markers', () => {
  assert.strictEqual(q.classifyLine('Traceback (most recent call last):').kind, 'fail')
  assert.strictEqual(q.classifyLine('CUDA out of memory').kind, 'fail')
  assert.strictEqual(q.classifyLine('RuntimeError: shape mismatch').kind, 'fail')
})

test('classifyLine detects progress percent and ignores 100%', () => {
  const e = q.classifyLine('[=====     ] 62%')
  assert.strictEqual(e.kind, 'progress')
  assert.strictEqual(e.percent, 62)
  const full = q.classifyLine('[============] 100%')
  assert.strictEqual(full, null, '100% should not be a progress event (it is completion)')
})

test('detectEvents de-duplicates plateaued progress', () => {
  const state = {}
  const evs = q.detectEvents([
    'progress 10',
    'progress 10',
    'progress 55',
    'progress 55',
    'progress 90'
  ], state)
  const pcts = evs.filter((e) => e.kind === 'progress').map((e) => e.percent)
  assert.deepStrictEqual(pcts, [10, 55, 90])
})

test('detectEvents resets progress baseline after terminal event', () => {
  const state = {}
  q.detectEvents(['progress 40'], state)
  q.detectEvents(['Task completed'], state)
  // a later lower percent after completion is reported again
  const evs = q.detectEvents(['progress 20'], state)
  assert.strictEqual(evs.some((e) => e.kind === 'progress' && e.percent === 20), true)
})

test('buildMessage formats per kind', () => {
  assert.strictEqual(q.buildMessage({ kind: 'complete', text: 'x' }), 'Wan2GP: ✅ generation finished')
  assert.strictEqual(q.buildMessage({ kind: 'progress', percent: 50, text: 'x' }), 'Wan2GP: 50% done')
  assert.ok(q.buildMessage({ kind: 'fail', text: 'boom' }, { includeLog: true }).includes('boom'))
  assert.ok(q.buildMessage({ kind: 'complete', text: 'x' }, { jobName: 'clip1' }).includes('(clip1)'))
})

test('normalizeConfig requires url when enabled', () => {
  const r = q.normalizeConfig({ enabled: true, url: '' })
  assert.strictEqual(r.ok, false)
  const ok = q.normalizeConfig({ enabled: true, url: 'discord://x', notifyOnProgress: true, progressStep: 250 })
  assert.strictEqual(ok.ok, true)
  assert.strictEqual(ok.config.url, 'discord://x')
  assert.strictEqual(ok.config.progressStep, 100, 'progressStep clamped to 100')
  assert.strictEqual(ok.config.notifyOnComplete, true, 'defaults true')
})

test('normalizeConfig disables when url missing', () => {
  const r = q.normalizeConfig({ enabled: true })
  assert.strictEqual(r.ok, false)
})

test('shouldNotify honors config flags', () => {
  const cfg = q.normalizeConfig({ enabled: true, url: 'tgram://a', notifyOnProgress: false }).config
  assert.strictEqual(q.shouldNotify({ kind: 'complete' }, cfg), true)
  assert.strictEqual(q.shouldNotify({ kind: 'progress' }, cfg), false)
  const off = q.normalizeConfig({ enabled: false, url: 'tgram://a' }).config
  assert.strictEqual(q.shouldNotify({ kind: 'complete' }, off), false)
})
