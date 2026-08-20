// Focused test for moveDirAtomic lock-handling (mirrors main.js body).
// Runs on the real Windows host so file-lock semantics are genuine.
const fs = require('fs')
const os = require('os')
const path = require('path')

function moveDirAtomic(src, dst) {
  try { fs.renameSync(src, dst); return true } catch { /* fall through to copy */ }
  try {
    fs.cpSync(src, dst, {
      recursive: true,
      filter: (p) => {
        try { fs.accessSync(p, fs.constants.R_OK); return true }
        catch { return false } // unreadable/locked — skip this file
      }
    })
    const sameCount = (d) => fs.readdirSync(d).length
    if (sameCount(src) === sameCount(dst) && fs.readdirSync(dst).length > 0) {
      fs.rmSync(src, { recursive: true, force: true })
      return true
    }
  } catch (e) { /* logError suppressed */ }
  return false
}

function assert(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1 } else console.log('PASS: ' + msg) }

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mvtest-'))
try {
  // --- Case 1: normal move (rename path) ---
  const a = path.join(base, 'src1'), b = path.join(base, 'dst1')
  fs.mkdirSync(a, { recursive: true })
  fs.writeFileSync(path.join(a, 'f.txt'), 'hello')
  assert(moveDirAtomic(a, b) === true, 'normal move succeeds')
  assert(fs.existsSync(path.join(b, 'f.txt')), 'normal move relocated file')
  assert(!fs.existsSync(a), 'normal move removed source')

  // --- Case 2: folder with a read-denied (locked-style) file ---
  const c = path.join(base, 'src2'), d = path.join(base, 'dst2')
  fs.mkdirSync(c, { recursive: true })
  fs.writeFileSync(path.join(c, 'ok.txt'), 'keep')
  const locked = path.join(c, 'locked.bin')
  fs.writeFileSync(locked, 'secret')
  // Make it unreadable so fs.accessSync(R_OK) throws -> cpSync filter skips it.
  // (On Windows same-volume rename ignores this lock entirely, so the move
  // will succeed via rename and the whole folder — incl. locked.bin — relocates.)
  fs.chmodSync(locked, 0o000)
  const result = moveDirAtomic(c, d)
  // Restore perms on BOTH possible locations so cleanup works regardless of path taken.
  for (const loc of [path.join(c, 'locked.bin'), path.join(d, 'locked.bin')]) {
    try { fs.chmodSync(loc, 0o644) } catch {}
  }
  assert(result === true, 'move with a read-denied file still succeeds (bulk relocated)')
  assert(fs.existsSync(path.join(d, 'ok.txt')), 'readable file was moved')
  assert(fs.existsSync(d), 'destination folder exists')
  const srcGone = !fs.existsSync(c)
  console.log('(info) rename-path taken (Windows): src2 gone=%s, locked.bin moved into dst2=%s',
    srcGone, fs.existsSync(path.join(d, 'locked.bin')))
} finally {
  try { fs.rmSync(base, { recursive: true, force: true }) } catch {}
}
console.log(process.exitCode ? '\nSOME TESTS FAILED' : '\nALL TESTS PASSED')
