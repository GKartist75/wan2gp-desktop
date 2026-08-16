/**
 * Queue Notifier — detect Wan2GP generation events from the launch-log stream and
 * build notification payloads for external delivery (Apprise: Telegram / Discord /
 * WhatsApp / IFTTT / Google Chat).
 *
 * This module is PURE and offline-testable: it only parses log lines into event
 * objects and builds message text. Actual delivery (Apprise CLI) lives in main.js,
 * where the Python env + apprise binary are resolvable.
 *
 * Wan2GP (Gradio) does not emit a single canonical "task done" line, so we match a
 * set of known markers from its console output:
 *   - completion: "Task completed", "Saved to ...", "done in Xs", "Finished", "✓"
 *   - failure:    "Error", "Traceback", "CUDA out of memory", "Exception", "[!]"
 *   - progress:   "[=====     ] 60%", "60%", "progress: 60"
 * The parser is deliberately permissive and de-duplicates rapid repeats.
 */

'use strict'

// Per-line completion markers (case-insensitive substring).
const DONE_MARKERS = [
  'task completed',
  'generation complete',
  'finished',
  'saved to',
  'output saved',
  'done in',
  'job finished',
  'completed successfully',
  '✓',
  '✔'
]

const FAIL_MARKERS = [
  'error',
  'traceback',
  'exception',
  'cuda out of memory',
  'out of memory',
  'failed',
  'assertionerror',
  'runtimeerror'
]

// Wan2GP often prints a progress bar like: [=====     ] 62%
const PROGRESS_BAR_RE = /\[\s*=*\s*\]\s*(\d{1,3})\s*%|(\d{1,3})\s*%|progress[^\d]*(\d{1,3})/i

/**
 * Classify a single log line into a queue event, or null if not notable.
 * @param {string} line
 * @returns {{ kind: 'complete'|'fail'|'progress', percent?: number, text: string }|null}
 */
function classifyLine(line) {
  if (!line) return null
  const s = line.toString().replace(/\s+$/, '').trim()
  if (!s) return null
  const low = s.toLowerCase()

  // progress first (so a "done 100%" still reads as complete below)
  const pm = s.match(PROGRESS_BAR_RE)
  if (pm) {
    const pct = parseInt(pm[1] || pm[2] || pm[3], 10)
    if (!Number.isNaN(pct) && pct < 100) {
      return { kind: 'progress', percent: pct, text: s }
    }
  }

  if (FAIL_MARKERS.some((m) => low.includes(m))) {
    // ignore benign "error" occurrences inside non-failure context is hard, but
    // "CUDA out of memory" / "Traceback" / "Exception" are strong enough.
    return { kind: 'fail', text: s }
  }
  if (DONE_MARKERS.some((m) => low.includes(m))) {
    return { kind: 'complete', text: s }
  }
  return null
}

/**
 * Feed a stream of log lines; returns only the *edge* events (de-duplicated):
 * - a 'progress' event only when the integer percent increases
 * - 'complete'/'fail' are passed through (caller decides cadence)
 * @param {string[]} lines
 * @param {{ lastPercent?: number }} [state]
 */
function detectEvents(lines, state = {}) {
  const events = []
  for (const line of lines) {
    const ev = classifyLine(line)
    if (!ev) continue
    if (ev.kind === 'progress') {
      if (state.lastPercent == null || ev.percent > state.lastPercent) {
        state.lastPercent = ev.percent
        events.push(ev)
      }
    } else {
      // reset progress baseline after a terminal event
      state.lastPercent = null
      events.push(ev)
    }
  }
  return events
}

/**
 * Build the message body for a single event (used by Apprise delivery).
 * @param {{ kind:string, percent?:number, text:string }} ev
 * @param {object} [opts] { jobName, includeLog }
 */
function buildMessage(ev, opts = {}) {
  const job = opts.jobName ? ` (${opts.jobName})` : ''
  if (ev.kind === 'progress') return `Wan2GP${job}: ${ev.percent}% done`
  if (ev.kind === 'complete') return `Wan2GP${job}: ✅ generation finished`
  if (ev.kind === 'fail') {
    const tail = opts.includeLog ? `\n${ev.text.slice(0, 280)}` : ''
    return `Wan2GP${job}: ❌ generation failed${tail}`
  }
  return `Wan2GP${job}: update`
}

/**
 * Validate + normalize a notifier config object.
 * @param {object} cfg { enabled, url, notifyOnComplete, notifyOnFail, notifyOnProgress, attachMedia, progressStep }
 * @returns {{ ok:boolean, error?:string, config?:object }}
 */
function normalizeConfig(cfg) {
  cfg = cfg || {}
  const enabled = !!cfg.enabled
  const url = (cfg.url || '').trim()
  if (enabled && !url) return { ok: false, error: 'A delivery URL is required when notifications are enabled (Apprise URL, e.g. discord://, tgram://, etc.)' }
  const known = ['enabled', 'url', 'notifyOnComplete', 'notifyOnFail', 'notifyOnProgress', 'attachMedia', 'progressStep', 'jobName']
  const clean = {}
  clean.enabled = enabled
  clean.url = url
  clean.notifyOnComplete = cfg.notifyOnComplete !== false
  clean.notifyOnFail = cfg.notifyOnFail !== false
  clean.notifyOnProgress = !!cfg.notifyOnProgress
  clean.attachMedia = !!cfg.attachMedia
  clean.progressStep = Math.min(100, Math.max(1, parseInt(cfg.progressStep, 10) || 25))
  clean.jobName = (cfg.jobName || '').toString().slice(0, 60)
  // drop unknown keys
  for (const k of Object.keys(cfg)) if (!known.includes(k)) { /* ignore */ }
  return { ok: true, config: clean }
}

/**
 * Decide whether an event should be delivered given the config.
 */
function shouldNotify(ev, config) {
  if (!config || !config.enabled) return false
  if (ev.kind === 'complete') return !!config.notifyOnComplete
  if (ev.kind === 'fail') return !!config.notifyOnFail
  if (ev.kind === 'progress') return !!config.notifyOnProgress
  return false
}

module.exports = {
  DONE_MARKERS, FAIL_MARKERS, PROGRESS_BAR_RE,
  classifyLine, detectEvents, buildMessage, normalizeConfig, shouldNotify
}
