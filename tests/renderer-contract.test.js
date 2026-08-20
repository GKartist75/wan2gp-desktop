const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const PRELOAD = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8')
const APPJS = fs.readFileSync(path.join(ROOT, 'renderer', 'app.js'), 'utf8')

// The renderer reaches the main process exclusively through window.w2gp.*.
// Every member called on window.w2gp in app.js MUST be exposed in preload.js,
// or the call throws at runtime (this class of bug already bit us once with
// `window.wgp.synckkernels`). Covers `window.w2gp.x`, `@w2gp.x`, and
// `w2gp.x(...)` shorthand forms.
test('every window.w2gp.* used in app.js is exposed by preload.js', () => {
  // 1. members exposed by preload
  const exposed = new Set()
  for (const m of PRELOAD.matchAll(/^\s*([a-zA-Z0-9_]+)\s*:/gm)) exposed.add(m[1])
  for (const m of PRELOAD.matchAll(/([a-zA-Z0-9_]+)\s*:\s*\(/g)) exposed.add(m[1])
  for (const m of PRELOAD.matchAll(/([a-zA-Z0-9_]+),$/gm)) exposed.add(m[1]) // shorthand

  // 2. members called on window.w2gp in app.js (every spelling)
  const used = new Set()
  for (const m of APPJS.matchAll(/window\.w2gp\.([a-zA-Z0-9_]+)/g)) used.add(m[1])
  for (const m of APPJS.matchAll(/@w2gp\.([a-zA-Z0-9_]+)/g)) used.add(m[1])
  for (const m of APPJS.matchAll(/(?<![\w.])w2gp\.([a-zA-Z0-9_]+)\s*\(/g)) used.add(m[1])

  const missing = [...used].filter(name => !exposed.has(name))
  assert.deepStrictEqual(
    missing,
    [],
    `app.js calls window.w2gp.<name> that preload.js does not expose: ${missing.join(', ')}`
  )
})
