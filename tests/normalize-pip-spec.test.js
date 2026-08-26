/**
 * Tests for services/normalize-pip-spec.js — the Advanced box must accept a
 * bare spec OR a full pasted command and reduce both to the same spec.
 */
const { test } = require('node:test')
const assert = require('node:assert')
const { normalizePipSpec } = require('../services/normalize-pip-spec.js')

test('keeps a bare spec unchanged', () => {
  assert.strictEqual(normalizePipSpec('claude-agent-sdk==0.1.40'), 'claude-agent-sdk==0.1.40')
})

test('strips a leading "pip install "', () => {
  assert.strictEqual(normalizePipSpec('pip install claude-agent-sdk==0.1.40'), 'claude-agent-sdk==0.1.40')
})

test('strips "python -m pip install "', () => {
  assert.strictEqual(normalizePipSpec('python -m pip install torch>=2.5.0'), 'torch>=2.5.0')
})

test('strips "py -m pip install " (short form)', () => {
  assert.strictEqual(normalizePipSpec('py -m pip install foo'), 'foo')
})

test('is case-insensitive and trims whitespace', () => {
  assert.strictEqual(normalizePipSpec('  PIP INSTALL  openai-codex~=0.1.0  '), 'openai-codex~=0.1.0')
})

test('empty / non-pip input passes through', () => {
  assert.strictEqual(normalizePipSpec(''), '')
  assert.strictEqual(normalizePipSpec('   '), '')
  assert.strictEqual(normalizePipSpec('some random text'), 'some random text')
})
