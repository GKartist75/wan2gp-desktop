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

// Pinned manifest mirrors upstream scripts/install_dlss5.ps1 (labels + download SHA-256).
// ponytail: the backend owns labels/SHAs so the panel can't go stale like the old hardcoded frontend copy.
const DLSS5_PKGS = [
  { id: 'workers', label: 'Workers v1.1.3', sha: 'EC470D8EB990CC04FE142C037B2F9E84C1D59A70B111DF51F110767897F5B0C2', files: ['host/nr-depth-worker.exe', 'host/nvngx.dll', 'dlssg/dlssg-worker.exe'] },
  { id: 'reshade', label: 'ReShade 6.8.0', sha: 'AFE4C8F13048306307983B8B3D41D5BF00A86820440B0E57DEA10950E1176445', files: ['host/dxgi.dll'] },
  { id: 'renodx', label: 'RenoDX DLSS5 4.70', sha: 'D6E356D01B429AF6288F488A4926C44F1D779A7D4586EE8C79D04D3A09A536E6', files: ['host/renodx-dlss5.addon64'] },
  { id: 'dlssnr', label: 'DLSSNR 310.8.SF-v2', sha: '1DA35941894994EB087E017577829E492454E9BAE3A6A9397027069CEB74955C', files: ['host/nvngx_dlssnr.dll'] },
  { id: 'dlss', label: 'DLSS Super Resolution 310.8.0', sha: 'FB481660F7E952B87F91760E3AFD7F9DC14CD2C3361B470E948D6346E4323009', files: ['dlss/nvngx_dlss.dll'] },
  { id: 'dlssg', label: 'DLSS Frame Generation 310.7.0', sha: 'BFA977FB4451718C7D4A2217518DFC1AD30D77CE0EA026253C82BE96F5B9D35A', files: ['dlssg/nvngx_dlssg.dll'] }
]

const DLSS5_FILES = DLSS5_PKGS.flatMap(p => p.files)

function dlss5Status(repo) {
  if (!fs.existsSync(path.join(repo, 'wgp.py'))) return { ok: false, error: 'Wan2GP not installed' }
  const dlss5dir = path.join(repo, 'dlss5')
  let present = 0, total = 0
  const packages = DLSS5_PKGS.map(p => {
    const n = p.files.filter(f => {
      try { return fs.existsSync(path.join(dlss5dir, f)) } catch { return false }
    }).length
    present += n; total += p.files.length
    return { id: p.id, label: p.label, sha: p.sha, installed: n === p.files.length, present: n, total: p.files.length }
  })
  return {
    ok: true,
    installed: present > 0,
    complete: present === total,
    present,
    total,
    packages
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
