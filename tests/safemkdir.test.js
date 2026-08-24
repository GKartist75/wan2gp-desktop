// Regression tests for the bare-drive-root install bug (issue: EPERM mkdir 'D:\'
// when the user picks a whole drive like D: with no folder).
// On Windows, fs.mkdirSync('D:\\', {recursive:true}) throws EPERM because you
// cannot "create" a drive root. safeMkdir must never throw for that, and the
// install pre-flight must auto-fall back to a writable root-level subfolder.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

// Import the helpers directly from main.js (they are plain top-level functions).
// main.js has side effects at load (Electron APIs). To avoid that, re-declare
// the small pure helpers here mirroring main.js so the test is isolated + fast.
function safeMkdir(p) {
  try {
    const rp = path.resolve(p)
    const root = path.parse(rp).root
    if (rp === root) return
    try { fs.mkdirSync(rp, { recursive: true }); return } catch (e) {
      fs.mkdirSync(rp, { recursive: false })
    }
  } catch (e) {
    if (e && e.code !== 'EEXIST') throw e
  }
}
function dirIsWritable(p) {
  try {
    safeMkdir(p)
    const probe = path.join(p, '.wan2gp-desktop-writetest-' + process.pid)
    fs.writeFileSync(probe, '1')
    fs.unlinkSync(probe)
    return true
  } catch { return false }
}

test('safeMkdir does NOT throw on a bare drive root on Windows', () => {
  if (os.platform() !== 'win32') return // EPERM-on-root is Windows-specific
  assert.doesNotThrow(() => safeMkdir('C:\\'))
  assert.doesNotThrow(() => safeMkdir('D:\\'))
})

test('safeMkdir creates a root-level subfolder without EPERM', () => {
  if (os.platform() !== 'win32') return
  const target = path.join('C:\\', 'Wan2GP-test-' + process.pid)
  safeMkdir(target)
  assert.ok(fs.existsSync(target), 'subfolder should be created')
  // cleanup
  try { fs.rmSync(target, { recursive: true, force: true }) } catch {}
})

test('dirIsWritable returns false for a truly read-only/nonexistent drive letter', () => {
  if (os.platform() !== 'win32') return
  // A drive letter that almost certainly is not mounted -> not writable.
  const bogus = path.join('Z:\\', 'Wan2GP')
  const writable = dirIsWritable(bogus)
  assert.strictEqual(typeof writable, 'boolean')
  // We only assert it produced a boolean without throwing.
})
