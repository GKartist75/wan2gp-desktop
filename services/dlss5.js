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

const DLSS5_FILES = [
  'host/nr-depth-worker.exe',
  'host/dxgi.dll',
  'host/renodx-dlss5.addon64',
  'host/nvngx_dlssnr.dll',
  'dlss/nvngx_dlss.dll',
  'dlssg/nvngx_dlssg.dll',
  'dlssg/dlssg-worker.exe'
]

function dlss5Status(repo) {
  if (!fs.existsSync(path.join(repo, 'wgp.py'))) return { ok: false, error: 'Wan2GP not installed' }
  const present = DLSS5_FILES.filter(f => {
    try { return fs.existsSync(path.join(repo, 'dlss5', f)) } catch { return false }
  })
  return {
    ok: true,
    installed: present.length > 0,
    complete: present.length === DLSS5_FILES.length,
    present: present.length,
    total: DLSS5_FILES.length
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
