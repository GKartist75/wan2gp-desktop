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
    obj = JSON.parse(raw)
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

module.exports = { DROPDOWN_CLAMPS, clampSettingsFile, collectSettingsFiles }
