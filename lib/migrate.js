'use strict'
// Pure (electron-free) migration helpers, extracted so they can be unit-tested
// without booting the Electron main process. These power the "Migrate to new
// location" flow that moves a legacy roaming AppData Wan2GP install to a
// dedicated folder such as C:\Wan2GP.
const fs = require('fs')
const path = require('path')

// Total size (bytes) of a directory tree, best-effort (locked/unreadable
// entries are skipped so a single bad file doesn't abort the scan).
function getDirSize(dir) {
  let total = 0
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) total += getDirSize(p)
      else { try { total += fs.statSync(p).size } catch {} }
    }
  } catch {}
  return total
}

// Move the CONTENTS of src into dst (not the src folder itself), so a legacy
// `Roaming\wan2gp-desktop` (or `...\Wan2GP`) merges into `C:\Wan2GP` WITHOUT
// creating a nested C:\Wan2GP\Wan2GP. Same-volume renames ignore file locks and
// are instant even for huge model folders. `onProgress(pct)` is called only on
// the SLOW copy-fallback path (cross-volume or a rename the FS rejected), so
// users with many GB of models still see movement instead of a frozen button.
function mergeDirContents(src, dst, onProgress) {
  try {
    fs.mkdirSync(dst, { recursive: true })
    const items = fs.readdirSync(src)
    if (items.length === 0) { fs.rmSync(src, { recursive: true, force: true }); return true }
    const toCopy = []
    let moved = 0
    for (const name of items) {
      const s = path.join(src, name)
      const d = path.join(dst, name)
      if (fs.existsSync(d)) continue // don't clobber existing target item
      try { fs.renameSync(s, d); moved++ } // instant metadata move (same volume)
      catch { toCopy.push({ s, d }) }      // rename rejected → needs a real copy
    }
    // Fast path: everything relocated via instant rename.
    if (toCopy.length === 0) {
      try { fs.rmSync(src, { recursive: true, force: true }) } catch {}
      return true
    }
    // Slow path: copy the rejected items with byte-based progress. A locked/
    // unreadable file is skipped (filter returns false) rather than aborting.
    let totalBytes = 0
    for (const it of toCopy) totalBytes += getDirSize(it.s)
    let copied = 0
    for (const it of toCopy) {
      try {
        fs.cpSync(it.s, it.d, {
          recursive: true,
          filter: (p) => {
            try {
              const st = fs.statSync(p)
              if (st.isFile()) {
                copied += st.size
                if (onProgress && totalBytes > 0)
                  onProgress(Math.min(99, Math.round((copied / totalBytes) * 100)))
              }
              return true
            } catch { return false } // unreadable/locked — skip this file
          }
        })
        try { fs.rmSync(it.s, { recursive: true, force: true }) } catch {}
      } catch (e) { /* logError('mergeDirContents-copy', e) */ }
    }
    return true
  } catch (e) { /* logError('mergeDirContents', e) */ return false }
}

// Lift a doubled-up repo: when the repo landed at <target>/Wan2GP/wgp.py but
// <target>/wgp.py is free, move everything up so the repo sits flat at <target>.
function flattenRepo(target) {
  try {
    const nested = path.join(target, 'Wan2GP')
    const nestedPy = path.join(nested, 'wgp.py')
    const flatPy = path.join(target, 'wgp.py')
    if (fs.existsSync(nestedPy) && !fs.existsSync(flatPy)) {
      for (const name of fs.readdirSync(nested)) {
        const s = path.join(nested, name)
        const d = path.join(target, name)
        if (fs.existsSync(d)) continue // don't clobber existing target item
        try { fs.renameSync(s, d) } catch { /* skip locked */ }
      }
      const leftover = fs.readdirSync(nested)
      if (leftover.length === 0) fs.rmSync(nested, { recursive: true, force: true })
    }
  } catch (e) { /* logError('migrate-flatten', e) */ }
}

// Rewrite the model-folder paths in wgp_config.json to the user's chosen
// locations. Picks the actual config location (flat or nested) after a move.
function rewriteModelPaths(target, choices) {
  try {
    const flatCfg = path.join(target, 'wgp_config.json')
    const nestedCfg = path.join(target, 'Wan2GP', 'wgp_config.json')
    const configPath = fs.existsSync(flatCfg) ? flatCfg
      : fs.existsSync(nestedCfg) ? nestedCfg
      : path.join(target, 'wgp_config.json')
    let cfg = {}
    try { if (fs.existsSync(configPath)) cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch {}
    if (choices.ckpts) cfg.checkpoints_paths = [choices.ckpts, '.']
    if (choices.loras) cfg.loras_root = choices.loras
    if (choices.output) { cfg.save_path = choices.output; cfg.image_save_path = choices.output; cfg.audio_save_path = choices.output }
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2))
    return true
  } catch (e) { /* logError('migrate-config', e) */ return false }
}

// After the data dir is migrated into `target` (e.g. C:\Wan2GP), mergeDirContents
// has moved the whole legacy tree — including the user's real checkpoints/LoRAs/
// outputs — into `target`. But the model paths are rewritten to the user's chosen
// destinations (choices.ckpts/loras/output, e.g. C:\Wan2GP-Models\ckpts…), so the
// bytes and wgp_config.json disagree and Wan2GP sees nothing / re-downloads
// (issue #74). Close the gap: for each model folder that physically landed in
// `target`, move it to the matching chosen destination. Best-effort and idempotent
// (skips a folder whose destination already exists, i.e. when data dir == models
// dir or the move already happened).
function reconcileModelFolders(target, choices) {
  if (!target || !choices) return false
  const map = [['ckpts', choices.ckpts], ['loras', choices.loras], ['outputs', choices.output]]
  let touched = false
  try {
    for (const [name, dst] of map) {
      if (!dst) continue
      const s = path.join(target, name)
      if (fs.existsSync(s) && !fs.existsSync(dst)) {
        try { fs.mkdirSync(path.dirname(dst), { recursive: true }); mergeDirContents(s, dst); touched = true } catch { /* leave in place on failure */ }
      }
    }
    return touched
  } catch (e) { /* logError('reconcileModelFolders', e) */ return touched }
}

module.exports = { getDirSize, mergeDirContents, flattenRepo, rewriteModelPaths, reconcileModelFolders }
