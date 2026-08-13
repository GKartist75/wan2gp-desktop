/**
 * Gallery service — native Wan2GP output browser for the Desktop Launcher.
 *
 * Wan2GP writes generations into an output directory (wgp_config.json `savePath`,
 * default `outputs/`) as media files plus a same-basename `.json` metadata
 * sidecar (prompt, params, model, seed, etc.). This module turns that on-disk
 * layout into a browsable list and builds the command to join a folder of
 * sequential frames into an MP4 (the "join video frames" feature of File Gallery).
 *
 * Pure, offline-testable (no Electron deps). ffmpeg execution itself happens in
 * main.js (where the Python env / imageio-ffmpeg binary is resolvable); this
 * module only builds the command + parses metadata.
 */

'use strict'

const fs = require('fs')
const path = require('path')

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'])
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi'])
const FRAME_RE = /^.*[-_]?(\d{3,6})\.(png|jpg|jpeg|webp|bmp|gif)$/i

function isImage(ext) { return IMAGE_EXT.has(ext.toLowerCase()) }
function isVideo(ext) { return VIDEO_EXT.has(ext.toLowerCase()) }

/**
 * Resolve the list of output directories to scan.
 * @param {object} opts
 * @param {string} opts.repoDir        Wan2GP repo dir (e.g. data-dir/Wan2GP)
 * @param {string} [opts.savePath]     wgp_config.json savePath (may be relative to repo or absolute)
 * @returns {string[]} absolute dirs that exist
 */
function resolveOutputDirs({ repoDir, savePath } = {}) {
  const candidates = []
  if (savePath) {
    candidates.push(path.isAbsolute(savePath) ? savePath : path.join(repoDir || '', savePath))
  }
  candidates.push(path.join(repoDir || '', 'outputs'))
  candidates.push(path.join(repoDir || '', 'output'))
  const seen = new Set()
  const out = []
  for (const c of candidates) {
    const abs = path.resolve(c)
    if (seen.has(abs)) continue
    seen.add(abs)
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) out.push(abs)
  }
  return out
}

/**
 * Read metadata sidecar for a media file, if present.
 * @returns {object|null} parsed JSON or null
 */
function readSidecar(mediaPath) {
  const jsonPath = mediaPath.replace(/\.[^.]+$/, '.json')
  if (!fs.existsSync(jsonPath)) return null
  try { return JSON.parse(fs.readFileSync(jsonPath, 'utf8')) } catch { return null }
}

/**
 * Normalize a Wan2GP sidecar into a flat, display-friendly metadata object.
 * Wan2GP sidecars vary; we defensively pull common fields.
 */
function normalizeMeta(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const out = {}
  if (typeof raw.prompt === 'string') out.prompt = raw.prompt
  if (typeof raw.negative_prompt === 'string') out.negative_prompt = raw.negative_prompt
  if (raw.params && typeof raw.params === 'object') {
    for (const [k, v] of Object.entries(raw.params)) out[k] = v
  }
  if (typeof raw.model === 'string') out.model = raw.model
  if (typeof raw.seed !== 'undefined') out.seed = raw.seed
  if (typeof raw.steps !== 'undefined') out.steps = raw.steps
  if (typeof raw.width !== 'undefined') out.width = raw.width
  if (typeof raw.height !== 'undefined') out.height = raw.height
  if (typeof raw.fps !== 'undefined') out.fps = raw.fps
  if (typeof raw.created_at === 'string') out.created_at = raw.created_at
  if (typeof raw.type === 'string') out.type = raw.type
  return out
}

/**
 * Scan output dirs and return a list of media items with metadata.
 * @param {object} opts { repoDir, savePath, recursive=true }
 */
function scanOutputs({ repoDir, savePath, recursive = true } = {}) {
  const dirs = resolveOutputDirs({ repoDir, savePath })
  const items = []
  const walk = (dir) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (recursive && e.name !== 'temp' && !e.name.startsWith('.')) walk(full)
        continue
      }
      const ext = path.extname(e.name).toLowerCase()
      const isMedia = isImage(ext) || isVideo(ext)
      if (e.name.startsWith('frame') && FRAME_RE.test(e.name)) {
        // candidate frame — skip here, handled by collectFrames
        continue
      }
      if (!isMedia) continue
      const stat = safeStat(full)
      const meta = readSidecar(full)
      items.push({
        name: e.name,
        path: full,
        dir: dir,
        type: isVideo(ext) ? 'video' : 'image',
        ext,
        sizeBytes: stat ? stat.size : 0,
        mtime: stat ? stat.mtimeMs : 0,
        metadata: normalizeMeta(meta),
        hasSidecar: meta !== null
      })
    }
  }
  for (const d of dirs) walk(d)
  items.sort((a, b) => b.mtime - a.mtime)
  return items
}

function safeStat(p) {
  try { return fs.statSync(p) } catch { return null }
}

/**
 * Collect an ordered list of frame files from a folder (e.g. File Gallery's
 * "join frames" feature). Frames are named like frame_0001.png / frame_0002.png.
 * @param {string} folder
 * @returns {{ frames: string[], count: number, fps: number, width?: number, height?: number }}
 */
function collectFrames(folder, fps = 24) {
  let entries
  try { entries = fs.readdirSync(folder) } catch { return { frames: [], count: 0, fps } }
  const frames = entries
    .filter((n) => FRAME_RE.test(n))
    .sort((a, b) => {
      const na = parseInt((a.match(FRAME_RE) || [])[1] || '0', 10)
      const nb = parseInt((b.match(FRAME_RE) || [])[1] || '0', 10)
      return na - nb
    })
    .map((n) => path.join(folder, n))
  return { frames, count: frames.length, fps }
}

/**
 * Build an ffmpeg command to join frames into an MP4.
 * Uses imageio-ffmpeg's bundled binary by default (no system ffmpeg needed).
 * @param {object} opts { folder, outName, fps, ffmpegPath, crf }
 * @returns {{ cmd: string, args: string[], outPath: string } | { error: string }}
 */
function buildJoinCommand({ folder, outName = 'joined.mp4', fps = 24, ffmpegPath = 'ffmpeg', crf = 18 } = {}) {
  if (!fs.existsSync(folder)) return { error: 'Folder does not exist: ' + folder }
  const { frames, count } = collectFrames(folder, fps)
  if (count < 2) return { error: `Need at least 2 frames to join (found ${count})` }
  // ffmpeg glob input: frame_%04d.png — derive the pattern from the first frame.
  const first = path.basename(frames[0])
  const m = first.match(/^(.*?)(\d{3,6})(\.[^.]+)$/)
  if (!m) return { error: 'Frame names do not contain a numeric index' }
  const prefix = m[1]
  const ext = m[3]
  const pad = m[2].length
  const pattern = `${prefix}%0${pad}d${ext}`
  const outPath = path.join(folder, outName)
  const args = [
    '-y',
    '-framerate', String(fps),
    '-i', pattern,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', String(crf),
    outPath
  ]
  return { cmd: ffmpegPath, args, outPath, pattern }
}

module.exports = {
  IMAGE_EXT, VIDEO_EXT, FRAME_RE,
  resolveOutputDirs,
  readSidecar,
  normalizeMeta,
  scanOutputs,
  collectFrames,
  buildJoinCommand,
  isImage,
  isVideo
}
