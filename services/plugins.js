/**
 * services/plugins.js — Wan2GP plugin management (list / install / update / uninstall / favourites).
 *
 * Port of the Tauri spike's plugins.rs. Mirrors the in-app plugin manager's data
 * model without reimplementing it:
 * - catalog:   <repo>/plugins.json (remote registry: name/author/version/url)
 * - installed: <repo>/plugins/<id>/ (+ plugin_info.json for name/version)
 * - enabled:   `enabled_plugins` in <repo>/wgp_config.json (+ SYSTEM_PLUGINS always on)
 * - refreshed: <repo>/plugins_local.json (fresher metadata fetched from GitHub)
 *
 * Async ops stream progress to the console via deps.send('launch-log'|'setup-output', …).
 * Pure helpers (id parsing, version compare) are offline-testable.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')

const SYSTEM_PLUGINS = ['video_mask_creator', 'guides', 'configuration', 'plugin_manager', 'about']
// Bundled with the Wan2GP repo itself — not uninstallable (upstream: uninstallable=false).
const BUNDLED_PLUGINS = ['downloads', 'media_flow', 'models_manager', 'motion_designer', 'sample']
// Status Pro is a default plugin: installed on fresh setup, kept enabled, not uninstallable.
const STATUS_PRO_ID = 'wan2gp-status-pro'
const STATUS_PRO_URL = 'https://github.com/totideyouover2026-max/wan2gp-status-pro'

// Repo dir name from a git URL (mirrors shared/utils/plugins.py plugin_id_from_url).
function pluginIdFromUrl(url) {
  let t = String(url || '').trim()
  const scp = t.indexOf('github.com:')
  if (scp >= 0) t = 'https://github.com/' + t.slice(scp + 'github.com:'.length)
  t = t.replace(/\/+$/, '')
  if (t.toLowerCase().endsWith('.git')) t = t.slice(0, -4)
  return (t.split('/').pop() || '').trim()
}

function readWgpConfig(repo) {
  try {
    const p = path.join(repo, 'wgp_config.json')
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {}
  return {}
}

function strList(cfg, key) {
  const a = cfg && cfg[key]
  return Array.isArray(a) ? a.filter(e => typeof e === 'string') : []
}

function strField(v, key) {
  return (v && typeof v[key] === 'string') ? v[key] : ''
}

function readLocalCatalog(repo) {
  const map = {}
  try {
    const raw = fs.readFileSync(path.join(repo, 'plugins_local.json'), 'utf8')
    const v = JSON.parse(raw)
    const arr = Array.isArray(v) ? v : [v]
    for (const e of arr) {
      const id = pluginIdFromUrl(strField(e, 'url'))
      if (id) map[id] = e
    }
  } catch {}
  return map
}

function validPluginId(id) {
  return !!id && !id.includes('/') && !id.includes('\\')
}

function pluginsList(repo) {
  if (!fs.existsSync(path.join(repo, 'wgp.py'))) return { ok: false, error: 'Wan2GP not installed' }
  let catalog = []
  try {
    const v = JSON.parse(fs.readFileSync(path.join(repo, 'plugins.json'), 'utf8'))
    if (Array.isArray(v)) catalog = v
  } catch {}
  const cfg = readWgpConfig(repo)
  const enabled = strList(cfg, 'enabled_plugins')
  const localCat = readLocalCatalog(repo)
  // Local scan: every plugins/<dir> with plugin.py or plugin_info.json.
  const local = {} // id -> {name, version, date, author}
  try {
    for (const name of fs.readdirSync(path.join(repo, 'plugins'))) {
      if (name.startsWith('.') || name === '__pycache__') continue
      const dir = path.join(repo, 'plugins', name)
      try {
        if (!fs.statSync(dir).isDirectory()) continue
        if (!fs.existsSync(path.join(dir, 'plugin.py')) && !fs.existsSync(path.join(dir, 'plugin_info.json'))) continue
        let info = { name, version: '', date: '', author: '' }
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(dir, 'plugin_info.json'), 'utf8'))
          if (strField(meta, 'name')) info.name = meta.name
          info.version = strField(meta, 'version')
          info.date = strField(meta, 'date')
          info.author = strField(meta, 'author')
        } catch {}
        local[name] = info
      } catch {}
    }
  } catch {}
  const isSystem = (id) => SYSTEM_PLUGINS.includes(id)
  const groupOf = (id) => (isSystem(id) || BUNDLED_PLUGINS.includes(id)) ? 'system' : 'community'
  const out = []
  const seen = new Set()
  const mergeEntry = (id, c, url) => {
    const l = local[id] || { name: '', version: '', date: '', author: '' }
    let { name, version, date, author } = l
    const r = localCat[id] || {}
    if (strField(r, 'name')) name = r.name
    if (strField(r, 'version')) version = r.version
    if (strField(r, 'date')) date = r.date
    if (!author) author = strField(r, 'author')
    if (!name) name = (c && strField(c, 'name')) || id
    if (!author) author = (c && strField(c, 'author')) || ''
    if (!version) version = (c && strField(c, 'version')) || ''
    const desc = strField(r, 'description') || ((c && strField(c, 'description')) || '')
    if (!date) date = (c && strField(c, 'date')) || ''
    return {
      id, name, author, version, description: desc, date, url: url || '',
      installed: !!local[id],
      enabled: id === STATUS_PRO_ID || isSystem(id) || enabled.includes(id),
      system: isSystem(id),
      locked: id === STATUS_PRO_ID,
      group: groupOf(id),
    }
  }
  for (const c of catalog) {
    const url = strField(c, 'url')
    const id = pluginIdFromUrl(url)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(mergeEntry(id, c, url))
  }
  // Local-only dirs + refreshed-library entries unknown to the shipped catalog.
  const extra = new Set([
    ...Object.keys(local).filter(id => !seen.has(id)),
    ...Object.keys(localCat).filter(id => !seen.has(id) && !local[id]),
  ])
  for (const id of [...extra].sort()) {
    seen.add(id)
    out.push(mergeEntry(id, null, strField(localCat[id] || {}, 'url')))
  }
  return { ok: true, plugins: out }
}

function envPython(deps, repo) {
  try {
    const env = deps.getActiveEnv()
    const py = env && deps.getPythonForEnv(env)
    if (py && fs.existsSync(py)) return py
  } catch {}
  return null
}

function scrubConfigLists(repo, atomicWriteFile, id) {
  const p = path.join(repo, 'wgp_config.json')
  const cfg = readWgpConfig(repo)
  for (const key of ['enabled_plugins', 'installed_remote_plugins', 'pending_plugin_deletions']) {
    cfg[key] = strList(cfg, key).filter(x => x !== id)
  }
  atomicWriteFile(p, JSON.stringify(cfg, null, 4))
}

// Spawn with streamed stdout+stderr to log(); resolves with exit code.
function runStreaming(bin, args, opts, log) {
  return new Promise((resolve) => {
    let proc
    try {
      proc = spawn(bin, args, { windowsHide: true, ...opts })
    } catch (e) {
      log('[!] spawn failed: ' + e.message + '\n')
      resolve(-1)
      return
    }
    proc.stdout && proc.stdout.on('data', (d) => { const s = d.toString(); if (s) log(s) })
    proc.stderr && proc.stderr.on('data', (d) => { const s = d.toString(); if (s) log(s) })
    proc.on('close', (code) => resolve(code))
    proc.on('error', (e) => { log('[!] spawn error: ' + e.message + '\n'); resolve(-1) })
  })
}

async function installRequirements(deps, repo, id, target, log) {
  const req = path.join(target, 'requirements.txt')
  if (!fs.existsSync(req)) return
  const py = envPython(deps, repo)
  if (!py) { log(`[!] No active env python — skipped requirements for ${id}\n`); return }
  log(`[*] Installing ${id} requirements…\n`)
  await runStreaming(py, ['-m', 'pip', 'install', '-r', req],
    { cwd: repo, timeout: 300000, env: { ...process.env, PYTHONUNBUFFERED: '1' } }, log)
}

// Guard-free core: clone (+requirements) + record + enable. Callers hold the
// mutating() guard; ensureFavoritePlugins loops best-effort (never fails setup).
async function installPluginInner(deps, url, log) {
  const id = pluginIdFromUrl(url)
  if (!id) throw new Error('Could not derive a plugin id from that URL')
  const repo = deps.repo()
  const target = path.join(repo, 'plugins', id)
  if (!fs.existsSync(target)) {
    log(`[*] Cloning plugin ${id}…\n`)
    fs.mkdirSync(path.join(repo, 'plugins'), { recursive: true })
    await runStreaming('git', ['clone', '--depth', '1', url, target], { cwd: repo, timeout: 120000 }, log)
    if (!fs.existsSync(target)) throw new Error('git clone failed — check console output')
    await installRequirements(deps, repo, id, target, log)
  } else {
    log(`[*] Plugin ${id} already installed — enabling…\n`)
  }
  // Record + auto-enable in wgp_config.json (mirrors _finish_install_from_url).
  const p = path.join(repo, 'wgp_config.json')
  const cfg = readWgpConfig(repo)
  for (const key of ['installed_remote_plugins', 'enabled_plugins']) {
    const list = strList(cfg, key)
    if (!list.includes(id)) list.push(id)
    cfg[key] = list
  }
  deps.atomicWriteFile(p, JSON.stringify(cfg, null, 4))
  return id
}

// Favourites (desktop-config.json `favoritePlugins: [urls]`) auto-install.
// Called at the end of fresh Install; best-effort per URL, never fails setup.
async function ensureFavoritePlugins(deps) {
  const favs = [STATUS_PRO_URL]
  try {
    const cfg = deps.loadConfig()
    if (Array.isArray(cfg.favoritePlugins))
      for (const u of cfg.favoritePlugins)
        if (typeof u === 'string' && u.trim() && !favs.includes(u.trim())) favs.push(u.trim())
  } catch {}
  const log = (m) => deps.send('setup-output', m)
  log(`[*] Installing ${favs.length} favourite plugin(s)…\n`)
  for (const url of favs) {
    try {
      const id = await installPluginInner(deps, url, log)
      log(`[✓] Favourite plugin ${id} ready.\n`)
    } catch (e) {
      log(`[!] Favourite ${url} failed: ${e.message}\n`)
    }
  }
}

function checkUpdateInner(repo, id) {
  const target = path.join(repo, 'plugins', id)
  if (!fs.existsSync(path.join(target, '.git'))) return { update: false, behind: 0, error: 'not a git checkout' }
  try {
    execSync('git', ['-C', target, 'fetch', 'origin', '--quiet'], { windowsHide: true, timeout: 30000 })
  } catch {
    return { update: false, behind: 0, error: 'fetch failed (offline?)' }
  }
  try {
    const out = execSync('git', ['-C', target, 'rev-list', '--count', 'HEAD..@{u}'], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
    const n = parseInt(String(out).trim(), 10) || 0
    return { update: n > 0, behind: n, error: null }
  } catch (e) {
    return { update: false, behind: 0, error: e.message }
  }
}

async function pluginUpdate(deps, id, log) {
  const repo = deps.repo()
  const target = path.join(repo, 'plugins', id)
  if (!fs.existsSync(path.join(target, '.git'))) throw new Error('Not a git checkout — cannot update')
  log(`[*] Updating plugin ${id}…\n`)
  await runStreaming('git', ['-C', target, 'pull', '--ff-only'], { cwd: repo, timeout: 120000 }, log)
  await installRequirements(deps, repo, id, target, log)
  log(`[✓] Plugin ${id} updated — restart Wan2GP to load it.\n`)
  return id
}

function pluginUninstall(deps, id) {
  if (SYSTEM_PLUGINS.includes(id) || BUNDLED_PLUGINS.includes(id)) throw new Error('System/bundled plugins cannot be uninstalled')
  const repo = deps.repo()
  const target = path.join(repo, 'plugins', id)
  if (!fs.existsSync(target)) throw new Error('Not installed')
  try {
    fs.rmSync(target, { recursive: true, force: true })
  } catch (e) {
    // Files may be locked (Wan2GP running) — mirror upstream pending_plugin_deletions.
    const p = path.join(repo, 'wgp_config.json')
    const cfg = readWgpConfig(repo)
    const list = strList(cfg, 'pending_plugin_deletions')
    if (!list.includes(id)) list.push(id)
    cfg.pending_plugin_deletions = list
    deps.atomicWriteFile(p, JSON.stringify(cfg, null, 4))
    return { ok: true, id, pending: true, hint: `Files locked (${e.message}) — will delete on next Wan2GP start. Disabled now.` }
  }
  scrubConfigLists(repo, deps.atomicWriteFile, id)
  return { ok: true, id }
}

function splitGithubRepo(url) {
  let t = String(url || '').trim()
  if (!t) return null
  const q = t.search(/[?#]/)
  if (q >= 0) t = t.slice(0, q)
  if (t.startsWith('git@github.com:')) t = 'https://github.com/' + t.slice('git@github.com:'.length)
  t = t.replace(/\/+$/, '')
  const idx = t.toLowerCase().indexOf('github.com/')
  if (idx < 0) return null
  const parts = t.slice(idx + 'github.com/'.length).split('/').filter(Boolean)
  if (parts.length < 2) return null
  let name = parts[1]
  if (name.toLowerCase().endsWith('.git')) name = name.slice(0, -4)
  if (!parts[0] || !name) return null
  return [parts[0], name]
}

// Numeric-aware version tokens; date (ISO) is compared first by releaseNewer.
function versionTokens(v) {
  const out = []
  let cur = '', curNum = true
  const flush = () => {
    if (!cur) return
    out.push(curNum ? { n: parseInt(cur, 10) || 0 } : { s: cur.toLowerCase() })
    cur = ''
  }
  for (const ch of String(v || '')) {
    if (/[A-Za-z0-9]/.test(ch)) {
      const isNum = /[0-9]/.test(ch)
      if (cur && isNum !== curNum) { flush(); curNum = isNum }
      else if (!cur) curNum = isNum
      cur += ch
    } else if (cur) { flush(); cur = '' }
  }
  flush()
  return out
}

// Port of compare_release_metadata: date first (ISO strings sort chronologically), then version.
function releaseNewer(remote, local) {
  const rd = strField(remote, 'date'), ld = strField(local, 'date')
  if (rd || ld) return rd > ld
  const rv = versionTokens(strField(remote, 'version')), lv = versionTokens(strField(local, 'version'))
  const n = Math.max(rv.length, lv.length)
  for (let i = 0; i < n; i++) {
    const a = rv[i], b = lv[i]
    if (a === undefined) return false // remote shorter → not newer
    if (b === undefined) return true
    const an = a.n !== undefined, bn = b.n !== undefined
    if (an && bn) { if (a.n !== b.n) return a.n > b.n }
    else if (!an && !bn) { if (a.s !== b.s) return a.s > b.s }
    else return bn // Num < Str (upstream derived order): remote newer only if its token is the string
  }
  return false
}

async function fetchJson(url, timeoutMs = 10000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'wan2gp-desktop' } })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

async function pluginRefreshCatalog(deps, log) {
  const repo = deps.repo()
  if (!fs.existsSync(path.join(repo, 'wgp.py'))) throw new Error('Wan2GP not installed — run Install first')
  // Targets: shipped catalog urls + refreshed-library urls + installed git remotes.
  const targets = {} // id -> url
  try {
    const v = JSON.parse(fs.readFileSync(path.join(repo, 'plugins.json'), 'utf8'))
    if (Array.isArray(v)) for (const e of v) {
      const id = pluginIdFromUrl(strField(e, 'url'))
      if (id && !targets[id]) targets[id] = e.url
    }
  } catch {}
  const localMap = readLocalCatalog(repo)
  for (const [id, e] of Object.entries(localMap)) {
    const u = strField(e, 'url')
    if (u && !targets[id]) targets[id] = u
  }
  try {
    for (const name of fs.readdirSync(path.join(repo, 'plugins'))) {
      const dir = path.join(repo, 'plugins', name)
      try {
        if (!fs.statSync(dir).isDirectory() || !fs.existsSync(path.join(dir, '.git'))) continue
        const out = execSync('git', ['-C', dir, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim()
        if (out && !targets[name]) targets[name] = out
      } catch {}
    }
  } catch {}
  const ids = Object.keys(targets).sort()
  log(`[*] Refreshing plugin library (${ids.length} source(s))…\n`)
  let checked = 0, updated = 0, avail = 0
  for (const id of ids) {
    const split = splitGithubRepo(targets[id])
    if (!split) continue
    checked++
    const meta = await fetchJson(`https://github.com/${split[0]}/${split[1]}/raw/HEAD/plugin_info.json`)
    if (!meta || typeof meta !== 'object') continue
    const entry = {
      name: strField(meta, 'name'), author: strField(meta, 'author'),
      version: strField(meta, 'version'), description: strField(meta, 'description'),
      type: meta.type !== undefined ? meta.type : ['app'],
      date: strField(meta, 'date'), wan2gp_version: strField(meta, 'wan2gp_version'),
      url: targets[id], last_check: new Date().toISOString(),
    }
    try {
      const cur = JSON.parse(fs.readFileSync(path.join(repo, 'plugins', id, 'plugin_info.json'), 'utf8'))
      if (releaseNewer(entry, cur)) avail++
    } catch {
      if (localMap[id] && releaseNewer(entry, localMap[id])) avail++
    }
    localMap[id] = entry
    updated++
  }
  if (updated > 0) {
    const arr = Object.values(localMap).sort((a, b) => strField(a, 'name').toLowerCase() < strField(b, 'name').toLowerCase() ? -1 : 1)
    deps.atomicWriteFile(path.join(repo, 'plugins_local.json'), JSON.stringify(arr, null, 4))
  }
  log(`[✓] Library refreshed: ${checked} checked, ${updated} updated, ${avail} update(s) available.\n`)
  return { ok: true, checked, updated, updates_available: avail }
}

module.exports = {
  SYSTEM_PLUGINS, BUNDLED_PLUGINS,
  pluginIdFromUrl, readWgpConfig, strList, strField, readLocalCatalog,
  validPluginId, splitGithubRepo, versionTokens, releaseNewer,
  pluginsList, scrubConfigLists, checkUpdateInner,
  installPluginInner, installRequirements, ensureFavoritePlugins,
  pluginUpdate, pluginUninstall, pluginRefreshCatalog,
}
