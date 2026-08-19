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
test('index.html <div> tags are balanced', () => {
  const opens = (HTML.match(/<div\b/g) || []).length
  const closes = (HTML.match(/<\/div>/g) || []).length
  assert.strictEqual(opens, closes, `unbalanced divs: ${opens} open vs ${closes} close`)
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
