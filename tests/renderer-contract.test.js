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

// Issue #74, Bug #2: the Installer "Model folders" UI used to write ONLY
// desktop-config.json (cosmetic) and never bridge to wgp_config.json — so any
// custom path silently reverted to C:\Wan2GP-Models on refresh and downloads
// ignored it. The setter must now also call writeWgpConfig (the real bridge),
// and loadPaths must read the persisted choice back from configLoad().
test('Installer model-folder UI bridges to wgp_config.json (issue #74, Bug #2)', () => {
  for (const type of ['ckpts', 'loras', 'output']) {
    const def = APPJS.indexOf(`async function browseModelFolder`)
    assert.ok(def !== -1, 'browseModelFolder must be defined')
    const block = APPJS.slice(def, def + 700)
    assert.ok(
      /window\.w2gp\.writeWgpConfig\(/.test(block),
      `browseModelFolder must call writeWgpConfig (the wgp_config.json bridge)`
    )
  }
  // All three clear handlers must also reset the real config.
  for (const id of ['clearCkptsPath', 'clearLorasPath', 'clearOutputPath']) {
    const start = APPJS.indexOf(`$('${id}')`)
    assert.ok(start !== -1, `$${id} handler must exist`)
    const block = APPJS.slice(start, start + 550)
    assert.ok(
      /window\.w2gp\.writeWgpConfig\(/.test(block),
      `$${id} must also reset wgp_config.json so the UI and Wan2GP stay in sync`
    )
  }
  // loadPaths must consult the persisted choice (configLoad) instead of ALWAYS
  // defaulting to C:\Wan2GP-Models.
  const loadIdx = APPJS.indexOf('async function loadPaths')
  assert.ok(loadIdx !== -1, 'loadPaths must exist')
  const body = APPJS.slice(loadIdx, APPJS.indexOf('// Tiny path join', loadIdx))
  assert.ok(/configLoad\(\)/.test(body), 'loadPaths must read configLoad() for the persisted choice')
  assert.ok(
    /savedCkpts|modelCkptsPath/.test(body),
    'loadPaths must prefer the saved modelCkptsPath over the default (no silent revert)'
  )
})
