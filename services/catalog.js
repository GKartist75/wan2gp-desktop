/**
 * Plugin Catalog service — pure Node module (no Electron deps) so it can be
 * unit-tested under `node --test` exactly like services/escape.js.
 *
 * Responsibility: turn a curated, version-pinned manifest (resources/plugin-catalog.json)
 * into install/update/enable/remove operations against the launcher-managed
 * Wan2GP install at <dataDir>/Wan2GP. Plugins land in plugins/<id> (or the
 * entry's installPath for model/processor plugins). The original user Wan2GP
 * install is never touched — everything here is scoped to the data dir.
 *
 * Git is invoked through injected `gitExec` so tests can run offline against a
 * fake executor instead of hitting the network.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

// ── Schema ────────────────────────────────────────────────────────────────
const REQUIRED_FIELDS = ['id', 'name', 'author', 'version', 'type', 'repo', 'tag', 'installPath']

function validateManifest(manifest) {
  const errors = []
  if (!manifest || typeof manifest !== 'object') {
    return [{ field: '(root)', message: 'manifest must be an object' }]
  }
  if (!Array.isArray(manifest.plugins)) {
    errors.push({ field: 'plugins', message: 'plugins must be an array' })
    return errors
  }
  const seen = new Set()
  for (const [i, p] of manifest.plugins.entries()) {
    for (const f of REQUIRED_FIELDS) {
      if (p[f] === undefined || p[f] === null || p[f] === '') {
        errors.push({ field: `plugins[${i}].${f}`, message: `missing or empty required field '${f}'` })
      }
    }
    const id = p.id
    if (id) {
      if (seen.has(id)) errors.push({ field: `plugins[${i}].id`, message: `duplicate plugin id '${id}'` })
      else seen.add(id)
    }
    if (p.installPath && (p.installPath.startsWith('/') || /^\.\.?[\\/]/.test(p.installPath))) {
      errors.push({ field: `plugins[${i}].installPath`, message: 'installPath must be a relative path inside the repo' })
    }
  }
  return errors
}

function parseManifest(raw) {
  const manifest = typeof raw === 'string' ? JSON.parse(raw) : raw
  const errors = validateManifest(manifest)
  if (errors.length) {
    const summary = errors.map((e) => `${e.field}: ${e.message}`).join('; ')
    throw new Error('Invalid plugin catalog manifest — ' + summary)
  }
  return manifest
}

// ── Filesystem helpers ──────────────────────────────────────────────────────
// A plugin is "disabled" when its base directory is suffixed with `.disabled`.
function enabledDirName(installPath) {
  return installPath
}
function disabledDirName(installPath) {
  const base = path.basename(installPath)
  const dir = path.dirname(installPath)
  return path.join(dir, base + '.disabled')
}

function resolveInstallBase(repoDir, installPath) {
  return path.resolve(repoDir, installPath)
}

function isInstalled(repoDir, installPath) {
  return fs.existsSync(resolveInstallBase(repoDir, enabledDirName(installPath)))
}

function isDisabled(repoDir, installPath) {
  return fs.existsSync(resolveInstallBase(repoDir, disabledDirName(installPath)))
}

function installedStatus(repoDir, entry) {
  const base = resolveInstallBase(repoDir, entry.installPath)
  const enabledDir = resolveInstallBase(repoDir, enabledDirName(entry.installPath))
  const disabledDir = resolveInstallBase(repoDir, disabledDirName(entry.installPath))
  if (fs.existsSync(enabledDir)) return { installed: true, enabled: true, dir: enabledDir }
  if (fs.existsSync(disabledDir)) return { installed: true, enabled: false, dir: disabledDir }
  return { installed: false, enabled: false, dir: base }
}

// ── Git operations (gitExec injected for testability) ───────────────────────
// Default executor shells out via child_process, mirroring main.js conventions
// (windowsHide to avoid flashing a console on Windows).
function defaultGitExec() {
  // Lazy require so the module can be imported in tests without spawning git.
  const { execFileSync } = require('child_process')
  return (args, cwd) =>
    execFileSync('git', args, { cwd, stdio: 'pipe', windowsHide: true, encoding: 'utf8' })
}

function cloneInto(entry, repoDir, tempDir, gitExec) {
  const git = gitExec || defaultGitExec()
  const tmp = path.join(tempDir, entry.id + '-' + Date.now())
  // Clone the pinned tag shallowly so we pull exactly the catalogued version.
  git(['clone', '--depth', '1', '--branch', entry.tag, '--single-branch', entry.repo, tmp], repoDir)
  return tmp
}

/**
 * Verify a catalog entry's repo URL + tag exist WITHOUT cloning (read-only
 * `git ls-remote`). Used to flip `verified` before any install. Safe: no files
 * are written, no plugin code is executed.
 * @param {object} entry
 * @param {object} [opts] { gitExec }
 * @returns {{ ok:boolean, error?:string, tagExists?:boolean, defaultBranch?:string }}
 */
function verifyRepo(entry, opts = {}) {
  const git = opts.gitExec || defaultGitExec()
  try {
    // Confirm the remote exists at all.
    const head = git(['ls-remote', '--heads', entry.repo], null)
    if (!head || !head.trim()) return { ok: false, error: 'Repository not found or not accessible: ' + entry.repo }
    // Confirm the pinned tag/branch exists.
    const tagRef = 'refs/heads/' + entry.tag + '\nrefs/tags/' + entry.tag
    const hasTag = head.split('\n').some((l) => l.includes('refs/heads/' + entry.tag) || l.includes('refs/tags/' + entry.tag))
    return { ok: true, tagExists: hasTag, defaultBranch: (head.split('\n')[0] || '').split('\t')[1] || '' }
  } catch (e) {
    return { ok: false, error: (e && e.message ? e.message : String(e)).split('\n')[0] }
  }
}

function removeRecursively(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
}

// ── Public operations ────────────────────────────────────────────────────────
/**
 * Install a catalog entry into the managed Wan2GP install.
 * @param {object} entry        one manifest plugin entry
 * @param {string} repoDir      absolute path to <dataDir>/Wan2GP
 * @param {object} [opts]       { tempDir, gitExec, verifyOk }
 */
function install(entry, repoDir, opts = {}) {
  if (!entry) throw new Error('install: missing catalog entry')
  if (entry.verified === false && opts.verifyOk !== true) {
    throw new Error(`Refusing to install unverified plugin '${entry.id}' — confirm repo URL/tag first`)
  }
  // A disabled dir means the user previously installed + disabled it — treat as installed.
  if (isInstalled(repoDir, entry.installPath)) {
    throw new Error(`Plugin '${entry.id}' is already installed`)
  }
  const tempDir = opts.tempDir || fs.mkdtempSync(path.join(os.tmpdir(), 'w2gp-catalog-'))
  const finalDir = resolveInstallBase(repoDir, enabledDirName(entry.installPath))
  fs.mkdirSync(path.dirname(finalDir), { recursive: true })
  let tmp
  try {
    tmp = cloneInto(entry, repoDir, tempDir, opts.gitExec)
    removeRecursively(finalDir)
    fs.mkdirSync(path.dirname(finalDir), { recursive: true })
    fs.renameSync(tmp, finalDir)
  } finally {
    if (tmp && opts.tempDir === undefined) removeRecursively(tmp)
  }
  return { installed: true, enabled: true, dir: finalDir, version: entry.version }
}

function update(entry, repoDir, opts = {}) {
  if (!entry) throw new Error('update: missing catalog entry')
  if (entry.verified === false && opts.verifyOk !== true) {
    throw new Error(`Refusing to update unverified plugin '${entry.id}' — confirm repo URL/tag first`)
  }
  const status = installedStatus(repoDir, entry)
  if (!status.installed) throw new Error(`Plugin '${entry.id}' is not installed — cannot update`)
  const tempDir = opts.tempDir || fs.mkdtempSync(path.join(os.tmpdir(), 'w2gp-catalog-'))
  const finalDir = resolveInstallBase(repoDir, enabledDirName(entry.installPath))
  const backupDir = finalDir + '.old'
  let tmp
  try {
    tmp = cloneInto(entry, repoDir, tempDir, opts.gitExec)
    removeRecursively(backupDir)
    if (fs.existsSync(finalDir)) fs.renameSync(finalDir, backupDir)
    fs.renameSync(tmp, finalDir)
    removeRecursively(backupDir)
  } finally {
    if (tmp && opts.tempDir === undefined) removeRecursively(tmp)
  }
  return { installed: true, enabled: status.enabled, dir: finalDir, version: entry.version }
}

function remove(entry, repoDir) {
  if (!entry) throw new Error('remove: missing catalog entry')
  const enabledDir = resolveInstallBase(repoDir, enabledDirName(entry.installPath))
  const disabledDir = resolveInstallBase(repoDir, disabledDirName(entry.installPath))
  let removed = false
  for (const d of [enabledDir, disabledDir]) {
    if (fs.existsSync(d)) { removeRecursively(d); removed = true }
  }
  if (!removed) throw new Error(`Plugin '${entry.id}' is not installed — cannot remove`)
  return { removed: true }
}

function setEnabled(entry, repoDir, on) {
  if (!entry) throw new Error('toggle: missing catalog entry')
  const enabledDir = resolveInstallBase(repoDir, enabledDirName(entry.installPath))
  const disabledDir = resolveInstallBase(repoDir, disabledDirName(entry.installPath))
  if (on) {
    if (fs.existsSync(disabledDir) && !fs.existsSync(enabledDir)) {
      fs.renameSync(disabledDir, enabledDir)
      return { enabled: true }
    }
    if (!fs.existsSync(enabledDir)) throw new Error(`Plugin '${entry.id}' is not installed`)
    return { enabled: true }
  } else {
    if (fs.existsSync(enabledDir) && !fs.existsSync(disabledDir)) {
      fs.renameSync(enabledDir, disabledDir)
      return { enabled: false }
    }
    if (!fs.existsSync(disabledDir)) throw new Error(`Plugin '${entry.id}' is not installed`)
    return { enabled: false }
  }
}

/**
 * Build the merged list the UI consumes: every catalog entry augmented with
 * its installed/enabled/version state on this machine.
 */
function listCatalog(manifest, repoDir) {
  const m = typeof manifest === 'string' ? parseManifest(manifest) : manifest
  return m.plugins.map((entry) => {
    const st = installedStatus(repoDir, entry)
    return {
      ...entry,
      installed: st.installed,
      enabled: st.enabled,
      installedVersion: st.installed ? entry.version : null,
      updateAvailable: st.installed && entry.verified !== false
    }
  })
}

module.exports = {
  REQUIRED_FIELDS,
  validateManifest,
  parseManifest,
  isInstalled,
  isDisabled,
  installedStatus,
  install,
  update,
  remove,
  setEnabled,
  listCatalog,
  enabledDirName,
  disabledDirName,
  resolveInstallBase,
  cloneInto,
  verifyRepo
}
