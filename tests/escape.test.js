/**
 * Tests for the shared HTML-escaping helper (services/escape.js).
 * Same module the renderer uses via preload (window.escHtml) — this suite
 * locks the escaping contract both sides rely on.
 * Run: node --test tests/
 */
const { test } = require('node:test')
const assert = require('node:assert')
const escHtml = require('../services/escape.js')

test('escapes the five HTML metacharacters', () => {
  assert.strictEqual(escHtml('&'), '&amp;')
  assert.strictEqual(escHtml('<'), '&lt;')
  assert.strictEqual(escHtml('>'), '&gt;')
  assert.strictEqual(escHtml('"'), '&quot;')
  assert.strictEqual(escHtml("'"), '&#39;')
})

test('renders a script-injection payload inert', () => {
  const evil = '<img src=x onerror="alert(1)">'
  const out = escHtml(evil)
  assert.ok(!out.includes('<img'), 'raw tag must not survive')
  assert.ok(!out.includes('onerror="'), 'quoted event handler must not survive')
  assert.ok(!/<[a-z]/.test(out), 'no tag-open sequences may remain')
  assert.strictEqual(out, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
})

test('escapes markup hidden inside commit messages / file names', () => {
  const msg = 'fix </span><script>fetch("//evil")</script>'
  assert.strictEqual(escHtml(msg), 'fix &lt;/span&gt;&lt;script&gt;fetch(&quot;//evil&quot;)&lt;/script&gt;')
})

test('leaves plain strings untouched', () => {
  assert.strictEqual(escHtml('plain text'), 'plain text')
  assert.strictEqual(escHtml('a & b'), 'a &amp; b') // the one plain-ish case that must still escape
})

test('non-strings are coerced THEN escaped (no unescaped raw-string path)', () => {
  assert.strictEqual(escHtml(42), '42')
  assert.strictEqual(escHtml(0), '0')
  assert.strictEqual(escHtml(false), 'false')
  assert.strictEqual(escHtml(null), '')
  assert.strictEqual(escHtml(undefined), '')
  assert.strictEqual(escHtml(''), '')
  assert.strictEqual(escHtml(['<i>']), '&lt;i&gt;') // array -> string -> escaped
  assert.strictEqual(escHtml({}), '[object Object]')
})

test('escapes the & first, so already-escaped input is NOT double-interpreted as markup', () => {
  // escHtml is a single-pass escaper: escaping already-escaped text re-escapes
  // the entities (standard behaviour — callers must escape raw strings once).
  assert.strictEqual(escHtml('&lt;b&gt;'), '&amp;lt;b&amp;gt;')
})
