const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseVersions, annotateWheels } = require('../services/status-helpers.js')

test('parseVersions parses k=v pairs joined by ||', () => {
  const out = 'python=3.11.9||torch=2.6.0+cu124||triton=3.1.0'
  const v = parseVersions(out)
  assert.equal(v.python, '3.11.9')
  assert.equal(v.torch, '2.6.0+cu124')
  assert.equal(v.triton, '3.1.0')
})

test('parseVersions ignores blank/garbage lines', () => {
  const v = parseVersions('python=3.11.9||garbage||torch=2.6.0')
  assert.equal(v.python, '3.11.9')
  assert.equal(v.torch, '2.6.0')
  assert.equal('garbage' in v, false)
})

test('annotateWheels marks ok / mismatch / missing', async () => {
  const wheels = [
    { key: 'nunchaku', pipName: 'nunchaku', configured: '0.3.1' },
    { key: 'lightx2v', pipName: 'lightx2v', configured: '0.2.0' },
    { key: 'gguf', pipName: 'llamacpp_gguf_cuda', configured: '1.0.11' },
  ]
  // installedFn(py, pipName): nunchaku current, lightx2v older (mismatch), gguf missing
  const installed = async (py, name) => {
    if (name === 'nunchaku') return '0.3.1'
    if (name === 'lightx2v') return '0.1.0'
    return null
  }
  await annotateWheels(wheels, 'py', installed)
  assert.equal(wheels[0].state, 'ok')
  assert.equal(wheels[0].installed, '0.3.1')
  assert.equal(wheels[1].state, 'mismatch')   // 0.1.0 !== configured 0.2.0
  assert.equal(wheels[2].state, 'missing')    // no installed version
})

test('annotateWheels tolerates installedFn throwing', async () => {
  const wheels = [{ key: 'x', pipName: 'x', configured: '1.0' }]
  const installed = async () => { throw new Error('boom') }
  await annotateWheels(wheels, 'py', installed)
  // must not throw — treat as missing
  assert.equal(wheels[0].state, 'missing')
  assert.equal(wheels[0].installed, null)
})
