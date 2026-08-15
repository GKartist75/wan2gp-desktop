/**
 * Settings repair — launcher-side fix for Wan2GP's
 * "Value: N is not in the list of choices: [0, 1]" error (issue #7).
 *
 * Scans models/_settings.json + every *_settings.json in the install dir and
 * clamps dropdown values that fall outside the choices Wan2GP accepts. A stale
 * value (e.g. 2 from an older version or imported settings) makes Gradio reject
 * the ENTIRE form on save — this is the launcher-side fix for the core-side
 * dropdown bug (upstream PR #2088 was withdrawn).
 *
 * Pure fs logic, no Electron — kept in a separate module so the test suite
 * (tests/settings-repair.test.js) exercises the exact same code main.js uses.
 *
 * @module settings-repair
 */

const fs = require('fs')
const path = require('path')

/** key: [allowed values] — must match wgp.py's dropdown choices */
const DROPDOWN_CLAMPS = {
  apg_switch: [0, 1],
  cfg_star_switch: [0, 1],
  multi_images_gen_type: [0, 1]
}

/**
 * Clamp out-of-range dropdown values in a single settings file.
 * Backs the file up as <name>.bak-repair before editing.
 *
 * @param {string} filePath absolute path to the *_settings.json file
 * @returns {{file: string, fixed?: number, backup?: string, error?: string}}
 */
function clampSettingsFile(filePath) {
  let raw
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch { return { file: filePath, error: 'unreadable' } }
  let obj
  try {
    // Strip a UTF-8 BOM if present — JSON.parse throws on \uFEFF, which made
    // BOM-prefixed settings files silently skip repair as 'invalid-json'.
    obj = JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch {
    return { file: filePath, error: 'invalid-json' }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { file: filePath, error: 'invalid-shape' }
  }
  const backupPath = filePath + '.bak-repair'
  let changed = 0
  for (const [key, allowed] of Object.entries(DROPDOWN_CLAMPS)) {
    if (key in obj && !allowed.includes(obj[key])) {
      // If it's a choice tuple list, also walk nested {label, value} shapes
      if (Array.isArray(obj[key])) {
        obj[key].forEach(entry => {
          if (entry && typeof entry === 'object' && 'value' in entry && !allowed.includes(entry.value)) {
            entry.value = allowed[0]; changed++
          }
        })
        continue
      }
      obj[key] = allowed[0]
      changed++
    }
  }
  if (changed === 0) return { file: filePath, fixed: 0 }
  // Preserve original EOL style; write atomically-ish
  try {
    if (!fs.existsSync(backupPath)) fs.copyFileSync(filePath, backupPath)
    const eol = raw.includes('\r\n') ? '\r\n' : '\n'
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2).replace(/\n/g, eol), 'utf8')
    return { file: filePath, fixed: changed, backup: backupPath }
  } catch (e) {
    return { file: filePath, error: e.message }
  }
}

/**
 * Collect every settings file worth scanning under a Wan2GP repo:
 *   - models/_settings.json (default UI state)
 *   - models/*_settings.json (per-model-type UI state)
 *   - settings/*_settings.json (per-finetune settings in newer core versions)
 *   - finetunes/ (recursive) per-finetune settings kept by the finetune-manager
 *
 * @param {string} repo Wan2GP repo root
 * @returns {string[]} absolute paths, empty if nothing found
 */
function collectSettingsFiles(repo) {
  const files = []
  const modelsDir = path.join(repo, 'models')
  if (fs.existsSync(path.join(modelsDir, '_settings.json'))) files.push(path.join(modelsDir, '_settings.json'))
  try {
    if (fs.existsSync(modelsDir)) {
      for (const f of fs.readdirSync(modelsDir)) {
        if (f.endsWith('_settings.json') && f !== '_settings.json') files.push(path.join(modelsDir, f))
      }
    }
  } catch {}
  const settingsDir = path.join(repo, 'settings')
  try {
    if (fs.existsSync(settingsDir)) {
      for (const f of fs.readdirSync(settingsDir)) {
        if (f.endsWith('_settings.json')) files.push(path.join(settingsDir, f))
      }
    }
  } catch {}
  const finetunesDir = path.join(repo, 'finetunes')
  try {
    if (fs.existsSync(finetunesDir)) {
      const walk = (dir) => {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, f.name)
          if (f.isDirectory()) walk(p)
          else if (f.name.endsWith('_settings.json')) files.push(p)
        }
      }
      walk(finetunesDir)
    }
  } catch {}
  return files
}

/**
 * Detect and repair model paths that resolve INSIDE the Wan2GP repo itself
 * (issue #18 — "error in getting the location": a stale entry like
 * "./Wan2GP/ckpts" or an absolute path under <repo>\Wan2GP\ makes models land
 * in a doubly-nested folder and the HF downloader then fails with
 * [WinError 3] The system cannot find the path specified).
 *
 * Wan2GP resolves relative entries against the repo root, so any configured
 * path that resolves under <repo>/Wan2GP is almost certainly wrong — it gets
 * replaced with the launcher's standard data-dir location. Only clearly
 * nested entries are touched; everything else is left alone. Config is backed
 * up as wgp_config.json.bak-repair before the first rewrite.
 *
 * @param {string} repo    Wan2GP repo root
 * @param {string} dataDir Launcher data dir (default model home)
 * @returns {{ fixed: boolean, replacements: Array<{key:string, from:string, to:string}>, error?: string }}
 */
function repairNestedModelPaths(repo, dataDir) {
  if (!repo) return { fixed: false, replacements: [] }
  const cfgPath = path.join(repo, 'wgp_config.json')
  if (!fs.existsSync(cfgPath)) return { fixed: false, replacements: [] }
  let cfg
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
  } catch {
    return { fixed: false, replacements: [] }
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { fixed: false, replacements: [] }

  const nestedRoot = path.join(repo, 'Wan2GP')
  const home = dataDir || repo
  // Windows filesystems are case-insensitive: a config entry pointing at
  // "./wan2gp/ckpts" (lowercase) resolves to the same nested folder and is
  // exactly the issue-#18 failure mode — compare case-insensitively there.
  const caseInsensitive = process.platform === 'win32'
  const norm = (p) => caseInsensitive ? p.toLowerCase() : p
  const MAP = {
    checkpoints_paths: { default: path.join(home, 'ckpt'), isList: true },
    loras_root: { default: path.join(home, 'lora'), isList: false },
    save_path: { default: path.join(home, 'outputs'), isList: false },
    image_save_path: { default: path.join(home, 'outputs'), isList: false },
    audio_save_path: { default: path.join(home, 'outputs'), isList: false }
  }
  const isNested = (p) => {
    if (typeof p !== 'string' || !p) return false
    const abs = path.isAbsolute(p) ? path.normalize(p) : path.resolve(repo, p)
    const cmp = norm(abs)
    const root = norm(nestedRoot)
    return cmp === root || cmp.startsWith(root + path.sep) || cmp.startsWith(root + '/')
  }

  const replacements = []
  for (const [key, spec] of Object.entries(MAP)) {
    if (!(key in cfg)) continue
    if (spec.isList) {
      if (!Array.isArray(cfg[key])) continue
      cfg[key] = cfg[key].map(p => {
        if (!isNested(p)) return p
        replacements.push({ key, from: p, to: spec.default })
        return spec.default
      })
    } else {
      if (!isNested(cfg[key])) continue
      replacements.push({ key, from: cfg[key], to: spec.default })
      cfg[key] = spec.default
    }
  }
  if (!replacements.length) return { fixed: false, replacements: [] }

  try {
    const raw = fs.readFileSync(cfgPath, 'utf8')
    const backupPath = cfgPath + '.bak-repair'
    if (!fs.existsSync(backupPath)) fs.copyFileSync(cfgPath, backupPath)
    const eol = raw.includes('\r\n') ? '\r\n' : '\n'
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2).replace(/\n/g, eol), 'utf8')
    return { fixed: true, replacements, backup: backupPath }
  } catch (e) {
    return { fixed: false, replacements, error: e.message }
  }
}

module.exports = { DROPDOWN_CLAMPS, clampSettingsFile, collectSettingsFiles, repairNestedModelPaths }
