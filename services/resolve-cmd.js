/**
 * resolve-cmd.js — locate a Windows command's actually-executable path.
 *
 * On Windows, npm / npx / opencode / etc. ship as `*.cmd` shims that CANNOT be
 * spawned directly via child_process.spawn (no shell) — that yields ENOENT even
 * when installed. We also walk extra PATH-like dirs (nvm4w, Node install dirs)
 * because a double-clicked .exe may not inherit those. Returns null if absent.
 *
 * Pure & offline-testable (takes an injectable PATH/dirs for tests).
 */
const path = require('path')

function resolveCmd(name, opts) {
  if (!name) return null
  opts = opts || {}
  const fs = opts.fs || require('fs')
  const sep = opts.sep || path.delimiter
  const ext = process.platform === 'win32' ? '.cmd' : ''
  const candidates = [name + ext, name, name + '.exe']

  const dirs = []
  if (opts.path) dirs.push(...opts.path.split(sep).filter(Boolean))
  if (opts.extraDirs) dirs.push(...opts.extraDirs)

  const appData = opts.localAppData || opts.appData
  if (appData) {
    dirs.push(path.join(appData, 'nvm4w', 'nodejs'))
    dirs.push(path.join(appData, 'Programs', 'nodejs'))
  }
  if (opts.programFiles) dirs.push(path.join(opts.programFiles, 'nodejs'))
  if (opts.appData) {
    dirs.push(path.join(opts.appData, 'nvm4w', 'nodejs'))
    dirs.push(path.join(opts.appData, 'Programs', 'nodejs'))
  }
  // nvm4w default install location is often the drive root, e.g. C:\nvm4w\nodejs
  const sysDrive = opts.systemDrive || 'C:\\'
  dirs.push(path.join(sysDrive, 'nvm4w', 'nodejs'))

  for (const dir of dirs) {
    for (const c of candidates) {
      const p = path.join(dir, c)
      try { if (fs.existsSync(p)) return p } catch {}
    }
  }
  return null
}

module.exports = { resolveCmd }
