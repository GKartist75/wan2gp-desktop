const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { JSDOM } = require('jsdom')

const ROOT = path.resolve(__dirname, '..')
const HTML = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8')
const APPJS = fs.readFileSync(path.join(ROOT, 'renderer', 'app.js'), 'utf8')

// Stub layer that records createBrowserView opts and satisfies the appBtn handler.
function loadWith(fresh) {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true })
  const { window } = dom
  const calls = []
  window.w2gp = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'launchWebview') return async () => ({ url: 'http://localhost:7860', fresh })
      if (prop === 'createBrowserView') return async (url, opts) => { calls.push({ url, opts }); return { success: true } }
      if (prop === 'configLoad') return async () => ({ termDockDefault: 'minimised' })
      return async () => ({}) // uiModeSet, toggleFloatingTerm, setFtDock, etc.
    }
  })
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0)
  const s = window.document.createElement('script')
  s.textContent = APPJS
  window.document.body.appendChild(s)
  return { window, calls }
}

async function clickLaunch(fresh) {
  const { window, calls } = loadWith(fresh)
  await new Promise((r) => setTimeout(r, 0)) // let injected script settle
  const btn = window.document.getElementById('appBtn')
  btn.dispatchEvent(new window.Event('click'))
  await new Promise((r) => setTimeout(r, 10)) // let the async handler resolve
  return calls
}

test('Desktop launch reloads only when a fresh server was started', async () => {
  const callsFresh = await clickLaunch(true)
  assert.equal(callsFresh.length, 1, 'createBrowserView called once')
  assert.equal(callsFresh[0].opts.reload, true, 'fresh server → reload:true')

  const callsExisting = await clickLaunch(false)
  assert.equal(callsExisting.length, 1, 'createBrowserView called once')
  assert.equal(callsExisting[0].opts.reload, false, 'already-running server → reload:false (no interrupt)')
})
