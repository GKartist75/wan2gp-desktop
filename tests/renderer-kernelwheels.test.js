const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { JSDOM } = require('jsdom')

const ROOT = path.resolve(__dirname, '..')
const HTML = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8')
const APPJS = fs.readFileSync(path.join(ROOT, 'renderer', 'app.js'), 'utf8')

// Load the real renderer DOM + app.js in jsdom, stubbing the preload bridge.
function loadRenderer() {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true })
  const { window } = dom
  // Minimal w2gp stub so app.js load (and any init) doesn't throw.
  window.w2gp = new Proxy({}, { get: () => async () => ({}) })
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0)
  const s = window.document.createElement('script')
  s.textContent = APPJS
  window.document.body.appendChild(s)
  return window
}

test('renderKernelWheels shows the exact installed version', () => {
  const w = loadRenderer()
  w.renderKernelWheels(
    [{ label: 'Nunchaku', installed: '0.3.1', configured: '0.3.1', state: 'ok' }],
    'cu130', 'win'
  )
  const box = w.document.getElementById('kernelWheels')
  assert.match(box.textContent, /0\.3\.1/)
  // card stays visible
  assert.notEqual(w.document.getElementById('kernelWheelsSubsection').style.display, 'none')
})

test('renderKernelWheels shows "update available" when installed < configured', () => {
  const w = loadRenderer()
  w.renderKernelWheels(
    [{ label: 'Nunchaku', installed: '0.2.0', configured: '0.3.1', state: 'mismatch' }],
    'cu130', 'win'
  )
  const box = w.document.getElementById('kernelWheels')
  assert.match(box.textContent, /0\.2\.0/)
  assert.match(box.textContent, /0\.3\.1/)
  assert.ok(w.document.querySelector('.kw-update'), 'expected an update-available badge')
})

test('renderKernelWheels friendly note when no GPU profile detected', () => {
  const w = loadRenderer()
  w.renderKernelWheels([], null, 'win')
  const box = w.document.getElementById('kernelWheels')
  assert.match(box.textContent, /No GPU kernel profile detected/)
})

test('renderKernelWheels friendly note when profile has no wheels', () => {
  const w = loadRenderer()
  w.renderKernelWheels([], 'gtx1660', 'win')
  const box = w.document.getElementById('kernelWheels')
  assert.match(box.textContent, /no dedicated kernel wheels/)
})
