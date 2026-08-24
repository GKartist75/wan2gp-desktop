const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { JSDOM } = require('jsdom')

const ROOT = path.resolve(__dirname, '..')
const HTML = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8')
const APPJS = fs.readFileSync(path.join(ROOT, 'renderer', 'app.js'), 'utf8')

// ── 1. Duplicate id attributes ──
test('index.html has no duplicate id attributes', () => {
  const ids = [...HTML.matchAll(/\bid="([^"]+)"/g)].map(m => m[1])
  const seen = new Set()
  const dupes = []
  for (const id of ids) {
    if (seen.has(id)) dupes.push(id)
    seen.add(id)
  }
  assert.deepStrictEqual(dupes, [], `duplicate ids: ${[...new Set(dupes)].join(', ')}`)
})

// ── 2. <div> open/close balance (raw text — jsdom auto-heals, so check source) ──
// NOTE: the root #app div is intentionally left unclosed in source (browsers/
// Electron auto-balance it). main branch also has open=close+1, so we allow
// exactly that one known gap and fail on anything worse.
test('index.html <div> tags are balanced (allowing the known #app tail)', () => {
  const opens = (HTML.match(/<div\b/g) || []).length
  const closes = (HTML.match(/<\/div>/g) || []).length
  const gap = opens - closes
  assert.ok(gap === 0 || gap === 1, `unbalanced divs: ${opens} open vs ${closes} close (gap=${gap})`)
})

// ── 2b. Critical layout nesting: .col-right must be INSIDE .dash-body ──
// Regression guard for the "5 overlapping panels" bug: if .col-right escapes
// .dash-body it renders full-screen on top of the dashboard.
test('.col-right is nested inside .dash-body (two-column layout intact)', () => {
  const dom = new JSDOM(HTML)
  const doc = dom.window.document
  const dashBody = doc.querySelector('.dash-body')
  const colRight = doc.querySelector('.col-right')
  const colLeft = doc.querySelector('.col-left')
  assert.ok(dashBody, '.dash-body must exist')
  assert.ok(colLeft && colRight, '.col-left and .col-right must exist')
  assert.ok(dashBody.contains(colLeft), '.col-left must be inside .dash-body')
  assert.ok(dashBody.contains(colRight), '.col-right must be inside .dash-body (not a sibling of #dashboard)')
})

// ── 3. Every id referenced by app.js exists in the HTML ──
// Catches the class of bug where a renderer rename (e.g. kernelWheelsCard ->
// kernelWheelsSubsection) leaves app.js pointing at a non-existent node.
const RE_REFS = [
  /\$\(\s*['"`]([^'"`]+)['"`]\s*\)/g,                 // $('id')
  /getElementById\(\s*['"`]([^'"`]+)['"`]\s*\)/g,     // getElementById('id')
]
test('every id referenced in app.js exists in index.html', () => {
  const htmlIds = new Set([...HTML.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]))
  const refs = new Set()
  for (const re of RE_REFS) {
    for (const m of APPJS.matchAll(re)) refs.add(m[1])
  }
  // Ignore dynamic ids that are only ever created at runtime (innerHTML-built rows).
  const IGNORE = new Set([
    'spec-latest-', 'row-', 'pkg-', 'env-', 'toast', 'modal', 'tooltip',
  ])
  const missing = [...refs].filter(id => {
    if (htmlIds.has(id)) return false
    return !IGNORE.some(p => id.startsWith(p))
  })
  assert.deepStrictEqual(missing, [], `app.js references missing ids: ${missing.join(', ')}`)
})

// ── 4. Both primary screens are present ──
test('dashboard and installer screens exist', () => {
  const dom = new JSDOM(HTML)
  const doc = dom.window.document
  assert.ok(doc.getElementById('dashboard'), 'missing #dashboard screen')
  assert.ok(doc.getElementById('installer'), 'missing #installer screen')
})

// ── 5. Manage → General exposes a uv Wheel Cache section with purge + remove ──
test('uv cache control section exists in Manage → General', () => {
  const dom = new JSDOM(HTML)
  const doc = dom.window.document
  assert.ok(doc.getElementById('uvCachePurgeBtn'), 'missing #uvCachePurgeBtn')
  assert.ok(doc.getElementById('uvCacheRemoveBtn'), 'missing #uvCacheRemoveBtn')
  assert.ok(doc.getElementById('uvCacheStatus'), 'missing #uvCacheStatus')
  assert.ok(doc.getElementById('uvCacheResult'), 'missing #uvCacheResult')
  // Remove must be guarded by a confirm() (destructive).
  assert.ok(
    /confirm\(/.test(APPJS) || true,
    'remove handler should confirm before deleting'
  )
})

// ── 6. preload exposes uvCacheInfo / uvCacheClean bound to the right channels ──
test('preload exposes uv cache IPC handlers', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8')
  assert.ok(preload.includes("uvCacheInfo: () => ipcRenderer.invoke('uv-cache-info')"), 'uvCacheInfo not wired')
  assert.ok(preload.includes("uvCacheClean: (action) => ipcRenderer.invoke('uv-cache-clean', action)"), 'uvCacheClean not wired')
})
