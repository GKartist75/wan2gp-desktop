'use strict'

// Pure, Electron-free validation of a user-supplied data-dir path.
// Shared by main.js's `set-data-dir` IPC handler so the same guard can be
// unit-tested without booting Electron.
//
// Rules:
//   - must be a non-empty string
//   - must ALREADY be an absolute path (no resolving relative input — a user
//     typing `some/relative/dir` must not silently become CWD-relative)
//   - must not contain a `..` traversal component (reject before normalizing,
//     since normalize would collapse it and hide the intent)
//   - must be normalized (no `.` segments / double separators changing form)
// Returns the canonical absolute path on success, or null on rejection.
function validateDataDir(dir) {
  if (!dir || typeof dir !== 'string') return null
  const path = require('path')
  // Reject relative input up front — don't let path.resolve smuggle it to CWD.
  if (!path.isAbsolute(dir)) return null
  // Reject traversal components before normalization hides them.
  if (dir.split(/[\\/]/).includes('..')) return null
  let resolved
  try { resolved = path.resolve(dir) } catch { return null }
  if (path.normalize(resolved) !== resolved) return null
  return resolved
}

module.exports = validateDataDir
