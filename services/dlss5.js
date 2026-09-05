/**
 * services/dlss5.js — optional DLSS5 runtime status + output classifier.
 *
 * Port of the Tauri spike's dlss5_status / install_dlss5 / dlss5_classify.
 * Runs Wan2GP's own scripts/install_dlss5.ps1 (upstream owns integrity:
 * pinned SHA-256 + NVIDIA sig check); this only probes dlss5/ for the verdict
 * and mirrors the script's Downloading / verified / Installed lines into
 * checklist events for the UI. Pure + offline-testable; the caller passes
 * repo + spawn/send.
 */
'use strict'

const fs = require('fs')
const path = require('path')

// Pinned manifest mirrors upstream scripts/install_dlss5.ps1: one row per installed
// file (path, package id, version, expected file SHA-256).
// ponytail: the backend owns versions/SHAs so the panel can't go stale like the old hardcoded frontend copy.
const DLSS5_FILES = [
  { path: 'host/nr-depth-worker.exe', pkg: 'workers', version: 'Workers v1.1.3', sha: 'F8E2967912E5D596E8E36049370487B83620B0CB5845937B681CF835BAFC6D0B' },
  { path: 'host/nvngx.dll', pkg: 'workers', version: 'Workers v1.1.3', sha: '58191F4D38288C6BFBDA47EF56911D32052A9789E65714F4583F426E01464638' },
  { path: 'dlssg/dlssg-worker.exe', pkg: 'workers', version: 'Workers v1.1.3', sha: 'D93084633E0AAB4A08C43A5EE240176716EF73D87F06F35C2293509FBFC8BD00' },
  { path: 'host/dxgi.dll', pkg: 'reshade', version: 'ReShade 6.8.0', sha: '0CEE63F9C9F13F3AC909C5B4903F4DBB4B719A7AB3B4F13B0DEAF83C814B94F7' },
  { path: 'host/renodx-dlss5.addon64', pkg: 'renodx', version: 'RenoDX DLSS5 4.70', sha: 'D5ADF82EB44B065F4C590AC91FE824BAB07AFEA0EB9F994BDE936710C8593952' },
  { path: 'host/nvngx_dlssnr.dll', pkg: 'dlssnr', version: 'DLSSNR 310.8.SF-v2', sha: '6EB209E764F39872625DEBD6ABAF45E2BB6322F6F270F781F70C059AE30B3927' },
  { path: 'dlss/nvngx_dlss.dll', pkg: 'dlss', version: 'DLSS Super Resolution 310.8.0', sha: 'C85F971CE023C9F3492FC7455F0B01A24BA18EA39636407A846902C4360B0B7E' },
  { path: 'dlssg/nvngx_dlssg.dll', pkg: 'dlssg', version: 'DLSS Frame Generation 310.7.0', sha: '135EAF0733C1E37381A8C28ABCF7A862404A54132B81787C04E35D09EFC5E36F' }
]

function dlss5Status(repo) {
  if (!fs.existsSync(path.join(repo, 'wgp.py'))) return { ok: false, error: 'Wan2GP not installed' }
  const dlss5dir = path.join(repo, 'dlss5')
  const files = DLSS5_FILES.map(f => {
    let ok = false
    try { ok = fs.existsSync(path.join(dlss5dir, f.path)) } catch { ok = false }
    return { id: f.path, pkg: f.pkg, version: f.version, sha: f.sha, installed: ok }
  })
  const present = files.filter(f => f.installed).length
  return {
    ok: true,
    installed: present > 0,
    complete: present === files.length,
    present,
    total: files.length,
    files
  }
}

function dlss5Pkg(name) {
  const n = String(name || '').toLowerCase()
  if (n.includes('workers')) return 'workers'
  if (n.includes('reshade')) return 'reshade'
  if (n.includes('renodx')) return 'renodx'
  if (n.includes('dlssnr')) return 'dlssnr'
  if (n.includes('frame generation')) return 'dlssg'
  if (n.includes('super resolution')) return 'dlss'
  return 'other'
}

// Classify one stdout/stderr chunk into checklist events (array, possibly empty).
function dlss5ClassifyChunk(chunk) {
  const events = []
  for (const raw of String(chunk || '').split('\n')) {
    const t = raw.trim().replace(/\.+$/, '').trim()
    if (!t) continue
    let ev = null
    if (t.startsWith('Downloading ')) {
      const name = t.slice('Downloading '.length).trim()
      ev = { phase: 'downloading', pkg: dlss5Pkg(name), label: name }
    } else if (t.startsWith('verified ')) {
      ev = { phase: 'verified', sha: t.slice('verified '.length).trim() }
    } else if (t.startsWith('Installed: ')) {
      ev = { phase: 'installed', path: t.slice('Installed: '.length).trim() }
    } else if (t.startsWith('Already installed: ')) {
      ev = { phase: 'present', path: t.slice('Already installed: '.length).trim() }
    } else if (t.includes('DLSS 5 components are installed')) {
      ev = { phase: 'done' }
    }
    if (ev) events.push(ev)
  }
  return events
}

module.exports = { DLSS5_FILES, dlss5Status, dlss5ClassifyChunk }
