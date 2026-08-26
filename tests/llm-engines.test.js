/**
 * Tests for services/llm-engines.js — the DATA catalog of remote LLM engines
 * for Deepy Prime. This module is data, not branching code: adding an engine
 * (e.g. a future "Gemini CLI") means adding ONE entry, no UI/IPC change.
 *
 * These tests pin the data contract the renderer + main.js depend on.
 *
 * Run: node --test tests/llm-engines.test.js
 */
const { test } = require('node:test')
const assert = require('node:assert')
const { LLM_ENGINES, pipModuleFor, npmPackageFor } = require('../services/llm-engines.js')

test('catalog has the three Wan2GP-documented engines', () => {
  const ids = LLM_ENGINES.map(e => e.id)
  assert.ok(ids.includes('claude-code'))
  assert.ok(ids.includes('codex'))
  assert.ok(ids.includes('opencode'))
})

test('claude-code carries the pinned install spec from REMOTE_LLMS.md', () => {
  const c = LLM_ENGINES.find(e => e.id === 'claude-code')
  assert.ok(c)
  assert.strictEqual(c.install.mode, 'pip')
  assert.strictEqual(c.install.spec, 'claude-agent-sdk==0.1.40')
  assert.strictEqual(c.cli, 'claude')
})

test('codex and opencode are external with npm installers + opencode has a server', () => {
  const codex = LLM_ENGINES.find(e => e.id === 'codex')
  const oc = LLM_ENGINES.find(e => e.id === 'opencode')
  assert.strictEqual(codex.external, true)
  assert.strictEqual(codex.install.mode, 'npm')
  assert.strictEqual(codex.install.spec, '@openai/codex')
  assert.strictEqual(oc.external, true)
  assert.strictEqual(oc.install.mode, 'npm')
  assert.strictEqual(oc.install.spec, 'opencode-ai')
  assert.ok(oc.serve && oc.serve.cmd === 'opencode')
  assert.deepStrictEqual(oc.serve.args, ['serve', '--hostname', '127.0.0.1', '--port', '4096'])
  assert.strictEqual(oc.serverUrl, 'http://127.0.0.1:4096')
})

test('npmPackageFor returns the npm package name only for npm engines', () => {
  assert.strictEqual(npmPackageFor(LLM_ENGINES.find(e => e.id === 'codex')), 'codex-cli')
  assert.strictEqual(npmPackageFor(LLM_ENGINES.find(e => e.id === 'opencode')), 'opencode-ai')
  assert.strictEqual(npmPackageFor(LLM_ENGINES.find(e => e.id === 'claude-code')), null)
})

test('every engine has the fields the renderer card needs', () => {
  for (const e of LLM_ENGINES) {
    assert.ok(e.id && typeof e.id === 'string', `missing id for ${e.label}`)
    assert.ok(e.label && typeof e.label === 'string')
    assert.ok(e.desc && typeof e.desc === 'string')
    assert.ok(e.docs && e.docs.startsWith('https://'))
    // pipPackage may be null (external engines); if present it must be a string
    if (e.pipPackage) assert.strictEqual(typeof e.pipPackage, 'string')
    // exactly one of {install pip, external} should drive the action button
    const hasPip = !!(e.install && e.install.mode === 'pip')
    assert.ok(hasPip !== e.external, `engine ${e.id} must be pip-installable XOR external`)
  }
})

test('pipModuleFor normalizes the python import name', () => {
  const c = LLM_ENGINES.find(e => e.id === 'claude-code')
  assert.strictEqual(pipModuleFor(c), 'claude_agent_sdk')
  assert.strictEqual(pipModuleFor(LLM_ENGINES.find(e => e.id === 'codex')), null)
})
