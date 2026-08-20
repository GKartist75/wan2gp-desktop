// Focused test for mergeDirContents (migration move, no double-nesting).
const fs = require('fs')
const os = require('os')
const path = require('path')

function mergeDirContents(src, dst) {
  try {
    fs.mkdirSync(dst, { recursive: true })
    const items = fs.readdirSync(src)
    if (items.length === 0) { fs.rmSync(src, { recursive: true, force: true }); return true }
    let moved = 0
    for (const name of items) {
      const s = path.join(src, name)
      const d = path.join(dst, name)
      if (fs.existsSync(d)) continue
      try { fs.renameSync(s, d); moved++ } catch {}
    }
    if (moved === items.length || items.every(n => fs.existsSync(path.join(dst, n)))) {
      try { fs.rmSync(src, { recursive: true, force: true }) } catch {}
      return true
    }
    return false
  } catch (e) { return false }
}

function assert(c, m) { if (!c) { console.error('FAIL: ' + m); process.exitCode = 1 } else console.log('PASS: ' + m) }

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-'))
try {
  // Legacy flat layout: Roaming\wan2gp-desktop with repo + config directly inside.
  const legacy = path.join(base, 'roaming', 'wan2gp-desktop')
  const inst = path.join(base, 'C-Wan2GP')
  fs.mkdirSync(path.join(legacy, 'Wan2GP-repo-fake'), { recursive: true })
  fs.writeFileSync(path.join(legacy, 'wgp_config.json'), '{}')
  fs.writeFileSync(path.join(legacy, '.electron-marker'), 'x')
  // inst already has v3.0 scaffolding (should NOT be clobbered, and must not nest).
  fs.mkdirSync(path.join(inst, '.electron'), { recursive: true })

  assert(mergeDirContents(legacy, inst) === true, 'merge succeeds')
  assert(fs.existsSync(path.join(inst, 'wgp_config.json')), 'config moved into C:\\Wan2GP (flat)')
  assert(fs.existsSync(path.join(inst, 'Wan2GP-repo-fake')), 'repo dir moved into C:\\Wan2GP')
  assert(fs.existsSync(path.join(inst, '.electron')), 'v3.0 .electron preserved (not clobbered)')
  assert(!fs.existsSync(path.join(inst, 'wan2gp-desktop')), 'NO nested C:\\Wan2GP\\wan2gp-desktop')
  assert(!fs.existsSync(path.join(inst, 'Wan2GP')), 'NO nested C:\\Wan2GP\\Wan2GP')
  assert(!fs.existsSync(legacy), 'legacy source removed after merge')
} finally {
  try { fs.rmSync(base, { recursive: true, force: true }) } catch {}
}
console.log(process.exitCode ? '\nSOME TESTS FAILED' : '\nALL TESTS PASSED')
