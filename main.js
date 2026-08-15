"use strict";

const { app, BrowserWindow, BrowserView, ipcMain, shell, Menu, MenuItem, dialog, Tray, nativeTheme, Notification } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn, exec, execFile, execSync } = require('child_process')
const net = require('net')
const http = require('http')
const https = require('https')
const autoTune = require('./services/auto-tune.js')
const memoryProfile = require('./services/memory-profile.js')
const queueNotifier = require('./services/queue-notifier.js')
const installPlan = require('./services/install-plan.js')

// Auto-tune parity: forward the tuned vram_safety_coefficient from wgp_config.json
// as a CLI arg — wgp.py reads it from args only (cli_args.py:35), so a coefficient
// written to config by Auto-Tune is otherwise dead (always 0.8). CLI wins by design.
function pushAutoTunedCoefficient(extraArgs) {
  if (extraArgs.some(a => a === '--vram-safety-coefficient')) return // explicit user arg wins
  try {
    const cfgPath = autoTune.findWgpConfig(getRepoDir(), getDataDir())
    if (!cfgPath) return
    const wgpConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    const coeff = parseFloat(wgpConfig.vram_safety_coefficient)
    if (Number.isFinite(coeff) && coeff > 0 && coeff <= 1) {
      extraArgs.push('--vram-safety-coefficient', String(coeff))
    }
  } catch (e) { console.warn('[launch] failed to read auto-tuned coefficient:', e.message) }
}

// ── GPU info cache (TTL 30s, avoids redundant nvidia-smi calls across handlers) ──
// Does NOT cache empty/error results — only caches when non-NVIDIA data is available.
let _gpuCache = { result: null, ts: 0 }
const GPU_CACHE_TTL = 30000
function getGpuInfo() {
  if (_gpuCache.result && _gpuCache.result.vendor && Date.now() - _gpuCache.ts < GPU_CACHE_TTL) return _gpuCache.result
  const result = { name: '', vramMB: 0, vendor: '', driverVersion: '' }
  try {
    const ns = execSync('nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader', { encoding: 'utf8', timeout: 10000, windowsHide: true }).trim()
    if (ns) {
      const parts = ns.split(', ')
      result.name = parts[0] || ''
      result.vramMB = parseFloat(parts[1]) || 0
      result.driverVersion = (parts[2] || '').trim()
      result.vendor = 'NVIDIA'
    }
  } catch {
    try {
      const wmi = execSync('powershell -Command "Get-CimInstance Win32_VideoController | Select-Object -First 1 Name, AdapterRAM | ForEach-Object {$_.Name + \'|\' + $_.AdapterRAM}"', { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim()
      if (wmi) {
        const parts = wmi.split('|')
        result.name = (parts[0] || '').trim()
        result.vramMB = Math.round((parseInt(parts[1]) || 0) / (1024 * 1024))
        result.vendor = /radeon|amd/i.test(result.name) ? 'AMD' : 'INTEL'
      }
    } catch {}
  }
  // Only cache when we got actual data
  if (result.vendor) {
    _gpuCache = { result, ts: Date.now() }
  }
  return result
}

// ── NVIDIA driver pre-check (upstream parity) ──
// cu130 wheels (torch 2.10) need driver R580+; GTX 10/16 series fall back to
// cu128 (torch 2.7.1) so they're exempt. Returns a warning string or ''.
// Upstream setup.py has no such gate — the launcher adds it so users don't
// burn a full install/update cycle on a driver that can't load CUDA 13.
function checkNvidiaDriver() {
  const gpu = getGpuInfo()
  if (gpu.vendor !== 'NVIDIA') return ''
  const dv = parseFloat(gpu.driverVersion)
  if (!dv || dv >= 580) return ''
  if (/ (10|16)\d+/.test(gpu.name)) return '' // GTX 10/16 → cu128 profile, old drivers OK
  return `[!] NVIDIA driver ${gpu.driverVersion} is older than R580. The cu130 packages (torch 2.10 / CUDA 13) Wan2GP installs for your ${gpu.name} need driver R580 or newer. Update the driver first, then re-run — otherwise generation may fail with CUDA errors.\n`
}


// ── Structured error logging (replaces silent catch blocks) ──
function logError(context, err) {
  const msg = err ? (err.stack || err.message || String(err)) : String(err)
  console.error(`[${context}]`, msg)
}

// ── Safer batch-file string escaping ──
// Escape a value for use in a Windows batch (.bat) file context.
// Replaces metacharacters so the value is treated as literal text
// both in `echo` statements and inside `cmd /c "..."` arguments.
function escapeBat(s) {
  if (typeof s !== 'string') return String(s)
  // ^ is cmd's escape char — must be escaped first so later ^-insertions aren't doubled
  return s.replace(/\^/g, '^^')
          .replace(/&/g, '^&')
          .replace(/\|/g, '^|')
          .replace(/>/g, '^>')
          .replace(/</g, '^<')
          .replace(/%/g, '%%')
          .replace(/"/g, '""')
}

// Escape a value for use inside cmd /c "..." (inside double quotes).
// In that context ^ is literal, and only % and " are special (no setlocal delayedexpansion).
function escapeBatCmdArg(s) {
  if (typeof s !== 'string') return String(s)
  return s.replace(/%/g, '%%')
          .replace(/"/g, '""')
}

// Ensure a resolved path is inside the repo directory (prevent path traversal).
// Resolves symlinks/junctions on Windows to prevent traversal via directory links.
function ensureInsideRepo(envPath) {
  const repo = getRepoDir()
  if (!repo) return false
  let resolved
  try {
    resolved = fs.realpathSync(path.resolve(envPath))
  } catch {
    resolved = path.resolve(envPath)
  }
  let repoReal
  try {
    repoReal = fs.realpathSync(repo)
  } catch {
    repoReal = path.resolve(repo)
  }
  const rel = path.relative(repoReal, resolved)
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}

const { autoUpdater } = require('electron-updater')

// ── Force-kill a process and its entire tree ──
function killProcessTree(proc) {
  if (!proc || !proc.pid) return
  try {
    if (process.platform === 'win32')
      execSync('taskkill /pid ' + proc.pid + ' /f /t', { windowsHide: true, timeout: 3000 })
    else {
      // Use pkill to kill children, then kill the parent.
      // process.kill(-pid, 'SIGKILL') requires process group leadership which
      // Node's default spawn doesn't set, so use shell commands instead.
      try { execSync('pkill -P ' + proc.pid + ' 2>/dev/null', { timeout: 2000 }) } catch {}
      try { process.kill(proc.pid, 'SIGKILL') } catch {}
    }
  } catch (e) {
    // Already dead or permission denied — that's fine
  }
}

// ── Find a usable terminal emulator on Linux (for external-terminal mode) ──
// Tries the common desktop terminals in order; returns the first one on PATH.
function findTerminalEmulator() {
  if (IS_WIN) return null
  const candidates = ['gnome-terminal', 'konsole', 'xfce4-terminal', 'mate-terminal', 'tilix', 'xterm']
  for (const c of candidates) {
    try {
      const out = execSync('command -v ' + c, { encoding: 'utf8', timeout: 3000 }).trim()
      if (out) return c
    } catch {}
  }
  return null
}

// ── Stop the Wan2GP server (works for both tracked-child and external-terminal modes) ──
function stopWangpServer() {
  // Clear terminal-mode monitor interval first
  if (_monitorInterval) {
    clearInterval(_monitorInterval)
    _monitorInterval = null
  }
  if (_terminalTitle || _terminalPidFile) {
    // External-terminal mode: prefer killing the exact python PID we captured (bulletproof),
    // then also close the terminal window by title as a fallback / to dismiss the window.
    if (_terminalPidFile && fs.existsSync(_terminalPidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(_terminalPidFile, 'utf8').trim(), 10)
        if (pid) {
          if (IS_WIN) execSync('taskkill /pid ' + pid + ' /f /t', { windowsHide: true, timeout: 5000 })
          else killProcessTree({ pid })
        }
      } catch {}
      try { fs.unlinkSync(_terminalPidFile) } catch {}
    }
    if (_terminalTitle && IS_WIN) {
      try { execSync(`taskkill /fi "WINDOWTITLE eq ${_terminalTitle}*" /f /t`, { windowsHide: true, timeout: 5000 }) } catch {}
    }
    if (_terminalScriptFile) { try { fs.unlinkSync(_terminalScriptFile) } catch {} }
    _terminalTitle = null
    _terminalPidFile = null
    _terminalScriptFile = null
    return true
  }
  if (_wangpProc) { killProcessTree(_wangpProc); _wangpProc = null; return true }
  return false
}

// Find the running Wan2GP python PID (used to make external-terminal Stop bulletproof).
// Done in Node (not the .bat) to avoid cmd %-escaping pitfalls in a cmd CommandLine filter.
// Windows: Uses Get-CimInstance (modern WMI) instead of deprecated wmic.
// POSIX: pgrep -f matches the full command line (the spawn includes wgp.py).
function findWan2gpPid() {
  try {
    if (!IS_WIN) {
      const out = execSync('pgrep -f wgp.py', { encoding: 'utf8', timeout: 5000 }).toString().trim()
      if (!out) return null
      const pids = out.split('\n').map(s => parseInt(s.trim(), 10)).filter(n => !Number.isNaN(n))
      return pids[0] || null
    }
    // One query for ALL python.exe processes (pid|commandline), instead of a
    // PowerShell round-trip per PID — several unrelated Python processes used
    // to make this take many seconds on the stop/uninstall path.
    const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq \'python.exe\' } | ForEach-Object { $_.ProcessId.ToString() + \'|\' + $_.CommandLine }"', { windowsHide: true, timeout: 5000 }).toString()
    for (const line of out.split('\n')) {
      const bar = line.indexOf('|')
      if (bar > 0 && line.slice(bar + 1).includes('wgp.py')) return parseInt(line.slice(0, bar), 10)
    }
  } catch {}
  return null
}

// Disable GPU acceleration only when the user opts out (config electronGpu:false).
// Read config directly without app.getPath (may fail pre-ready) — try the override file first,
// then fall back to a default userData path.
// Default electronGpu:true keeps hardware compositing (regression fix, was v2.1.5).
try {
  const home = app.getPath('home')
  const overrideFile = path.join(home, '.wan2gp-desktop-data-dir')
  let cfgPath = ''
  if (fs.existsSync(overrideFile)) {
    const d = fs.readFileSync(overrideFile, 'utf8').trim()
    if (d) cfgPath = path.join(path.resolve(d), 'desktop-config.json')
  }
  if (!cfgPath) {
    cfgPath = path.join(app.getPath('userData'), 'Wan2GP', 'desktop-config.json')
  }
  // First run on Linux: config file may not exist yet — skip gracefully instead of logging an ENOENT stack.
  if (fs.existsSync(cfgPath)) {
    const _cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    if (_cfg.electronGpu === false) app.disableHardwareAcceleration()
  }
} catch (e) { logError('gpu-config', e) }

const DATA_DIR_OVERRIDE = path.join(app.getPath('home'), '.wan2gp-desktop-data-dir')

// Original (unredirected) Electron userData, captured at module scope BEFORE
// app.whenReady() redirects runtime data to <dataDir>/.electron. Used by
// reset-data-dir (and the getDataDir fallback) to compute the true default
// data dir — recomputing from app.getPath('userData') after the redirect
// landed the app in a nested <dataDir>/.electron/Wan2GP/.electron/Wan2GP and
// silently orphaned the user's existing install.
const ORIGINAL_USER_DATA = app.getPath('userData')

// ── Mutation guard (replaces the old dead mutex()) ──
// Serializes mutating operations (install / reinstall / update / uninstall /
// launch). Two rapid IPC calls previously interleaved: double runSetup() spawns
// clobbered the shared setupProc, and a second launch could spawn a second
// server against the same port. The guard rejects the second call instead.
let _mutatingOp = null // name of the running mutation, or null
function mutating(name, fn) {
  if (_mutatingOp) return { error: `Another operation is already running (${_mutatingOp}). Wait for it to finish.` }
  _mutatingOp = name
  return Promise.resolve()
    .then(fn)
    .finally(() => { _mutatingOp = null })
}

// Redirect Electron's internal runtime data is done inside app.whenReady()
// (see below) — calling app.setPath before ready can fail on some platforms.

function getDataDir() {
  try {
    if (fs.existsSync(DATA_DIR_OVERRIDE)) {
      const d = fs.readFileSync(DATA_DIR_OVERRIDE, 'utf8').trim()
      if (d) {
        // Validate: must be an absolute path, must not contain path-traversal components
        const resolved = path.resolve(d)
        if (!path.isAbsolute(resolved) || path.normalize(resolved) !== resolved || resolved.includes('..')) {
          logError('getDataDir', 'Invalid DATA_DIR_OVERRIDE path: ' + d)
        } else {
          return resolved
        }
      }
    }
  } catch (e) { logError('getDataDir', e) }
  return path.join(ORIGINAL_USER_DATA, 'Wan2GP')
}

function getConfigFile() { return path.join(getDataDir(), 'desktop-config.json') }
function getRepoDir() { return path.join(getDataDir(), 'Wan2GP') }
function getEnvsFile() { return path.join(getRepoDir(), 'envs.json') }

// ── Progress-forcing bootstrap ──
// Writes inline Python to a temp file so child Python can access it
// even from inside app.asar (asar is Node-only virtual filesystem).
// Concatenated to avoid template-literal indentation issues
const BOOTSTRAP_LINES = [
  '#!/usr/bin/env python3',
    'import os, sys, runpy',
    'def _patch_tty():',
    '    os.environ["PYTHONUNBUFFERED"] = "1"',
    '    os.environ["TQDM_MININTERVAL"] = "0"',
    '    os.environ["TQDM_MINITERS"] = "1"',
    '    os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "0"',
    '    os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "0"',
    '    os.environ["TERM"] = "xterm-256color"',
    '    class _TTYStream:',
    '        __slots__ = ("_inner",)',
    '        def __init__(self, inner): self._inner = inner',
    '        def isatty(self): return True',
    '        def __getattr__(self, n): return getattr(self._inner, n)',
    '        def fileno(self):',
    '            try: return self._inner.fileno()',
    '            except OSError: raise',
    '    sys.stderr = _TTYStream(sys.stderr)',
    '    sys.stdout = _TTYStream(sys.stdout)',
    '    sys.__stderr__ = sys.stderr',
    '    sys.__stdout__ = sys.stdout',
    '    print("[bootstrap] active", flush=True)',
    'def _patch_zimage_vae_dtype():',
    '    # Z-Image: pipeline casts latents to the transformer dtype (bf16) before VAE decode',
    '    # (pipeline_z_image.py ~:978), but wgp.py loads the VAE as fp16 by default',
    '    # (vae_precision=16) -> F.conv2d "Input type (BFloat16) and bias type (Half)" crash.',
    '    # The ZImageTurbo VAE checkpoint is natively bf16 (and fp32 VAE crashes too),',
    '    # so force the z-image factory to load the VAE as bf16 to match the latents.',
    '    try:',
    '        import torch, models.z_image.z_image_main as _zim',
    '        _orig_init = _zim.model_factory.__init__',
    '        def _init(self, *a, **kw):',
    '            kw["VAE_dtype"] = torch.bfloat16',
    '            print("[bootstrap] z-image VAE dtype fix APPLIED (bf16)", flush=True)',
    '            return _orig_init(self, *a, **kw)',
    '        _zim.model_factory.__init__ = _init',
    '        print("[bootstrap] z-image VAE dtype fix armed (bf16)", flush=True)',
    '    except Exception as e:',
    '        print("[bootstrap] z-image VAE dtype fix skipped: " + repr(e), flush=True)',
    'def main():',
    '    if len(sys.argv) < 2 or sys.argv[1].startswith("-"):',
    '        print("Usage: bootstrap.py <target> [args...]", file=sys.stderr)',
    '        sys.exit(1)',
    '    target = os.path.abspath(sys.argv[1])',
    '    if not os.path.isfile(target):',
    '        print("[bootstrap] Target not found: " + target, file=sys.stderr)',
    '        sys.exit(1)',
    '    _patch_tty()',
    '    sys.argv = sys.argv[1:]',
    '    d = os.path.dirname(target)',
    '    if d not in sys.path: sys.path.insert(0, d)',
    '    _patch_zimage_vae_dtype()',
    '    runpy.run_path(target, run_name="__main__")',
    'if __name__ == "__main__":',
    '    main()',
]

// The bootstrap must exist on disk for every spawned python process. Rewritten on EVERY
// call (not once at startup): %TEMP% cleaners, other processes, or a deleted file used
// to break all launches with a cryptic "python can't open file" error until app restart.
// Throws a clear error if the write fails so the UI can show what actually happened.
function bootstrapScriptPath() {
  const p = path.join(os.tmpdir(), 'wan2gp-bootstrap.py')
  try {
    fs.writeFileSync(p, BOOTSTRAP_LINES.join('\n'), 'utf8')
  } catch (e) {
    throw new Error('Failed to write launcher bootstrap script to ' + p + ': ' + ((e && e.message) || e))
  }
  return p
}

const PLATFORM = process.platform
const IS_WIN = PLATFORM === 'win32'

// ── WSLg fallback (Linux under WSL) ──
// WSLg on Windows 10 had a broken shared-memory channel (Chromium renderers
// FATAL on /dev/shm with ESRCH — the WSL 2.7.x wslg#1456 regression family)
// and no GPU passthrough (no /dev/dri). Modern WSL (2.8+, kernel ≥ 6.12 —
// Ubuntu 24.04/26.04 WSLg) has a healthy /dev/shm and a working seccomp
// sandbox; there the old blanket switches are actively HARMFUL:
// --disable-dev-shm-usage forces Chromium onto the /tmp shm path, which
// fails (ESRCH) on WSLg and kills the renderer (verified 2026-08-09 on
// Ubuntu 26.04 / kernel 6.18: renderer dies with the flags, runs clean
// without). Gate all workarounds on the legacy kernel line that actually
// needs them. Real Linux desktops are untouched (WSL_DISTRO_NAME is unset).
function wslKernelVersion() {
  try {
    const m = /^(\d+)\.(\d+)/.exec(fs.readFileSync('/proc/sys/kernel/osrelease', 'utf8').trim())
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : null
  } catch (e) { return null }
}
const WSL_LEGACY = (() => {
  if (PLATFORM !== 'linux' || !process.env.WSL_DISTRO_NAME) return false
  const v = wslKernelVersion()
  // Legacy WSLg line (WSL ≤ 2.7.x, kernel < 6.12): broken /dev/shm channel.
  return v === null || v[0] < 6 || (v[0] === 6 && v[1] < 12)
})()
if (WSL_LEGACY) {
  app.commandLine.appendSwitch('no-sandbox')
  // renderer shm_open() on /dev/shm returns ESRCH on broken WSLg — use /tmp
  app.commandLine.appendSwitch('disable-dev-shm-usage')
  if (!fs.existsSync('/dev/dri')) {
    app.commandLine.appendSwitch('disable-gpu')
    app.commandLine.appendSwitch('in-process-gpu')
    app.commandLine.appendSwitch('ozone-platform', 'x11')
    app.commandLine.appendSwitch('use-gl', 'swiftshader')
  }
}

let mainWin = null, setupProc = null, _wangpProc = null
let _terminalTitle = null   // set when launched in external-terminal mode (tracked by title for Stop)
let _terminalPidFile = null // temp file holding the python PID for a bulletproof kill
let _terminalScriptFile = null // temp .bat (Windows) / .sh (POSIX) launched in the external terminal
let _currentPort = 7860 // tracked across launches/restarts
let _monitorInterval = null // terminal-mode port monitor, cleared on explicit stop
let tray = null
app.isQuitting = false

function sysPython() {
  try {
    const out = execSync(IS_WIN ? 'where python' : 'which python3', { encoding: 'utf8' })
    return (out.split('\n')[0] || '').trim() || (IS_WIN ? 'python' : 'python3')
  } catch { return IS_WIN ? 'python' : 'python3' }
}

// Resolve a Python 3.11 interpreter for installs. Building the env on 3.14
// breaks deps (pygame has no 3.14 wheel, insightface/flash-attn version-skew).
// uv-managed installs are preferred; a broken managed install (e.g. its DLL
// fails to load on some Windows 11 builds — "'charmap'… not suitable for
// Windows" loader error 0xc0e90002) is auto-repaired with a forced reinstall
// before falling back to a verified system Python.
// ponytail: once uv becomes mandatory, return null here to hard-fail instead of falling back.
async function installPython() {
  const find311 = async () => {
    try { return (await asyncExec('uv python find 3.11', { encoding: 'utf8', windowsHide: true, timeout: 30000 })).trim() } catch { return '' }
  }
  // Confirm the interpreter actually executes — uv's "find" only locates it,
  // and a corrupted/blocked managed install still shows up in the list.
  const runs = async (p) => {
    if (!p) return false
    try { await asyncExec(`"${p}" -c "import sys"`, { stdio: 'pipe', windowsHide: true, timeout: 30000 }); return true } catch { return false }
  }
  // Preferred: uv-managed 3.11 (default env type already requires uv)
  try { await asyncExec('uv python install 3.11', { stdio: 'pipe', windowsHide: true, timeout: 120000 }) } catch {}
  let p = await find311()
  if (await runs(p)) return p
  // Managed 3.11 exists but won't run (corrupted download / loader block).
  // Force a clean reinstall instead of handing the broken exe to setup.py.
  send('setup-output', '[!] Managed Python 3.11 is broken (DLL load failure). Forcing a clean reinstall...\n')
  try { await asyncExec('uv python install --reinstall 3.11', { stdio: 'pipe', windowsHide: true, timeout: 240000 }) }
  catch {
    // Older uv without --reinstall: uninstall + install
    try { await asyncExec('uv python uninstall 3.11', { stdio: 'pipe', windowsHide: true, timeout: 60000 }) } catch {}
    try { await asyncExec('uv python install 3.11', { stdio: 'pipe', windowsHide: true, timeout: 240000 }) } catch {}
  }
  p = await find311()
  if (await runs(p)) return p
  // Fallback: any system 3.11 that actually runs (verified, so setup.py never
  // spawns a dead exe — previously this dead-ended in "exited code 9009").
  const sysCandidates = IS_WIN ? ['python', 'python3.11'] : ['python3.11', 'python3']
  for (const cand of sysCandidates) {
    let resolved = cand
    try { resolved = (await asyncExec(IS_WIN ? 'where ' + cand : 'which ' + cand, { encoding: 'utf8', windowsHide: true })).split('\n')[0].trim() || cand } catch {}
    if (await runs(resolved)) return resolved
  }
  return null
}

// ── Log history buffer (replayed to floating terminal window on create) ──
const _logHistory = []
const _LOG_HISTORY_MAX = 5000

function send(ch, data) {
  // Capture log channels for replay when a floating terminal window opens
  if (ch === 'setup-output' || ch === 'launch-log') {
    _logHistory.push({ channel: ch, data })
    while (_logHistory.length > _LOG_HISTORY_MAX) _logHistory.shift()
  }
  mainWin?.webContents.send(ch, data)
  _termWin?.webContents.send(ch, data)
}

function loadConfig() {
  try {
    if (fs.existsSync(getConfigFile())) return JSON.parse(fs.readFileSync(getConfigFile(), 'utf8'))
  } catch (e) { logError('loadConfig', e) }
  return { githubToken: '', hfToken: '', theme: 'dark', serverPort: 7860, defaultBrowser: 'system', termDockDefault: 'bottom', electronGpu: true, share: false, autoUpdateEnabled: true }
}

function saveConfig(cfg) {
  fs.mkdirSync(getDataDir(), { recursive: true })
  fs.writeFileSync(getConfigFile(), JSON.stringify(cfg, null, 2))
}

// ── TCP port check ──
function waitForPort(host, port, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      const sock = new net.Socket()
      sock.setTimeout(2000)
      sock.on('connect', () => { sock.destroy(); resolve(true) })
      sock.on('error', () => { sock.destroy(); retry() })
      sock.on('timeout', () => { sock.destroy(); retry() })
      sock.connect(port, host)
    }
    const retry = () => {
      if (Date.now() - start > timeoutMs) reject(new Error(`Timed out after ${timeoutMs/1000}s waiting for Wan2GP on ${host}:${port}`))
      else setTimeout(check, 800)
    }
    check()
  })
}

// ── Wan2GP Upstream Version Check ──
const WAN2GP_UPSTREAM = 'deepbeepmeep/Wan2GP'

// ── Cached git info (TTL 30s, avoids blocking IPC on every dashboard refresh) ──
let _gitCache = { wangp: null, desktop: null, ts: 0 }
const GIT_CACHE_TTL = 30000

/** Invalidate git cache so the next call re-reads from disk (e.g. after update/pull). */
function invalidateGitCache() { _gitCache = { wangp: null, desktop: null, ts: 0 } }

function getLocalWangpHead() {
  if (_gitCache.wangp && Date.now() - _gitCache.ts < GIT_CACHE_TTL) return _gitCache.wangp
  if (!fs.existsSync(path.join(getRepoDir(), '.git'))) return null
  try {
    const hash = execSync('git rev-parse HEAD', { cwd: getRepoDir(), encoding: 'utf8', timeout: 5000 }).trim()
    const date = execSync('git log -1 --format=%cI', { cwd: getRepoDir(), encoding: 'utf8', timeout: 5000 }).trim()
    const msg = execSync('git log -1 --format=%s', { cwd: getRepoDir(), encoding: 'utf8', timeout: 5000 }).trim()
    _gitCache = { wangp: { hash, date, message: msg }, desktop: _gitCache.desktop, ts: Date.now() }
    return _gitCache.wangp
  } catch { return null }
}

/**
 * Classify the state of getRepoDir()'s git repository.
 * A present-but-broken `.git` (empty folder, stray .git file, AV-quarantined
 * internals, interrupted init) makes every git command die with
 * "fatal: not a git repository" — and upstream setup.py's repair_git_repo()
 * only re-inits when `.git` is ABSENT, so that state is never healed and every
 * update fails identically forever (issue #27). The launcher pre-flights this
 * and moves the broken .git aside so setup.py's repair path can rebuild it.
 * Returns 'ok' | 'broken' | 'nogit' | 'unknown' (unknown = git itself failed,
 * e.g. git not on PATH — leave the folder alone and let setup.py report it).
 */
function repoGitHealth() {
  if (!fs.existsSync(path.join(getRepoDir(), '.git'))) return 'nogit'
  try {
    execSync('git rev-parse --is-inside-work-tree 2>&1', {
      cwd: getRepoDir(), encoding: 'utf8', timeout: 5000, windowsHide: true
    })
    return 'ok'
  } catch (e) {
    const msg = (e.stdout || e.stderr || e.message || '').toString()
    return msg.includes('not a git repository') ? 'broken' : 'unknown'
  }
}

function fetchUrl(url, opts = {}) {
  const { method, body, headers, timeout, maxBytes } = opts
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const mod = parsed.protocol === 'https:' ? https : http
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: method || 'GET',
      headers: { 'User-Agent': 'wan2gp-desktop', ...headers },
      timeout: timeout || 15000
    }
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body)
    const req = mod.request(options, (res) => {
      // Follow redirects (GitHub/PyPI APIs occasionally 301/302) — bounded by
      // the request timeout, and the new URL is re-validated via new URL().
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        const next = new URL(res.headers.location, url).toString()
        return fetchUrl(next, opts).then(resolve, reject)
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      let data = ''
      let aborted = false
      res.on('data', chunk => {
        if (aborted) return
        data += chunk
        // Size cap: JSON API responses should be tiny; a runaway/broken
        // endpoint must not balloon memory. Default 16 MB, override per call.
        if (data.length > (maxBytes || 16 * 1024 * 1024)) {
          aborted = true
          res.destroy()
          reject(new Error(`Response too large (>${Math.round((maxBytes || 16 * 1024 * 1024) / 1024 / 1024)} MB) for ${url}`))
        }
      })
      res.on('end', () => {
        if (aborted) return
        try { resolve(JSON.parse(data)) } catch { resolve(data) }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout after ${(timeout || 15000) / 1000}s for ${url}`)) })
    if (body) req.write(body)
    req.end()
  })
}

// ── Prerequisite-download + silent-install helpers (used by install-prerequisite) ──
// These used to be missing entirely: install-prerequisite called downloadFile()
// (defined nowhere) and asyncExec() (scoped to the uninstall-env handler), so
// every "Install Git/Python/Miniconda" action failed with a swallowed
// ReferenceError. Module-level here so every handler can reach them.

/**
 * Download a URL to a file, following redirects (GitHub releases and
 * python.org redirect to CDNs), streaming to disk so a 120 MB installer
 * never lives in RAM. Rejects on HTTP errors / timeouts.
 *
 * @param {string} url
 * @param {string} dest absolute path to write to
 * @returns {Promise<string>} resolves with dest on success
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const mod = parsed.protocol === 'https:' ? https : http
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': 'wan2gp-desktop' },
      timeout: 30000
    }
    const req = mod.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return downloadFile(new URL(res.headers.location, url).toString(), dest).then(resolve, reject)
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      const out = fs.createWriteStream(dest)
      res.pipe(out)
      out.on('finish', () => out.close(() => resolve(dest)))
      out.on('error', (e) => { res.destroy(); reject(e) })
      res.on('error', (e) => { out.destroy(); reject(e) })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('download timeout: ' + url)) })
    req.end()
  })
}

/**
 * Promise wrapper around child_process.exec. The handler-local copy inside
 * uninstall-env is out of scope for install-prerequisite — this is the
 * shared one.
 *
 * @param {string} cmd
 * @param {object} [opts] child_process.exec options (timeout, windowsHide, encoding, ...)
 * @returns {Promise<string>} trimmed stdout
 */
function asyncExec(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, opts, (err, stdout) => {
      if (err) reject(err)
      else resolve((stdout || '').trim())
    })
  })
}

/**
 * Promise wrapper around child_process.execFile — arg-array form, so no shell
 * quoting/interpolation is involved. Used to move the install/update pipeline
 * off blocking execSync (which froze the whole main process for up to minutes
 * during clone/pip/git operations).
 *
 * @param {string} cmd executable (resolved via PATH)
 * @param {string[]} args argv array
 * @param {object} [opts] execFile options (timeout, cwd, windowsHide, env, ...)
 * @returns {Promise<string>} trimmed stdout
 */
function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout) => {
      if (err) reject(err)
      else resolve((stdout || '').trim())
    })
  })
}

// Sleep helper — async replacement for the old Atomics.wait-based sleepSync.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Run setup.py with structured events ──
async function runSetup(args, extraPath) {
  // Resolve the interpreter first (async — uv can take minutes to install a
  // broken 3.11; this used to freeze the whole app via execSync).
  const py = await installPython()
  if (!py) {
    send('setup-output', '[!] No usable Python 3.11 found: the uv-managed install is broken and no working system Python 3.11 is available.\n')
    send('setup-output', '[!] Fix: run "uv python install --reinstall 3.11" in a terminal (or uninstall + install), or install Python 3.11 from https://www.python.org/downloads/ and retry.\n')
    throw new Error('No usable Python 3.11 interpreter found (see output above)')
  }
  return new Promise((resolve, reject) => {
    var env = { ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', CONDA_NO_PLUGINS: 'true', CONDA_SOLVER: 'classic',
        TQDM_MININTERVAL: '0', TQDM_MINITERS: '1', HF_HUB_DISABLE_PROGRESS_BARS: '0' }
    if (extraPath) {
      env.PATH = extraPath + path.delimiter + (env.PATH || '')
    }
    const proc = spawn(py, ['-u', bootstrapScriptPath(), 'setup.py', ...args], {
      cwd: getRepoDir(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      env: env
    })
    setupProc = proc
    let lineBuf = ''
    const emit = (text) => {
      send('setup-output', text)
      lineBuf += text
      const lines = lineBuf.split('\n')
      lineBuf = lines.pop()
      for (const line of lines) {
        const profileMatch = line.match(/Hardware Profile:\s*(\S+)/)
        if (profileMatch) send('setup-profile', profileMatch[1])
        const phase = detectPhase(line)
        if (phase) send('setup-phase', phase)
      }
    }
    proc.stdout.on('data', (d) => { const s = d.toString(); emit(s); process.stdout.write(s) })
    proc.stderr.on('data', (d) => { const s = d.toString(); emit(s); process.stderr.write(s) })
    proc.on('close', (code) => {
      setupProc = null
      if (code === 0) resolve()
      else reject(new Error(`setup.py exited code ${code}`))
    })
    proc.on('error', reject)
  })
}

function detectPhase(line) {
  if (line.includes('[1/3] Preparing Environment')) return { id: 'venv', label: 'Creating Python venv', done: false }
  if (line.includes('[2/3] Installing Torch')) return { id: 'torch', label: 'Installing PyTorch + CUDA wheels', done: false }
  if (line.includes('[3/3] Installing Requirements')) return { id: 'reqs', label: 'Installing Python dependencies', done: false }
  if (line.includes('>>> Running') && (line.includes('triton-windows') || line.includes('triton<'))) return { id: 'triton', label: 'Installing Triton compiler', done: false }
  if (line.includes('>>> Running') && (line.includes('sageattention') || line.includes('SageAttention'))) return { id: 'sage', label: 'Installing Sage Attention kernel', done: false }
  if (line.includes('>>> Running') && (line.includes('flash_attn') || line.includes('flash-attn'))) return { id: 'flash', label: 'Installing Flash Attention', done: false }
  if (line.includes('>>> Running') && (line.includes('nunchaku') || line.includes('gguf') || line.includes('lightx2v'))) return { id: 'kernels', label: 'Installing GPU kernels', done: false }
  if (line.includes('>>> Running') && (line.includes('SpargeAttn') || line.includes('spas_sage'))) return { id: 'sage', label: 'Installing Sparge Attention', done: false }
  if (line.includes('>>> Running') && line.includes('pip install -r requirements')) return { id: 'reqs', label: 'Installing dependencies from requirements.txt', done: false }
  if (line.includes('>>> Running') && line.includes('plugins')) return { id: 'plugins', label: 'Installing plugin requirements', done: false }
  if (line.includes('Automatic Install Complete') || line.includes('is now active')) return { id: 'done', label: 'Installation complete', done: true }
  return null
}

function getActiveEnv() {
  try {
    if (!fs.existsSync(getEnvsFile())) return null
    const data = JSON.parse(fs.readFileSync(getEnvsFile(), 'utf8'))
    const active = data.active
    if (!active || !data.envs[active]) return null
    return { name: active, ...data.envs[active] }
  } catch { return null }
}

function getPythonForEnv(env) {
  if (!env || !env.path) return null
  // Resolve relative paths against getRepoDir()
  const envPath = path.normalize(path.isAbsolute(env.path) ? env.path : path.join(getRepoDir(), env.path))
  if (env.type === 'none') return sysPython()
  // Conda puts python.exe at env root on Windows, venv/uv use Scripts\
  if (env.type === 'conda') {
    return IS_WIN
      ? path.join(envPath, 'python.exe')
      : path.join(envPath, 'bin', 'python')
  }
  return IS_WIN
    ? path.join(envPath, 'Scripts', 'python.exe')
    : path.join(envPath, 'bin', 'python')
}

// ── IPC ──

ipcMain.handle('check-installed', () => ({
  repo: fs.existsSync(path.join(getRepoDir(), 'wgp.py')),
  env: getActiveEnv() !== null
}))

ipcMain.handle('detect-gpu', async () => {
  // Async, bounded — never blocks the main process (previously execSync with
  // up to 8-10s WMI/nvidia-smi freezes). Falls back to the sync getGpuInfo()
  // cache for the vendor-only quick path used by the installer.
  try {
    const info = await autoTune.detectGpuInfo()
    if (info && info.name && info.name !== 'Unknown') return info
    const cached = getGpuInfo()
    if (cached.name && cached.vendor) return { vendor: cached.vendor, name: cached.name }
    return info
  } catch (e) { logError('detect-gpu', e); return { vendor: 'UNKNOWN', name: 'Unknown' } }
})

// ── Multi-GPU detection (device picker) ──
// Lists EVERY GPU so users on multi-GPU machines (iGPU + dGPU, dual NVIDIA) can
// choose which device Wan2GP runs on. nvidia-smi enumerates all NVIDIA GPUs with
// index + VRAM; WMI fallback lists all video controllers (not just the first).
ipcMain.handle('detect-gpus', async () => {
  // Async, bounded — nvidia-smi/WMI/system_profiler probes never block the
  // main process (previously up to 10s execSync on the device-picker path).
  try {
    const gpus = await autoTune.queryGpuList()
    return gpus.length ? gpus : [{ index: 0, name: 'Unknown', vramMB: 0, vendor: 'UNKNOWN' }]
  } catch { return [{ index: 0, name: 'Unknown', vramMB: 0, vendor: 'UNKNOWN' }] }
})

ipcMain.handle('install', async (_, envType) => mutating('install', async () => {
  const env = envType || 'venv'
  // NVIDIA driver pre-check (upstream parity) — warn before a long install if the
  // driver can't run the cu130 stack Wan2GP's profile will install.
  const _drvWarn = checkNvidiaDriver()
  if (_drvWarn) send('setup-output', _drvWarn)
  if (!fs.existsSync(path.join(getRepoDir(), 'wgp.py'))) {
    send('setup-output', '[*] Cloning Wan2GP repository...\n')
    fs.mkdirSync(getDataDir(), { recursive: true })
    // A keep-models uninstall leaves a models-only folder behind — git clone needs an
    // empty target, so stash the leftover aside, clone fresh, then fold it back in.
    let stashDir = null
    try {
      if (fs.existsSync(getRepoDir()) && fs.readdirSync(getRepoDir()).length > 0) {
        stashDir = getRepoDir() + '.leftover'
        if (fs.existsSync(stashDir)) fs.rmSync(stashDir, { recursive: true, force: true })
        fs.renameSync(getRepoDir(), stashDir)
        send('setup-output', '[*] Found leftover folder (models from a keep-models uninstall?) — stashing it aside.\n')
      }
    } catch (e) {
      stashDir = null
      send('setup-output', `[!] Could not stash leftover folder: ${e.message}\n`)
    }
    try {
      // Async — the clone used to block the entire app (execSync, up to 2 min).
      await runCmd('git', ['clone', '--depth', '1', 'https://github.com/deepbeepmeep/Wan2GP.git', getRepoDir()], { timeout: 120000 })
    } catch (e) {
      // Restore the leftover folder if the clone failed
      try {
        if (stashDir && fs.existsSync(stashDir) && !fs.existsSync(getRepoDir())) fs.renameSync(stashDir, getRepoDir())
      } catch {}
      // A fresh install that previously worked but now times out here is almost
      // always antivirus interference (MalwareBytes etc.) blocking git or the
      // download — the same AV that may have quarantined the uv-managed Python.
      send('setup-output', '[!] Git clone failed or timed out (2 min).\n')
      send('setup-output', `[!] If a previous install worked, add antivirus exclusions for:\n`)
      send('setup-output', `[!]   ${getDataDir()}\n`)
      send('setup-output', `[!]   %APPDATA%\\uv\\python   (uv-managed Python)\n`)
      send('setup-output', '[!] then retry. You can also clone manually first:\n')
      send('setup-output', `[!]   git clone --depth 1 https://github.com/deepbeepmeep/Wan2GP.git "${getRepoDir()}"\n`)
      throw new Error('Git clone failed/timed out — see output above (likely antivirus interference)')
    }
    // Fold the stashed leftover (models etc.) back into the fresh clone
    if (stashDir && fs.existsSync(stashDir)) {
      try {
        for (const item of fs.readdirSync(stashDir)) {
          const from = path.join(stashDir, item)
          const to = path.join(getRepoDir(), item)
          if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true })
          fs.renameSync(from, to)
        }
        fs.rmSync(stashDir, { recursive: true, force: true })
        send('setup-output', '[*] Preserved leftover models/ from the previous installation.\n')
      } catch (e) {
        send('setup-output', `[!] Could not fold leftover folder back in: ${e.message}. Leftover kept at ${stashDir}\n`)
      }
    }
    send('setup-output', '[*] Repository cloned.\n')
    // Restore backed-up plugins, finetunes, and config from reinstall
    try {
      const backupDir = path.join(getDataDir(), '.reinstall-backup')
      if (fs.existsSync(backupDir)) {
        const repo = getRepoDir()
        for (const sub of ['plugins', 'finetunes']) {
          const src = path.join(backupDir, sub)
          if (fs.existsSync(src)) {
            // Ensure destination exists (fresh clone may not have these dirs)
            var dst = path.join(repo, sub)
            fs.mkdirSync(dst, { recursive: true })
            if (IS_WIN) await runCmd('xcopy', ['/E', '/I', src, dst], { timeout: 30000 })
            else await runCmd('cp', ['-r', src, repo + '/'], { timeout: 30000 })
          }
        }
        // Restore config if it exists and no config exists yet
        const configBackup = path.join(backupDir, 'wgp_config.json')
        const configTarget = path.join(repo, 'wgp_config.json')
        if (fs.existsSync(configBackup) && !fs.existsSync(configTarget)) {
          fs.copyFileSync(configBackup, configTarget)
        }
        send('setup-output', '[*] Restored plugins, finetunes, and config.\n')
        // Clean up backup
        fs.rmSync(backupDir, { recursive: true })
      }
    } catch (e) { send('setup-output', `[!] Restore warning: ${e.message}\n`) }
    send('setup-phase', { id: 'clone', label: 'Clone Wan2GP repository', done: true })
  } else {
    send('setup-phase', { id: 'clone', label: 'Clone Wan2GP repository', done: true })
  }
  // Pre-check: venv mode on Windows needs `py -3.11`.
  // Avoid global Python install — use uv's isolated Python 3.11 with a batch shim instead.
  var _pyShimDir = null
  if (IS_WIN && env === 'venv') {
    try {
      await runCmd('py', ['-3.11', '-c', ''], { timeout: 10000 })
    } catch {
      send('setup-output', '[*] Python 3.11 not found via py launcher. Using uv-managed Python (isolated, no global install)...\n')
      var uvPy = null
      try { await asyncExec('uv python install 3.11', { stdio: 'pipe', windowsHide: true, timeout: 60000 }); uvPy = (await asyncExec('uv python find 3.11', { encoding: 'utf8', windowsHide: true, timeout: 10000 })).trim() } catch {}
      if (uvPy) {
        send('setup-output', '[*] Creating py launcher shim -> ' + uvPy + '\n')
        _pyShimDir = path.join(getDataDir(), '.py-shim')
        fs.mkdirSync(_pyShimDir, { recursive: true })
        var shim = '@echo off\r\n'
        shim += 'setlocal enabledelayedexpansion\r\n'
        shim += 'set "args=%*"\r\n'
        shim += 'set "args=!args:-3.11 =!"\r\n'
        shim += 'if "!args!"=="%*" set "args=!args:-3.11=!"\r\n'
        shim += '"' + uvPy + '" !args!\r\n'
        shim += 'exit /b %errorlevel%\r\n'
        fs.writeFileSync(path.join(_pyShimDir, 'py.cmd'), shim, 'utf8')
        fs.writeFileSync(path.join(_pyShimDir, 'py.bat'), shim, 'utf8')
        send('setup-output', '[*] py shim ready (isolated Python 3.11, no global install)\n')
      }
      if (!_pyShimDir) {
        send('setup-output', '[!] Could not get Python 3.11 via uv (isolated) either.\n')
        send('setup-output', '[!] Install Python 3.11 from https://www.python.org/downloads/\n')
        send('setup-output', '[!] or use the "uv" environment type instead (simplest, no Python needed).\n')
        throw new Error('Python 3.11 not found. Install Python 3.11 or use uv environment type.')
      }
    }
  }
  await runSetup(['install', '--env', env, '--auto'], _pyShimDir)
  // Clean up py shim
  if (_pyShimDir) { try { fs.rmSync(_pyShimDir, { recursive: true }) } catch {} }
  // Post-install steps: these run BEFORE returning to the renderer, so the
  // UI's "Installation complete" only shows after everything finishes.
  // Use a dedicated phase label so the renderer shows "Finishing..." not "Complete!".
  send('setup-phase', { id: 'postinstall', label: 'Post-install: verifying dependencies', done: false })
  // AMD/Windows numpy pin (upstream parity): upstream requirements.txt pins
  // numpy==2.1.2, but the ROCm "TheRock" torch 2.7.0a0 wheels Wan2GP installs
  // for AMD on Windows were built against numpy 1.x and crash with numpy 2.
  // The upstream install scripts force numpy==1.26.4 on win32+AMD for the same reason.
  try {
    // Async probe first (nvidia-smi spawn) — falls back to the cached sync
    // getGpuInfo() so cold-cache installs don't stall on the main thread.
    const _gpuPost = (await autoTune.detectGpuInfo().catch(() => null)) || getGpuInfo()
    if (IS_WIN && _gpuPost.vendor === 'AMD') {
      const _envPost = getActiveEnv()
      const _pyPost = _envPost ? getPythonForEnv(_envPost) : null
      if (_pyPost) {
        send('setup-output', '[*] AMD GPU detected on Windows — pinning numpy==1.26.4 (ROCm torch compatibility)...\n')
        await runCmd(_pyPost, ['-m', 'pip', 'install', 'numpy==1.26.4', '-q'], { timeout: 60000, cwd: getRepoDir() })
      }
    }
  } catch (e) { send('setup-output', `[!] AMD numpy pin: ${e.message}\n`) }
  send('setup-output', '[*] Ensuring huggingface_hub is installed...\n')
  try {
    const envData = getActiveEnv()
    if (envData) {
      const py = getPythonForEnv(envData)
      if (py) await runCmd(py, ['-m', 'pip', 'install', 'huggingface_hub', '-q'], { timeout: 30000, cwd: getRepoDir() })
    }
  } catch (e) { send('setup-output', `[!] huggingface_hub install: ${e.message}\n`) }
  send('setup-output', '[*] Installing hf_xet (Xet Storage) for faster model downloads...\n')
  try {
    const envData = getActiveEnv()
    if (envData) {
      const py = getPythonForEnv(envData)
      if (py) await runCmd(py, ['-m', 'pip', 'install', 'hf_xet', '-q'], { timeout: 60000, cwd: getRepoDir() })
    }
  } catch (e) { send('setup-output', `[!] hf_xet install: ${e.message}\n`)
    send('setup-output', '[*] Note: hf_xet is optional — downloads work without it.\n') }
  send('setup-phase', { id: 'postinstall', label: 'Post-install dependencies ready', done: true })
  invalidateGitCache()
  return true
}))

// ── Shared removal engine (used by reinstall + uninstall) ──
// Kills every running Wan2GP process, waits for Windows to release their
// directory handles, then deletes the install tree. Children are deleted
// first — a directory that is a process's CWD (e.g. a terminal open in the
// install folder) can't be removed itself, but its contents can.
// keepFolders: list of in-repo folder names (lowercase) to leave in place, or
// null/undefined to delete everything including the root.
// Returns { ok, leftoverFolder, error }.
async function forceRemoveRepo(repo, log, keepFolders) {
  const killedPids = new Set()
  try {
    if (_wangpProc) { killedPids.add(_wangpProc.pid); try { killProcessTree(_wangpProc) } catch {}; _wangpProc = null }
    for (let i = 0; i < 5; i++) {
      const pid = findWan2gpPid()
      if (!pid || killedPids.has(pid)) break
      killedPids.add(pid)
      try { killProcessTree({ pid }) } catch {}
    }
  } catch {}
  // Windows releases a killed process's directory handles asynchronously — wait
  // until every Wan2GP python is really gone AND the install dir is enumerable
  // again, so the deletion below doesn't race a still-exiting process (EPERM).
  // Async sleeps: the old Atomics.wait loops froze the whole app for up to ~10s
  // per uninstall — the UI stays responsive while the removal engine waits now.
  const isPidAlive = async (pid) => {
    try {
      if (IS_WIN) {
        const out = await asyncExec('tasklist /fi "PID eq ' + pid + '" /fo csv /nh', { windowsHide: true, timeout: 5000 })
        return out.trim().length > 0 && !out.includes('No tasks')
      }
      // POSIX: signal 0 tests existence without delivering a signal
      process.kill(pid, 0)
      return true
    } catch { return false }
  }
  const anyAlive = async (pids) => {
    for (const p of pids) if (await isPidAlive(p)) return true
    return false
  }
  let released = false
  for (let i = 0; i < 20; i++) {
    if (!(await anyAlive(killedPids))) {
      try { fs.readdirSync(repo); released = true; break } catch { /* dir handle still held */ }
    }
    await sleep(500)
  }
  if (!released) {
    log('[!] Wan2GP processes are still shutting down — files may be locked. Stop them and retry.')
    return { ok: false, leftoverFolder: null, error: 'Wan2GP processes are still running. Stop them and retry.' }
  }
  const rmRetry = async (p) => {
    let lastErr = null
    for (let i = 0; i < 20; i++) {
      try { fs.rmSync(p, { recursive: true, force: true }); return null } catch (e) { lastErr = e }
      // Antivirus scanning a freshly installed venv can hold a directory for
      // several seconds — wait it out instead of giving up. A killed process can
      // also be slow to release its handles; re-poll it here too.
      if (await anyAlive(killedPids)) {
        for (let j = 0; j < 20 && (await anyAlive(killedPids)); j++) await sleep(500)
      }
      await sleep(1000)
    }
    return lastErr
  }
  let ok = true
  let leftoverFolder = null
  const failed = []
  try {
    let items = fs.readdirSync(repo)
    // The Python venv is the largest and most antivirus-scan-prone folder — delete
    // everything else first so a scan on env_uv can finish while we work.
    const venvIdx = items.findIndex(i => i.toLowerCase() === 'env_uv')
    if (venvIdx >= 0) items = items.filter(i => i !== items[venvIdx]).concat(items[venvIdx])
    for (const item of items) {
      if (keepFolders && keepFolders.includes(item.toLowerCase())) continue
      const err = await rmRetry(path.join(repo, item))
      if (err) { log(`[!] Could not remove ${item}: ${err.message}`); failed.push(item); ok = false }
    }
    // One last sweep: a process that escaped the first kill (or respawned) gets
    // another chance, then retry only the items that failed.
    if (failed.length) {
      let extra = null
      for (let i = 0; i < 5; i++) { extra = findWan2gpPid(); if (!extra) break; killedPids.add(extra); try { killProcessTree({ pid: extra }) } catch {} }
      if (extra) {
        log('[i] Waiting for a lingering Wan2GP process to exit...')
        for (let j = 0; j < 20 && (await anyAlive(killedPids)); j++) await sleep(500)
      }
      for (const item of [...failed]) {
        const err = await rmRetry(path.join(repo, item))
        if (err) { log(`[!] Still could not remove ${item}: ${err.message}`) }
        else failed.splice(failed.indexOf(item), 1)
      }
      ok = failed.length === 0
    }
    if (!keepFolders) {
      // Remove the now-empty root last (it may be CWD-locked by a terminal window)
      const err = await rmRetry(repo)
      if (err) {
        if (ok) {
          leftoverFolder = repo
          log('[i] Installation removed, but the empty folder could not be deleted (locked by a process open in it):')
          log(`[i]   ${repo}`)
          log('[i] Close any terminal/Explorer window open in it and delete the folder manually.')
        } else {
          log(`[!] Could not remove ${repo}: ${err.message}`)
        }
      }
    }
  } catch (e) {
    log(`[!] Uninstall error: ${e.message}`)
    ok = false
  }
  return { ok, leftoverFolder, error: null }
}

ipcMain.handle('reinstall', async () => mutating('reinstall', async () => {
  send('setup-output', '[*] Preparing reinstall...\n')
  // Ask user if they want to backup plugins, finetunes, and config
  var doBackup = false
  try {
    const result = await dialog.showMessageBox({
      type: 'question', buttons: ['Backup & Restore (recommended)', 'Skip backup'],
      defaultId: 0, cancelId: 1,
      title: 'Reinstall Wan2GP',
      message: 'Do you want to backup plugins, finetunes, and config before reinstalling?',
      detail: 'A backup lets you restore your custom plugins and configuration after the fresh install. If you skip, they will be lost.'
    })
    doBackup = result.response === 0
  } catch { doBackup = true /* fallback: backup */ }
  const backupDir = path.join(getDataDir(), '.reinstall-backup')
  if (doBackup) {
    try {
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true })
      fs.mkdirSync(backupDir, { recursive: true })
      const repo = getRepoDir()
      for (const sub of ['plugins', 'finetunes']) {
        const src = path.join(repo, sub)
        if (fs.existsSync(src)) {
          if (IS_WIN) await runCmd('xcopy', ['/E', '/I', src, path.join(backupDir, sub)], { timeout: 30000 })
          else await runCmd('cp', ['-r', src, backupDir + '/'], { timeout: 30000 })
        }
      }
      const configPath = path.join(repo, 'wgp_config.json')
      if (fs.existsSync(configPath)) fs.copyFileSync(configPath, path.join(backupDir, 'wgp_config.json'))
      send('setup-output', '[*] Backed up plugins, finetunes, and config.\n')
    } catch (e) { send('setup-output', `[!] Backup warning: ${e.message}\n`) }
  } else {
    send('setup-output', '[*] Skipped backup (no plugins/config will be restored).\n')
    // Clean any stale backup
    try { if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true }) } catch {}
  }
  // Remove the existing installation with the same robust engine as uninstall —
  // a silent rmdir failure here used to leave the old tree in place and break the
  // subsequent clone.
  send('setup-output', '[*] Removing existing installation...\n')
  const repo = getRepoDir()
  if (fs.existsSync(repo)) {
    const res = await forceRemoveRepo(repo, (m) => send('setup-output', m + '\n'), null)
    if (!res.ok) {
      send('setup-output', `[!] Could not remove the existing installation${res.error ? ': ' + res.error : ''}\n`)
      send('setup-output', '[!] Close any terminal/Explorer window open in the Wan2GP folder (or wait for antivirus scanning to finish), then retry.\n')
      return false
    }
    if (res.leftoverFolder) send('setup-output', '[i] An empty locked folder remains — the fresh install will reuse it.\n')
  }
  try { fs.rmSync(getEnvsFile(), { force: true }) } catch {}
  try { fs.rmSync(path.join(getDataDir(), '.py-shim'), { recursive: true, force: true }) } catch {}
  invalidateGitCache()
  send('setup-output', '[*] Ready for fresh install.\n')
  return true
}))

ipcMain.handle('uninstall', async () => mutating('uninstall', async () => {
  const log = (m) => send('launch-log', m + '\n')
  log('[*] Preparing to uninstall Wan2GP...')
  const repo = getRepoDir()
  if (!fs.existsSync(repo)) {
    log('[!] Wan2GP is not installed (no installation folder found).')
    return { success: false, error: 'Wan2GP is not installed' }
  }
  // Which in-repo folders hold user files? Models live under ckpts/loras in the
  // current Wan2GP layout; older installs use models/; output is outputs/ or output/.
  const userFolders = ['ckpts', 'loras', 'outputs', 'output', 'models']
  const present = userFolders.filter(f => fs.existsSync(path.join(repo, f)))
  let keepFiles = false
  try {
    const result = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Uninstall (keep my files)', 'Uninstall (delete everything)', 'Cancel'],
      defaultId: 0, cancelId: 2,
      title: 'Uninstall Wan2GP',
      message: 'Remove the Wan2GP installation?',
      detail: 'This deletes the Wan2GP app, its Python environment, and all installed packages.\n\n' +
        (present.length
          ? `Keep these folders (checkpoints, LoRAs, output)?\n  ${present.map(f => path.join(repo, f)).join('\n  ')}\n\n`
          : '') +
        'Folders outside the installation (custom checkpoints/LoRA/output paths) are never touched.'
    })
    if (result.response === 2) { log('[*] Uninstall cancelled.'); return { success: false, cancelled: true } }
    keepFiles = result.response === 0
  } catch { keepFiles = false }
  log('[*] Removing installation...')
  const res = await forceRemoveRepo(repo, log, keepFiles ? userFolders : null)
  const keptPaths = keepFiles ? present.map(f => path.join(repo, f)) : []
  try { fs.rmSync(getEnvsFile(), { force: true }) } catch {}
  try { fs.rmSync(path.join(getDataDir(), '.py-shim'), { recursive: true, force: true }) } catch {}
  invalidateGitCache()
  if (!res.ok) {
    log('[!] Some files could not be deleted — they are locked by a running process, a terminal/Explorer window open in the folder, or antivirus scanning.')
    log(`[!] Close any terminal open in ${repo}, wait a moment, and retry. If it keeps failing, add the Wan2GP folder to your antivirus exclusions.`)
    return { success: false, error: 'Some files are locked (a terminal open in the folder, or antivirus scanning). Close terminals in the Wan2GP folder and retry.' }
  }
  log('[✓] Wan2GP uninstalled.')
  if (keepFiles && keptPaths.length) {
    log('[i] Kept your files (checkpoints, LoRAs, output):')
    for (const p of keptPaths) log(`[i]   ${p}`)
    log('[i] Reinstalling will reuse them automatically.')
  } else if (!res.leftoverFolder) {
    log('[i] All installation files were removed.')
  }
  return { success: true, keptFiles: keepFiles, keptPaths, leftoverFolder: res.leftoverFolder }
}))

ipcMain.handle('get-status', async () => {
  const env = getActiveEnv()
  if (!env) return { error: 'No active environment' }
  const py = getPythonForEnv(env)
  if (!py) return { error: 'No python' }
  try {
    // Write Python script to temp file to avoid shell quoting issues
    const helperPath = path.join(getDataDir(), '.get_versions.py')
    const helperCode = [
      'import sys, importlib.metadata',
      "aliases = {'triton': 'triton-windows', 'opencv-python': 'opencv',",
      "          'spas_sage_attn': 'spas-sage-attn', 'huggingface_hub': 'huggingface-hub'}",
      "pkgs = ['python','torch','triton','sageattention','spas_sage_attn','flash_attn',",
      "        'diffusers','transformers','gradio','accelerate','onnxruntime','xformers',",
      "        'nunchaku','gguf','mmgp','moviepy','opencv-python','insightface',",
      "        'peft','timm','vector_quantize_pytorch','torchcodec','torchaudio',",
      "        'huggingface_hub','bitsandbytes','numpy','sentencepiece','open_clip_torch',",
      "        'imageio','einops','librosa','soundfile','tokenizers','av']",
      'r = []',
      'for p in pkgs:',
      '    try:',
      "        if p == 'python': r.append(f'python={sys.version.split()[0]}')",
      "        elif p in aliases: r.append(f'{p}={importlib.metadata.version(aliases[p])}')",
      '        else: r.append(f\'{p}={importlib.metadata.version(p)}\')',
      '    except: pass',
      "print('||'.join(r))",
    ].join('\n')
    fs.writeFileSync(helperPath, helperCode)
    const out = await new Promise((resolve, reject) => {
      exec('"' + py + '" "' + helperPath + '"', {
        cwd: getRepoDir(), timeout: 30000, windowsHide: true, encoding: 'utf8'
      }, (err, stdout) => {
        if (err) reject(err)
        else resolve(stdout.trim())
      })
    })
    const parts = out.split('||')
    const versions = {}
    parts.forEach(p => { const [k, v] = p.split('='); versions[k] = v })
    return { env, versions }
  } catch (e) { return { env, versions: { error: e.message } } }
})

// Quick port check — true if something is listening
function checkPort(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    sock.setTimeout(timeoutMs)
    sock.on('connect', () => { sock.destroy(); resolve(true) })
    sock.on('error', () => resolve(false))
    sock.on('timeout', () => { sock.destroy(); resolve(false) })
    sock.connect(port, host)
  })
}

// ── Launch with proper port check ──
// mode: 'browser' (default, python in a visible window) | 'terminal' (run.bat style: real cmd.exe /K window)
ipcMain.handle('launch', async (_, mode = 'browser') => mutating('launch', async () => {
  if (!fs.existsSync(path.join(getRepoDir(), 'wgp.py'))) {
    throw new Error('Wan2GP is not installed. Restart the Desktop launcher to install it.')
  }
  const env = getActiveEnv()
  if (!env) throw new Error('No active environment')
  const py = getPythonForEnv(env)
  if (!py) throw new Error('Cannot find python for env')

  const cfg = loadConfig()
  let preferredPort = cfg.serverPort || 7860
  const extraArgs = (cfg.launchArgs || '').trim().split(/\s+/).filter(Boolean)
  for (let i = 0; i < extraArgs.length; i++) {
    if (extraArgs[i] === '--server-port' && i + 1 < extraArgs.length) {
      preferredPort = parseInt(extraArgs[i + 1]) || preferredPort
    }
  }
  // Ensure --server-port in args
  const hasPort = extraArgs.some(a => a === '--server-port')
  if (!hasPort) { extraArgs.push('--server-port', String(preferredPort)) }
  // Ensure --server-name is set (default 127.0.0.1 to avoid proxy/DNS issues that
  // cause Gradio 5.x to raise "When localhost is not accessible, a shareable link
  // must be created…" — see gradio-app/gradio#4046)
  const hasServerName = extraArgs.some(a => a === '--server-name')
  if (!hasServerName) { extraArgs.push('--server-name', '127.0.0.1') }
  // Add --share when enabled in settings (bypasses Gradio 5.x localhost accessibility check)
  if (cfg.share && !extraArgs.some(a => a === '--share')) {
    extraArgs.push('--share')
  }
  // GPU device picker (multi-GPU machines): inject --gpu cuda:N unless the user
  // already passed one in Extra Launch Args. 'auto' / unset = let Wan2GP pick.
  const gpuDevice = (cfg.gpuDevice || 'auto').trim()
  if (gpuDevice !== 'auto' && /^cuda:\d+$/.test(gpuDevice) && !extraArgs.some(a => a === '--gpu')) {
    extraArgs.push('--gpu', gpuDevice)
  }
  // First Block Cache / advanced UI (upstream parity): --advanced exposes the
  // "Steps skipping" tab where First Block Cache lives; --multiple-images enables
  // multi-image I2V input. Both are wgp.py CLI flags (shared/cli_args.py) that
  // the upstream start scripts pass by default — without them the post's headline
  // speed feature is invisible. Respect explicit user args (no duplication).
  if (!extraArgs.some(a => a === '--advanced')) extraArgs.push('--advanced')
  if (!extraArgs.some(a => a === '--multiple-images')) extraArgs.push('--multiple-images')
  pushAutoTunedCoefficient(extraArgs)

  const port = preferredPort
  _currentPort = port

  // If already running (e.g. from Desktop mode), just connect
  if (await checkPort('127.0.0.1', port)) {
    send('launch-log', `[*] Wan2GP already running on port ${port}. Opening browser...\n`)
    return { url: `http://127.0.0.1:${port}`, port }
  }

  send('launch-log', '[*] Starting Wan2GP...\n')
  send('launch-log', `[*] Python: ${py}\n`)
  send('launch-log', `[*] Port: ${port}\n`)
  send('launch-log', `[*] Args: ${extraArgs.join(' ')}\n`)

  // Include HF_TOKEN in spawned process env
  const launchCfg = loadConfig()

  let child = null
  if (mode === 'terminal') {
    // External-terminal mode (run.bat / desktop-shortcut style): generate a .bat (Windows) or
    // .sh (POSIX) that mirrors the launch shortcut (env activation, launch args, background
    // server, wait + open browser, "close this window to stop"), and run it in a real terminal
    // window. Not a child of the launcher — the user controls it. Stop is bulletproof via the
    // captured python PID (Node side) plus a window-title fallback on Windows.
    _terminalTitle = 'Wan2GP-Launcher-' + Date.now()
    _terminalPidFile = path.join(os.tmpdir(), 'wan2gp-terminal.pid')

    if (IS_WIN) {
      _terminalScriptFile = path.join(os.tmpdir(), 'wan2gp-terminal.bat')

      // Env activation (mirrors the desktop shortcut) so the right python is used.
      let activateLine = '', setPathLine = ''
      const envPath = path.isAbsolute(env.path) ? env.path : path.join(getRepoDir(), env.path)
      if (env.type === 'venv' || env.type === 'uv') {
        const activateScript = path.join(envPath, 'Scripts', 'activate')
        if (fs.existsSync(activateScript)) {
          activateLine = 'call "' + activateScript + '"'
          if (env.type === 'venv' || env.type === 'uv') setPathLine = 'set PATH=' + path.join(envPath, 'Scripts') + ';%PATH%'
        }
      } else if (env.type === 'conda') {
        activateLine = 'call conda activate "' + envPath + '"'
      }

      const argsStr = extraArgs.map(escapeBatCmdArg).join(' ')
      const batLines = [
        '@echo off',
        'set PYTHONIOENCODING=utf-8',
        'set PYTHONUTF8=1',
        'title ' + _terminalTitle,
        'cd /d "' + getRepoDir() + '"',
        'echo.',
        'echo [Wan2GP Desktop Launcher]',
        'echo Starting Wan2GP on port ' + preferredPort + '...',
        'echo.'
      ]
      if (activateLine) {
        batLines.push('echo Activating environment: ' + escapeBat(env.name) + ' (' + escapeBat(env.type) + ')')
        batLines.push(activateLine)
        if (setPathLine) batLines.push(setPathLine)
        batLines.push('echo.')
      }
      batLines.push('echo Starting wgp.py in background...')
      batLines.push(`start /b "" cmd /c "python -u "${bootstrapScriptPath()}" wgp.py ${argsStr}" 2>&1`)
      batLines.push('echo.')
      batLines.push('echo Waiting for Wan2GP server on port ' + preferredPort + '...')
      batLines.push('set RETRY_COUNT=0')
      batLines.push(':waitloop')
      batLines.push('timeout /t 2 /nobreak >nul')
      batLines.push('set /a RETRY_COUNT+=1')
      batLines.push('if %RETRY_COUNT% gtr 60 (echo Server failed to start within 2 minutes. Check console for errors. ^& pause ^& exit /b 1)')
      batLines.push('powershell -Command "try{$(Invoke-WebRequest -Uri http://127.0.0.1:' + preferredPort + '/config -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200;exit 0}catch{exit 1}" >nul 2>&1 && goto ready')
      batLines.push('goto waitloop')
      batLines.push(':ready')
      batLines.push('echo Wan2GP is ready! Opening browser...')
      batLines.push('start http://127.0.0.1:' + preferredPort)
      batLines.push('echo.')
      batLines.push('echo [Wan2GP] Server is running. Close this window to stop it.')
      batLines.push('pause >nul')
      try { fs.writeFileSync(_terminalScriptFile, batLines.join('\r\n'), 'utf8') } catch (e) { send('launch-log', `[!] Failed to write terminal script: ${e.message}\n`) }

      let useWt = false
      try { execSync('where wt', { windowsHide: true, timeout: 3000 }); useWt = true } catch {}
      if (useWt) {
        send('launch-log', '[*] Starting Wan2GP in Windows Terminal (run.bat style)...\n')
        child = spawn('wt.exe', ['-w', '-1', 'new-tab', '--title', _terminalTitle, 'cmd.exe', '/K', _terminalScriptFile], {
          cwd: getRepoDir(), windowsHide: false, stdio: ['ignore', 'ignore', 'ignore'],
          env: {
            ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
            TQDM_MININTERVAL: '0', TQDM_MINITERS: '1', HF_HUB_DISABLE_PROGRESS_BARS: '0',
            NO_PROXY: 'localhost,127.0.0.1,::1',
            ...(launchCfg.share ? { GRADIO_SHARE: 'true' } : {}),
            ...(launchCfg.hfToken ? { HF_TOKEN: launchCfg.hfToken, HUGGINGFACE_HUB_TOKEN: launchCfg.hfToken } : {})
          }
        })
      } else {
        send('launch-log', '[*] Starting Wan2GP in an external terminal window (run.bat style)...\n')
        child = spawn('cmd.exe', ['/c', 'start', `"${_terminalTitle}"`, 'cmd.exe', '/K', _terminalScriptFile], {
          cwd: getRepoDir(), windowsHide: false, stdio: ['ignore', 'ignore', 'ignore'],
          env: {
            ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
            TQDM_MININTERVAL: '0', TQDM_MINITERS: '1', HF_HUB_DISABLE_PROGRESS_BARS: '0',
            NO_PROXY: 'localhost,127.0.0.1,::1',
            ...(launchCfg.share ? { GRADIO_SHARE: 'true' } : {}),
            ...(launchCfg.hfToken ? { HF_TOKEN: launchCfg.hfToken, HUGGINGFACE_HUB_TOKEN: launchCfg.hfToken } : {})
          }
        })
      }
    } else {
      // POSIX external-terminal mode: write a bash script that launches wgp.py with the resolved
      // interpreter (no activation needed — the absolute python path IS the environment), waits
      // for the server, opens the browser, then blocks until the server exits. Closing the
      // terminal window sends SIGHUP and stops the server, mirroring the Windows .bat behavior.
      _terminalScriptFile = path.join(os.tmpdir(), 'wan2gp-terminal.sh')

      // Shell-quote a value for safe embedding in the generated script.
      const shq = (s) => "'" + String(s).replace(/'/g, `'\\''`) + "'"
      const argsStr = extraArgs.map(shq).join(' ')
      const shLines = [
        '#!/usr/bin/env bash',
        'export PYTHONIOENCODING=utf-8',
        'export PYTHONUTF8=1',
        'export PYTHONUNBUFFERED=1',
        'export TQDM_MININTERVAL=0',
        'export TQDM_MINITERS=1',
        'export HF_HUB_DISABLE_PROGRESS_BARS=0',
        'export NO_PROXY=localhost,127.0.0.1,::1',
        ...(launchCfg.share ? ['export GRADIO_SHARE=true'] : []),
        ...(launchCfg.hfToken ? ['export HF_TOKEN=' + shq(launchCfg.hfToken), 'export HUGGINGFACE_HUB_TOKEN=' + shq(launchCfg.hfToken)] : []),
        'cd ' + shq(getRepoDir()),
        'echo "[Wan2GP Desktop Launcher]"',
        'echo "Starting Wan2GP on port ' + preferredPort + '..."',
        'echo ""',
        shq(py) + ' -u ' + shq(bootstrapScriptPath()) + ' wgp.py ' + argsStr + ' &',
        'WGP_PID=$!',
        'echo "$WGP_PID" > ' + shq(_terminalPidFile),
        'echo ""',
        'echo "Waiting for Wan2GP server on port ' + preferredPort + '..."',
        'RETRY=0',
        'while [ $RETRY -lt 60 ]; do',
        '  if ' + shq(py) + ` -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:${preferredPort}/config', timeout=2).status==200 else 1)" >/dev/null 2>&1; then`,
        '    break',
        '  fi',
        '  sleep 2',
        '  RETRY=$((RETRY+1))',
        'done',
        'if [ $RETRY -ge 60 ]; then',
        '  echo "Server failed to start within 2 minutes. Check console for errors."',
        '  read -r -p "Press Enter to close..."',
        '  exit 1',
        'fi',
        'echo "Wan2GP is ready! Opening browser..."',
        'xdg-open "http://127.0.0.1:' + preferredPort + '" >/dev/null 2>&1 &',
        'echo ""',
        'echo "[Wan2GP] Server is running. Close this window to stop it."',
        'wait $WGP_PID'
      ]
      try { fs.writeFileSync(_terminalScriptFile, shLines.join('\n') + '\n', 'utf8') } catch (e) { send('launch-log', `[!] Failed to write terminal script: ${e.message}\n`) }
      try { fs.chmodSync(_terminalScriptFile, 0o755) } catch {}

      // Launch in a detected terminal emulator (Linux), or Terminal.app (macOS).
      if (PLATFORM === 'darwin') {
        send('launch-log', '[*] Starting Wan2GP in Terminal.app...\n')
        child = spawn('open', ['-a', 'Terminal', _terminalScriptFile], {
          cwd: getRepoDir(), stdio: ['ignore', 'ignore', 'ignore']
        })
      } else {
        const term = findTerminalEmulator()
        if (!term) {
          send('launch-log', '[!] No terminal emulator found (tried gnome-terminal, konsole, xfce4-terminal, mate-terminal, xterm). Install one or use the in-app/desktop launch mode.\n')
          child = null
        } else {
          send('launch-log', `[*] Starting Wan2GP in ${term} (run.bat style)...\n`)
          if (term === 'gnome-terminal') {
            child = spawn(term, ['--', 'bash', _terminalScriptFile], { cwd: getRepoDir(), stdio: ['ignore', 'ignore', 'ignore'] })
          } else if (term === 'xterm') {
            child = spawn(term, ['-e', 'bash', _terminalScriptFile], { cwd: getRepoDir(), stdio: ['ignore', 'ignore', 'ignore'] })
          } else {
            // konsole/xfce4-terminal/mate-terminal/tilix/x-terminal-emulator take the whole
            // command as one string after -e.
            child = spawn(term, ['-e', `bash ${_terminalScriptFile}`], { cwd: getRepoDir(), stdio: ['ignore', 'ignore', 'ignore'] })
          }
        }
      }
    }
    // The launcher-side process (wt.exe / terminal wrapper) exits independently — it is NOT the server.
    _wangpProc = null
  } else {
    send('launch-log', '[*] Starting Wan2GP in a visible terminal...\n')
    child = spawn(py, ['-u', bootstrapScriptPath(), 'wgp.py', ...extraArgs], {
      cwd: getRepoDir(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false,
      env: {
        ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
        TQDM_MININTERVAL: '0', TQDM_MINITERS: '1', HF_HUB_DISABLE_PROGRESS_BARS: '0',
        NO_PROXY: 'localhost,127.0.0.1,::1',
        ...(launchCfg.share ? { GRADIO_SHARE: 'true' } : {}),
        ...(launchCfg.hfToken ? { HF_TOKEN: launchCfg.hfToken, HUGGINGFACE_HUB_TOKEN: launchCfg.hfToken } : {})
      }
    })
    _wangpProc = child
    child.stdout.on('data', d => { const s = d.toString(); if (s) { send('launch-log', s); notifyFromLog(s) } })
    child.stderr.on('data', d => { 
      const s = d.toString();
      if (s) {
        send('launch-log', s)
        notifyFromLog(s)
        if (s.includes('localhost is not accessible') || s.includes('shareable link must be created')) {
          send('launch-log', '[!] Gradio localhost check failed. If this persists, enable "Share Link" in Settings (Manage → Launch tab) or add --share to Extra Launch Args.\n')
        }
      }
    })
  }
  if (child && mode !== 'terminal') {
    child.on('close', code => {
      _wangpProc = null; _currentPort = 0
      send('launch-log', `[!] Wan2GP process exited (code ${code})\n`)
      send('wangp-exit', code)
      try {
        if (loadConfig().notificationsEnabled !== false) {
          // Surface the last real output lines so a crash (exit 1) carries a hint
          // of what went wrong instead of a bare exit code.
          const tail = _logHistory
            .filter(e => e.channel === 'launch-log')
            .slice(-8)
            .map(e => e.data.replace(/\s+$/, '').trim())
            .filter(Boolean)
            .slice(-4)
            .join('\n')
          const body = 'Server has stopped (exit ' + code + ').' + (tail ? '\n\nLast output:\n' + tail : '')
          new Notification({ title: 'Wan2GP', body }).show()
        }
      } catch {}
    })
  }

  send('launch-log', '[*] Waiting for Gradio server...\n')
  try {
    await waitForPort('127.0.0.1', port, 180000)
    // For external-terminal mode, capture the python PID now (server is up) for a bulletproof Stop.
    if (mode === 'terminal') {
      const pid = findWan2gpPid()
      if (pid) { try { fs.writeFileSync(_terminalPidFile, String(pid), 'utf8') } catch {} }
    }
    send('launch-log', '[*] Wan2GP is ready!\n')
    // Desktop notification
    try { if (loadConfig().notificationsEnabled !== false) new Notification({ title: 'Wan2GP', body: 'Server is ready on port ' + port }).show() } catch {}
    // Monitor process — report when it stops (terminal closed / crash).
    // Tracked so explicit stop via stopWangpServer() clears it immediately.
    // Terminal mode ONLY: the launcher has no child handle there (the server
    // runs inside the user's terminal), so the port poll is the only exit
    // signal. Browser/webview mode already reaps through the child 'close'
    // handler — running the poll there too fired duplicate wangp-exit events
    // and double notifications.
    if (mode === 'terminal') {
      _monitorInterval = setInterval(() => {
        const sock = new net.Socket()
        sock.setTimeout(2000)
        sock.on('connect', () => { sock.destroy() })
        sock.on('error', () => {
          sock.destroy()
          if (_monitorInterval) { clearInterval(_monitorInterval); _monitorInterval = null }
          _terminalTitle = null
          _currentPort = 0
          if (_terminalPidFile) { try { fs.unlinkSync(_terminalPidFile) } catch {} _terminalPidFile = null }
          if (_terminalScriptFile) { try { fs.unlinkSync(_terminalScriptFile) } catch {} _terminalScriptFile = null }
          send('launch-log', '[!] Wan2GP process closed (terminal window or server stopped).\n')
          send('wangp-exit', -1)
          try { if (loadConfig().notificationsEnabled !== false) new Notification({ title: 'Wan2GP', body: 'Server has stopped.' }).show() } catch {}
        })
        sock.on('timeout', () => { sock.destroy() })
        sock.connect(port, '127.0.0.1')
      }, 8000)
    }
    return { url: `http://127.0.0.1:${port}`, port }
  } catch (err) {
    // Never leave an orphaned server process holding the port: waitForPort
    // threw before the close handler could reap the child (browser mode).
    if (child && mode !== 'terminal') { killProcessTree(child); _wangpProc = null; _currentPort = 0 }
    throw err
  }
}))

// ── Launch in-app (direct spawn, streams to console) ──
ipcMain.handle('launch-webview', async () => {
  const env = getActiveEnv()
  if (!env) throw new Error('No active environment')
  const py = getPythonForEnv(env)
  if (!py) throw new Error('Cannot find python for env')

  const cfg = loadConfig()
  let port = cfg.serverPort || 7860
  const extraArgs = (cfg.launchArgs || '').trim().split(/\s+/).filter(Boolean)
  if (!extraArgs.some(a => a === '--server-port')) extraArgs.push('--server-port', String(port))
  if (!extraArgs.some(a => a === '--server-name')) extraArgs.push('--server-name', '127.0.0.1')
  // Add --share when enabled in settings (bypasses Gradio 5.x localhost accessibility check)
  if (cfg.share && !extraArgs.some(a => a === '--share')) {
    extraArgs.push('--share')
  }
  // GPU device picker (multi-GPU machines): inject --gpu cuda:N unless the user
  // already passed one in Extra Launch Args. 'auto' / unset = let Wan2GP pick.
  const gpuDevice = (cfg.gpuDevice || 'auto').trim()
  if (gpuDevice !== 'auto' && /^cuda:\d+$/.test(gpuDevice) && !extraArgs.some(a => a === '--gpu')) {
    extraArgs.push('--gpu', gpuDevice)
  }
  // First Block Cache / advanced UI (upstream parity) — see launch handler.
  if (!extraArgs.some(a => a === '--advanced')) extraArgs.push('--advanced')
  if (!extraArgs.some(a => a === '--multiple-images')) extraArgs.push('--multiple-images')
  pushAutoTunedCoefficient(extraArgs)
  _currentPort = port

  // If already running (e.g. from browser launch), just connect
  if (await checkPort('127.0.0.1', port)) {
    send('launch-log', `[*] Wan2GP already running on port ${port}. Connecting...\n`)
    return { url: `http://127.0.0.1:${port}`, port }
  }

  send('launch-log', `[*] Starting Wan2GP in-app on port ${port}...\n`)
  const proc = spawn(py, ['-u', bootstrapScriptPath(), 'wgp.py', ...extraArgs], {
    cwd: getRepoDir(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
      TQDM_MININTERVAL: '0', TQDM_MINITERS: '1', HF_HUB_DISABLE_PROGRESS_BARS: '0',
      NO_PROXY: 'localhost,127.0.0.1,::1',
      ...(cfg.share ? { GRADIO_SHARE: 'true' } : {}),
      ...(cfg.hfToken ? { HF_TOKEN: cfg.hfToken, HUGGINGFACE_HUB_TOKEN: cfg.hfToken } : {}) }
  })
  _wangpProc = proc
  proc.stdout.on('data', d => { const s = d.toString(); if (s) send('launch-log', s) })
  proc.stderr.on('data', d => { 
    const s = d.toString();
    if (s) {
      send('launch-log', s)
      if (s.includes('localhost is not accessible') || s.includes('shareable link must be created')) {
        send('launch-log', '[!] Gradio localhost check failed. Enable "Share Link" in Settings (Manage → Launch tab) or add --share to Extra Launch Args.\n')
      }
    }
  })
  proc.on('close', code => { _wangpProc = null; _currentPort = 0; send('launch-log', `[!] Wan2GP process exited (code ${code})\n`); send('wangp-exit', code); try { if (loadConfig().notificationsEnabled !== false) new Notification({ title: 'Wan2GP', body: 'Server has stopped (exit ' + code + ').' }).show() } catch {} })
  try {
    await waitForPort('127.0.0.1', port, 180000)
    send('launch-log', '[*] Wan2GP is ready!\n')
    try { if (loadConfig().notificationsEnabled !== false) new Notification({ title: 'Wan2GP', body: 'Server is ready on port ' + port }).show() } catch {}
    return { url: `http://127.0.0.1:${port}`, port }
  } catch (err) { killProcessTree(_wangpProc); _wangpProc = null; throw err }
})

ipcMain.handle('stop-wangp', () => { stopWangpServer() })
ipcMain.handle('is-wangp-running', () => _wangpProc !== null || _currentPort > 0)

// ── Phase 4: Pop-out webview ──
let detachedWin = null
ipcMain.handle('popout-webview', (_, url) => {
  try {
    detachedWin = new BrowserWindow({
      width: 1280, height: 800, title: 'Wan2GP',
    })
    detachedWin.loadURL(url)
    watchRenderer(detachedWin.webContents, 'pop-out', () => {
      setTimeout(() => {
        if (!detachedWin || detachedWin.isDestroyed()) return
        try { detachedWin.webContents.reload() } catch {}
      }, 1000)
    })
    detachedWin.on('closed', () => { detachedWin = null; mainWin?.webContents.send('webview-returned') })
    return { success: true }
  } catch (e) { return { error: e.message } }
})

// ── Wan2GP embedded via BrowserView (renders reliably on Electron 40; <webview>/<iframe>
//     both fail: <webview> is blank on E40, <iframe> hits gradio#11553 manifest 404 → blank).
//     BrowserView can intercept /manifest.json (serve stub). Panels (terminal/Manage) don't
//     sit ABOVE a BrowserView (compositor layer), so instead we SHRINK the BrowserView bounds
//     to make room — Wan2GP stays live and visible, no black gap. ──
const TOPBAR_H = 44
const MANAGE_W = 420
let _bv = null
let _bvResizeHandler = null
let _ftDock = 'bottom'   // terminal dock: bottom | top | left | right | floating
let _panel = null        // null | 'term' | 'manage' — which panel is open

function bvBounds() {
  if (!_bv || !mainWin) return
  const b = mainWin.getContentBounds()
  let x = 0, y = TOPBAR_H, w = b.width, h = b.height - TOPBAR_H
  if (_panel === 'term') {
    switch (_ftDock) {
      case 'left':   x += 340; w -= 340; break
      case 'right':  w -= 340; break
      case 'top':    y += 200; h -= 200; break
      case 'bottom': h -= 200; break
      // floating terminal sits top-right (right:60, top:80, 480x320) — keep Wan2GP on its left
      case 'floating': w = Math.max(0, b.width - 60 - 480); break
    }
  } else if (_panel === 'manage') {
    w -= MANAGE_W   // drawer is 420px on the right
  }
  _bv.setBounds({ x, y, width: w, height: h })
}

ipcMain.handle('create-browser-view', (_, url) => {
  try {
    if (!_bv) {
      _bv = new BrowserView({ webPreferences: { nodeIntegration: false, contextIsolation: true } })
      // Serve a stub PWA manifest so Gradio 5.36.x doesn't 404 + blank the page (gradio#11553)
      _bv.webContents.session.webRequest.onBeforeRequest((details, cb) => {
        if (/\/manifest\.json(\?.*)?$/i.test(details.url)) {
          cb({ respondWith: {
            statusCode: 200,
            contentType: 'application/manifest+json',
            data: Buffer.from(JSON.stringify({ name: 'Wan2GP', start_url: '.', display: 'standalone' })),
          }})
        } else cb({})
      })
      // Crash watchdog: the embedded Wan2GP page shares the same GPU/driver
      // risk as the launcher UI — reload it so the UI comes back (the server
      // never stopped, so a generation keeps running regardless).
      watchRenderer(_bv.webContents, 'Wan2GP embed', () => {
        if (!_bvUrl) return
        setTimeout(() => {
          if (!_bv || _bv.webContents.isDestroyed()) return
          send('launch-log', '[!] Embedded Wan2GP view crashed — reloading it. The server keeps running, generation is unaffected.\n')
          try { _bv.webContents.loadURL(_bvUrl) } catch (e) { logError('bv-reload', e) }
        }, 1200)
        try { mainWin?.webContents.send('bv-crash-recovered') } catch {}
      })
      // Wire resize only once (view is created once and reused thereafter)
      if (_bvResizeHandler) mainWin.removeListener('resize', _bvResizeHandler)
      _bvResizeHandler = () => bvBounds()
      mainWin.on('resize', _bvResizeHandler)
    }
    // Re-add if it was detached on a previous "back to dashboard" (view is kept alive,
    // never destroyed, so re-adding + reload avoids the blank-paint race on recreate).
    const attached = mainWin.getBrowserViews().includes(_bv)
    if (!attached) mainWin.addBrowserView(_bv)
    if (typeof url === 'string') _bvUrl = url
    _panel = null
    bvBounds()
    _bv.webContents.loadURL(url)
    return { success: true }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('show-browser-view', () => {
  // Panel closed → Wan2GP takes the full area again
  _panel = null
  bvBounds()
})
ipcMain.handle('hide-browser-view', (_, panel) => {
  // Panel open → shrink Wan2GP to make room (no remove → no black flash)
  _panel = panel === 'manage' ? 'manage' : 'term'
  bvBounds()
})
ipcMain.handle('destroy-browser-view', () => {
  try {
    // Detach from the window only — keep the view object alive so the next launch can
    // re-add + reload it. Destroying + recreating is what blanks the 2nd desktop launch
    // (async C++ compositor teardown races the new view's add+load).
    if (_bv) { mainWin.removeBrowserView(_bv) }
    if (_bvResizeHandler) { mainWin.removeListener('resize', _bvResizeHandler); _bvResizeHandler = null }
    return { success: true }
  } catch (e) { return { error: e.message } }
})

// Detach the BrowserView from the window so a DOM panel (Manage) can render in front of
// it — a BrowserView always composites above DOM, so it must be removed to show UI on top.
// The view object stays alive; reattach restores its frame without a reload.
ipcMain.handle('detach-browser-view', () => {
  try {
    if (_bv) mainWin.removeBrowserView(_bv)
    return { success: true }
  } catch (e) { return { error: e.message } }
})
ipcMain.handle('reattach-browser-view', () => {
  try {
    if (_bv && !mainWin.getBrowserViews().includes(_bv)) mainWin.addBrowserView(_bv)
    // Always restore the full view — even if already attached, the terminal may have left
    // _panel='term' set, which would keep the BrowserView shrunk (grey gap on close).
    _panel = null
    bvBounds()
    return { success: true }
  } catch (e) { return { error: e.message } }
})

// ── Floating-terminal window (a SEPARATE, movable BrowserWindow) ──
// For the 'floating' dock the console must be a real window so it can be dragged onto another
// monitor and is not confined inside the main Electron window. Wan2GP stays full + interactable;
// the console lives in its own window (parented so it groups with / closes with the app).
let _termWin = null
ipcMain.handle('create-term-view', () => {
  try {
    if (!_termWin) {
      _termWin = new BrowserWindow({
        width: 480, height: 320, minWidth: 320, minHeight: 160,
        title: 'Wan2GP Console',
        backgroundColor: '#0d0f14',
        parent: mainWin,
        webPreferences: { preload: path.join(__dirname, 'renderer', 'term-preload.js'), nodeIntegration: false, contextIsolation: true }
      })
      _termWin.loadURL('file://' + path.join(__dirname, 'renderer', 'term.html'))
      watchRenderer(_termWin.webContents, 'floating console', () => {
        setTimeout(() => {
          if (!_termWin || _termWin.isDestroyed()) return
          try { _termWin.webContents.reload() } catch {}
        }, 1000)
      })
      _termWin.on('closed', () => { _termWin = null })
    }
    return { success: true }
  } catch (e) { return { error: e.message } }
})
ipcMain.handle('destroy-term-view', () => {
  try {
    if (_termWin) { _termWin.close(); _termWin = null }
    return { success: true }
  } catch (e) { return { error: e.message } }
})
// Dock change coming from the floating window itself → tell the renderer to switch modes.
ipcMain.handle('term-set-dock', (_, dock) => {
  mainWin?.webContents.send('term-dock-changed', dock)
  return { success: true }
})
ipcMain.handle('term-close', () => {
  mainWin?.webContents.send('term-closed')
  return { success: true }
})
ipcMain.handle('term-export', async (_, text) => {
  try {
    const { filePath } = await dialog.showSaveDialog(_termWin || mainWin, { defaultPath: 'wan2gp-console.log', filters: [{ name: 'Log', extensions: ['log', 'txt'] }] })
    if (filePath) fs.writeFileSync(filePath, text || '')
    return { success: true }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('get-log-history', () => {
  return _logHistory
})

ipcMain.handle('bv-set-dock', (_, dock) => {
  _ftDock = dock
  bvBounds()
})

ipcMain.handle('bv-navigate', (_, action) => {
  if (!_bv) return
  switch (action) {
    case 'back': _bv.webContents.goBack(); break
    case 'forward': _bv.webContents.goForward(); break
    case 'reload': _bv.webContents.reload(); break
  }
  // Update navigation state after a short delay to let Chromium process the navigation
  setTimeout(() => sendNavState(), 100)
})
ipcMain.handle('bv-nav-state', () => {
  if (!_bv) return { canGoBack: false, canGoForward: false }
  return { canGoBack: _bv.webContents.canGoBack(), canGoForward: _bv.webContents.canGoForward() }
})

function sendNavState() {
  if (!mainWin || !_bv) return
  mainWin.webContents.send('bv-nav-state', {
    canGoBack: _bv.webContents.canGoBack(),
    canGoForward: _bv.webContents.canGoForward()
  })
}
ipcMain.handle('bv-set-zoom', (_, factor) => {
  if (_bv) _bv.webContents.setZoomLevel(Math.log2(factor))
})

ipcMain.handle('update', async () => mutating('update', async () => {
  // NVIDIA driver pre-check (upstream parity) — same gate as install; cu130 wheels
  // need R580+, and setup.py's own pull/install won't warn about it.
  const _drvWarn = checkNvidiaDriver()
  if (_drvWarn) send('launch-log', _drvWarn)
  // Pre-flight: a present-but-broken .git (empty folder, stray .git file,
  // AV-quarantined internals — see repoGitHealth) makes EVERY git command fail
  // with "fatal: not a git repository" AND bypasses setup.py's repair path, which
  // only re-inits when .git is absent. Move the broken .git aside so setup.py's
  // built-in repair (git init → fetch origin → reset --hard origin/main) can
  // rebuild the repository. Models, plugins, finetunes and config all live
  // outside .git, so nothing user-visible is lost. (issue #27)
  if (repoGitHealth() === 'broken') {
    const brokenGit = path.join(getRepoDir(), '.git')
    const backupGit = brokenGit + '.broken-' + Date.now()
    try {
      fs.renameSync(brokenGit, backupGit)
      invalidateGitCache()
      send('launch-log', `[!] Wan2GP's .git folder is corrupted or incomplete (not a valid git repository). Moving it to ${backupGit} so the repository can be rebuilt automatically. Your models, plugins, finetunes and settings are untouched.\n`)
    } catch (e) {
      send('launch-log', `[!] Could not move the broken .git aside: ${e.message}. Delete ${brokenGit} manually (it contains no user data) and retry Update.\n`)
    }
  }
  // Snapshot the pre-update HEAD so we can detect requirements.txt changes after the
  // reliable git reset below. setup.py update only installs requirements when ITS OWN
  // git pull moved HEAD — if that pull no-ops or fails while the launcher's reset still
  // lands new code, a pin bump (e.g. mmgp 3.7.11 -> 3.7.12) is silently skipped.
  let oldHead = ''
  try {
    oldHead = await runCmd('git', ['rev-parse', 'HEAD'], { cwd: getRepoDir(), timeout: 5000 })
  } catch {}
  // Run setup.py update (pip packages, etc.). A failure here must NOT abort the
  // whole update: the launcher's own git fetch/reset below is authoritative for
  // code, and a transient setup.py error (dep install hiccup, missing torch at
  // bootstrap) shouldn't leave the repo stuck on old code with no recovery.
  try {
    await runSetup(['update'])
  } catch (e) {
    send('launch-log', `[!] setup.py update failed: ${(e.stderr || e.message || String(e)).toString().trim()} — continuing with launcher-side git update...\n`)
  }
  // Also pull the latest git code — setup.py update alone may only upgrade deps.
  // First, check which branch we're on so we pull the right one.
  let branch = ''
  try {
    branch = await runCmd('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: getRepoDir(), timeout: 5000 })
    send('launch-log', `[*] Current branch: ${branch}\n`)
  } catch (e) {
    send('launch-log', `[!] Could not detect git branch: ${e.message}\n`)
  }
  if (branch) {
    const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' }
    // Diagnostic: log remote URL so we can confirm where origin points
    try {
      const remoteUrl = await runCmd('git', ['remote', 'get-url', 'origin'], { cwd: getRepoDir(), timeout: 5000 })
      send('launch-log', `[*] Remote origin: ${remoteUrl}\n`)
    } catch (e) {
      send('launch-log', `[!] Cannot get remote URL: ${e.message}\n`)
      invalidateGitCache()
      return true
    }
    // Diagnose: what does the remote actually advertise vs what origin/main tracks vs upstream API
    try {
      const lsRemote = await runCmd('git', ['ls-remote', 'origin', 'main'], { cwd: getRepoDir(), timeout: 15000, env: gitEnv })
      send('launch-log', `[*] Remote main via ls-remote: ${lsRemote}\n`)
    } catch (e) {
      send('launch-log', `[!] ls-remote failed: ${(e.stderr||e.message).toString().trim()}\n`)
    }
    // Show current origin/main tracking ref (local cache of what remote had last fetch)
    try {
      const originMain = await runCmd('git', ['rev-parse', 'origin/main'], { cwd: getRepoDir(), timeout: 5000 })
      send('launch-log', `[*] Local origin/main: ${originMain.substring(0,12)}\n`)
    } catch (e) {}
    // Guard: branch comes from the local repo's own HEAD ref. execFile argv is
    // shell-safe, but a name starting with '-' could still be read as a git
    // option — validate before it reaches git.
    if (!/^[A-Za-z0-9._/\\-]+$/.test(branch)) {
      send('launch-log', `[!] Unusual branch name "${branch}" — skipping git fetch/reset.\n`)
      invalidateGitCache()
      return true
    }
    send('launch-log', `[*] Fetching origin --prune ${branch}...\n`)
    try {
      await runCmd('git', ['fetch', 'origin', '--prune', branch], { cwd: getRepoDir(), timeout: 30000, env: gitEnv })
      // Dirty-repo guard: any tracked-file edit (e.g. a user-patched wgp.py)
      // would be silently destroyed by the hard reset below — back it up first.
      // Untracked files (envs.json, models/, ...) are NOT touched by
      // `git reset --hard`, so they need no backup and must not warn.
      try {
        const diff = await runCmd('git', ['diff'], { cwd: getRepoDir(), timeout: 10000 })
        if (diff) {
          const patchDir = path.join(getDataDir(), 'patches')
          fs.mkdirSync(patchDir, { recursive: true })
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
          const patchFile = path.join(patchDir, `pre-update-${stamp}.patch`)
          try {
            fs.writeFileSync(patchFile, diff)
            send('launch-log', `[!] Local changes in the Wan2GP repo will be overwritten — backup saved: ${patchFile}\n`)
          } catch (e) {
            send('launch-log', `[!] Local changes detected but could not be backed up: ${e.message}\n`)
          }
        }
      } catch (e) {
        send('launch-log', `[!] Local changes detected but could not be backed up: ${e.message}\n`)
      }
      // Force the local branch to match origin's branch.
      // git merge --ff-only was unreliable (says up-to-date even when behind),
      // so we reset the branch ref directly ensuring HEAD always matches origin.
      send('launch-log', `[*] Resetting ${branch} to origin/${branch}...\n`)
      await runCmd('git', ['reset', '--hard', `origin/${branch}`], { cwd: getRepoDir(), timeout: 15000, env: gitEnv })
      const newHash = await runCmd('git', ['rev-parse', 'HEAD'], { cwd: getRepoDir(), timeout: 5000 })
      send('launch-log', `[*] HEAD is now ${newHash.substring(0,12)}\n`)
    } catch (e) {
      const errMsg = (e.stderr || e.message || String(e)).toString().trim()
      send('launch-log', `[!] git update failed: ${errMsg}\n`)
    }
  }
  // If requirements.txt changed between the pre-update HEAD and the now-reset HEAD,
  // setup.py update may have installed against the OLD requirements (its own git pull
  // either no-opped or failed; only the launcher's reset above is authoritative).
  // Force a requirements reinstall so pin bumps (e.g. mmgp 3.7.11 -> 3.7.12) land.
  try {
    if (oldHead) {
      const reqChanged = await runCmd('git', ['diff', '--name-only', oldHead, 'HEAD', '--', 'requirements.txt'], { cwd: getRepoDir(), timeout: 10000 })
      if (reqChanged) {
        send('launch-log', `[*] requirements.txt changed since v${oldHead.substring(0,8)} — reinstalling dependencies...\n`)
        const env = getActiveEnv()
        const py = env ? getPythonForEnv(env) : null
        if (!py) {
          send('launch-log', '[!] No active environment — requirements install skipped. Run setup from the Manage tab.\n')
        } else {
          await new Promise((resolve, reject) => {
            const proc = spawn(py, ['-m', 'pip', 'install', '-r', 'requirements.txt'], {
              cwd: getRepoDir(), windowsHide: true,
              env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
                TQDM_MININTERVAL: '0', TQDM_MINITERS: '1', HF_HUB_DISABLE_PROGRESS_BARS: '0' }
            })
            proc.stdout.on('data', (d) => { const s = d.toString(); if (s) send('launch-log', s) })
            proc.stderr.on('data', (d) => { const s = d.toString(); if (s) send('launch-log', s) })
            proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('pip install -r requirements.txt exited code ' + code)))
            proc.on('error', reject)
          })
          send('launch-log', `[*] Dependencies reinstalled from updated requirements.txt.\n`)
        }
      }
    }
  } catch (e) {
    send('launch-log', `[!] requirements reinstall check failed: ${(e.stderr || e.message || String(e)).toString().trim()}\n`)
  }
  // AMD/Windows numpy pin (upstream parity) — re-applied after any requirements
  // reinstall above, since requirements.txt itself pins numpy==2.1.2 which breaks
  // the ROCm "TheRock" torch wheels on Windows/AMD.
  try {
    const _gpuUpd = (await autoTune.detectGpuInfo().catch(() => null)) || getGpuInfo()
    if (IS_WIN && _gpuUpd.vendor === 'AMD') {
      const _envUpd = getActiveEnv()
      const _pyUpd = _envUpd ? getPythonForEnv(_envUpd) : null
      if (_pyUpd) {
        send('launch-log', '[*] AMD GPU detected on Windows — pinning numpy==1.26.4 (ROCm torch compatibility)...\n')
        await new Promise((resolve) => {
          const _p = spawn(_pyUpd, ['-m', 'pip', 'install', 'numpy==1.26.4', '-q'], {
            cwd: getRepoDir(), windowsHide: true,
            env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
          })
          _p.on('close', () => resolve())
          _p.on('error', () => resolve())
        })
      }
    }
  } catch (e) {
    send('launch-log', `[!] AMD numpy pin: ${(e.stderr || e.message || String(e)).toString().trim()}\n`)
  }
  invalidateGitCache() // don't return stale pre-update hashes
  return true
}))

ipcMain.handle('manage-list', () => {
  try {
    if (!fs.existsSync(getEnvsFile())) return []
    const d = JSON.parse(fs.readFileSync(getEnvsFile(), 'utf8'))
    return Object.entries(d.envs).map(([name, info]) => ({ name, ...info, active: name === d.active }))
  } catch { return [] }
})

ipcMain.handle('manage-active', () => {
  try {
    if (!fs.existsSync(getEnvsFile())) return null
    const d = JSON.parse(fs.readFileSync(getEnvsFile(), 'utf8'))
    return d.active || null
  } catch { return null }
})

ipcMain.handle('manage-set-active', (_, name) => {
  const d = JSON.parse(fs.readFileSync(getEnvsFile(), 'utf8'))
  d.active = name
  fs.writeFileSync(getEnvsFile(), JSON.stringify(d, null, 4))
  return true
})

ipcMain.handle('manage-delete', async (_, name) => {
  const d = JSON.parse(fs.readFileSync(getEnvsFile(), 'utf8'))
  const entry = d.envs[name]
  if (entry?.path && entry.type !== 'none') {
    const envPath = path.isAbsolute(entry.path) ? entry.path : path.join(getRepoDir(), entry.path)
    // Same containment guard uninstall-env applies: never rm -rf a path that
    // resolves outside the repo (a corrupted envs.json entry must not be able
    // to delete arbitrary folders).
    if (!ensureInsideRepo(envPath)) {
      return { error: 'Environment path outside repo — deletion blocked' }
    }
    if (fs.existsSync(envPath)) {
      await runCmd(IS_WIN ? 'rmdir' : 'rm', IS_WIN ? ['/s', '/q', envPath] : ['-rf', envPath])
    }
  }
  delete d.envs[name]
  if (d.active === name) {
    const keys = Object.keys(d.envs)
    d.active = keys.length > 0 ? keys[0] : null
  }
  fs.writeFileSync(getEnvsFile(), JSON.stringify(d, null, 4))
  return true
})

// ── Uninstall single environment (keep repo/data) ──
ipcMain.handle('uninstall-env', async (_, name) => {
  const asyncExec = (cmd, opts) => new Promise((resolve, reject) => {
    exec(cmd, opts, (err, stdout) => err ? reject(err) : resolve((stdout || '').trim()))
  })
  const d = JSON.parse(fs.readFileSync(getEnvsFile(), 'utf8'))
  const entry = d.envs[name]
  if (!entry) return { error: 'Environment not found' }
  send('setup-output', `[${name}] type: ${entry.type}\n`)
  if (entry?.path && entry.type !== 'none') {
    const envPath = path.isAbsolute(entry.path) ? entry.path : path.join(getRepoDir(), entry.path)
    send('setup-output', `[${name}] path: ${envPath}\n`)
    if (!ensureInsideRepo(envPath)) {
      send('setup-output', `[${name}] SECURITY: env path outside repo — skipped deletion
`)
      return { error: 'Environment path outside repo — deletion blocked' }
    }
    if (fs.existsSync(envPath)) {
      try {
        // Show folder size before deleting
        const sizeCmd = IS_WIN
          ? `powershell -NoProfile -Command "(Get-ChildItem -Recurse '${envPath}' | Measure-Object -Property Length -Sum).Sum"`
          : `du -sb '${envPath}' | cut -f1`
        const sizeOut = await asyncExec(sizeCmd, { encoding: 'utf8', timeout: 10000, windowsHide: true })
        const bytes = parseInt(sizeOut)
        if (!isNaN(bytes) && bytes > 0) {
          const humanSize = bytes >= 1073741824
            ? (bytes / 1073741824).toFixed(1) + ' GB'
            : bytes >= 1048576
              ? (bytes / 1048576).toFixed(1) + ' MB'
              : (bytes / 1024).toFixed(1) + ' KB'
          send('setup-output', `[${name}] size: ${humanSize}\n`)
        }
      } catch {}
      // Show top-level contents so the user sees what's being removed
      try {
        if (IS_WIN) {
          const listing = await asyncExec(`powershell -NoProfile -Command "Get-ChildItem -Path '${envPath}' | Select-Object Mode, Length, Name | Format-Table -HideTableHeader -AutoSize"`, { encoding: 'utf8', timeout: 10000, windowsHide: true })
          if (listing.trim()) {
            const lines = listing.trim().split('\n').filter(l => l.trim())
            if (lines.length > 0) {
              send('setup-output', `[${name}] contents:\n`)
              for (const line of lines) send('setup-output', `  ${line}\n`)
            }
          }
        } else {
          const listing = await asyncExec(`ls -lhA '${envPath}' 2>/dev/null || echo '(empty)'`, { encoding: 'utf8', timeout: 10000 })
          if (listing.trim()) send('setup-output', `[${name}] contents:\n${listing}\n`)
        }
      } catch {}
      // Delete each top-level item with visible progress
      try {
        var items = fs.readdirSync(envPath)
        for (var i = 0; i < items.length; i++) {
          var itemPath = path.join(envPath, items[i])
          var label = items[i]
          if (fs.statSync(itemPath).isDirectory()) label += '/'  // mark dirs
          send('setup-output', `[${name}] removing ${label}\n`)
          if (IS_WIN) {
            if (fs.statSync(itemPath).isDirectory()) {
              await runCmd('rmdir', ['/s', '/q', itemPath])
            } else {
              fs.unlinkSync(itemPath)
            }
          } else {
            await runCmd('rm', ['-rf', itemPath])
          }
        }
        // Remove the now-empty env dir itself
        fs.rmdirSync(envPath)
        send('setup-output', `[${name}] folder removed\n`)
      } catch (delErr) {
        send('setup-output', ` error: ${delErr.message}\n`)
        // Fallback: try bulk delete
        await runCmd(IS_WIN ? 'rmdir' : 'rm', IS_WIN ? ['/s', '/q', envPath] : ['-rf', envPath])
        if (!fs.existsSync(envPath)) send('setup-output', `[${name}] folder removed\n`)
      }
    } else {
      send('setup-output', `[${name}] folder not found on disk, removing from registry\n`)
    }
  }
  delete d.envs[name]
  if (d.active === name) {
    const keys = Object.keys(d.envs)
    d.active = keys.length > 0 ? keys[0] : null
    if (d.active) send('setup-output', `[*] Switched active env to '${d.active}'\n`)
    else send('setup-output', `[*] No environments remaining\n`)
  }
  fs.writeFileSync(getEnvsFile(), JSON.stringify(d, null, 4))
  send('setup-output', `[${name}] uninstalled\n`)
  return { success: true }
})

ipcMain.handle('open-external', (_, url) => {
  if (typeof url !== 'string') return
  let parsed
  try { parsed = new URL(url) } catch { return }
  // Only allow http/https URLs to avoid protocol-handler abuse
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return
  shell.openExternal(url)
})

ipcMain.handle('open-task-manager', () => {
  if (PLATFORM !== 'win32') return { error: 'Task Manager is Windows-only' }
  try { exec('taskmgr.exe') } catch { }
})

// Toggle Chromium DevTools. Prefers the embedded Wan2GP BrowserView when present,
// otherwise the main window's webview. Hidden menu means this is the only devtools entry.
ipcMain.handle('toggle-devtools', () => {
  try {
    if (_bv && mainWin.getBrowserViews().includes(_bv)) _bv.webContents.toggleDevTools()
    else if (mainWin) mainWin.webContents.toggleDevTools()
    return { success: true }
  } catch (e) { return { error: e.message } }
})

// ── Browser detection + no-GPU launch ──
const WELL_KNOWN_BROWSERS = [
  { id: 'chrome',    name: 'Google Chrome',  win: ['%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe', '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe', '%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe'], mac: '/Applications/Google Chrome.app', linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'] },
  { id: 'edge',      name: 'Microsoft Edge', win: ['%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe', '%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe'], mac: '/Applications/Microsoft Edge.app', linux: ['microsoft-edge'] },
  { id: 'firefox',   name: 'Firefox',        win: ['%ProgramFiles%\\Mozilla Firefox\\firefox.exe', '%ProgramFiles(x86)%\\Mozilla Firefox\\firefox.exe'], mac: '/Applications/Firefox.app', linux: ['firefox'] },
  { id: 'brave',     name: 'Brave',          win: ['%LocalAppData%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'], mac: '/Applications/Brave Browser.app', linux: ['brave-browser', 'brave'] },
  { id: 'opera',     name: 'Opera',          win: ['%LocalAppData%\\Programs\\Opera\\launcher.exe', '%ProgramFiles%\\Opera\\launcher.exe'], mac: '/Applications/Opera.app', linux: ['opera'] },
  { id: 'vivaldi',   name: 'Vivaldi',        win: ['%LocalAppData%\\Vivaldi\\Application\\vivaldi.exe'], mac: '/Applications/Vivaldi.app', linux: ['vivaldi'] },
]

function expandEnv(p) { return p.replace(/%([^%]+)%/g, (_, k) => process.env[k] || '') }

// Validate a renderer-supplied URL before it is opened / handed to a shell.
// Mirrors open-external's http(s)-only policy; the raw string must also not
// contain metacharacters that survive cmd/sh double-quoting (" $ `). The
// re-serialized URL has " and spaces percent-encoded, so the value that is
// interpolated into the launch command cannot break out of its quotes.
function safeHttpUrl(url) {
  if (typeof url !== 'string' || /["$`]/.test(url)) return null
  let parsed
  try { parsed = new URL(url) } catch { return null }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return parsed.toString()
}

ipcMain.handle('detect-browsers', () => {
  const found = []
  for (const b of WELL_KNOWN_BROWSERS) {
    let path = null
    if (IS_WIN) {
      for (const cand of b.win) {
        const ep = expandEnv(cand)
        try { if (fs.existsSync(ep)) { path = ep; break } } catch {}
      }
    } else if (PLATFORM === 'darwin') {
      try { if (fs.existsSync(b.mac)) path = b.mac } catch {}
    } else {
      for (const cand of b.linux) {
        try { const p = execSync(`command -v ${cand}`, { encoding: 'utf8', windowsHide: true }).trim(); if (p) { path = p; break } } catch {}
      }
    }
    found.push({ id: b.id, name: b.name, installed: !!path, path })
  }
  return { browsers: found, defaultBrowser: (loadConfig().defaultBrowser || 'system') }
})

// Launch URL via the user's chosen default browser (no extra GPU flags).
ipcMain.handle('launch-browser', (_, url) => {
  const safeUrl = safeHttpUrl(url)
  if (!safeUrl) return { error: 'invalid url' }
  const chosen = loadConfig().defaultBrowser || 'system'
  if (chosen !== 'system') {
    const b = WELL_KNOWN_BROWSERS.find(x => x.id === chosen)
    let exe = null
    if (IS_WIN) {
      for (const cand of b.win) { const ep = expandEnv(cand); try { if (fs.existsSync(ep)) { exe = ep; break } } catch {} }
    } else if (PLATFORM === 'darwin') {
      if (fs.existsSync(b.mac)) exe = b.mac
    } else {
      for (const cand of b.linux) { try { const p = execSync(`command -v ${cand}`, { encoding: 'utf8', windowsHide: true }).trim(); if (p) { exe = p; break } } catch {} }
    }
    if (exe) {
      try {
        if (IS_WIN) exec(`start "" "${exe}" "${safeUrl}"`, { windowsHide: false })
        else if (PLATFORM === 'darwin') exec(`open -a "${exe}" "${safeUrl}"`, { windowsHide: true })
        else exec(`"${exe}" "${safeUrl}"`, { windowsHide: true })
        return { success: true }
      } catch (e) { return { error: e.message } }
    }
  }
  // No specific browser (or not found) → let the OS decide.
  shell.openExternal(safeUrl)
  return { success: true }
})

// "Launch in Browser (no GPU)": always open CHROME with minimal-GPU flags so the
// browser uses almost no VRAM, leaving it free for Wan2GP generation. We deliberately
// ignore the user's defaultBrowser here — a no-GPU launch must be Chrome (the only
// browser the flag set is validated against) and must not spawn Edge/Firefox.
// Preference: Wan2GP repo's own script (canonical, see \Wan2GP\scripts) -> vendored
// script -> inline Chrome launch with the flags.
function findChrome() {
  if (IS_WIN) {
    for (const cand of [
      '%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe',
      '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe',
      '%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe',
    ]) {
      const ep = expandEnv(cand)
      try { if (fs.existsSync(ep)) return ep } catch {}
    }
  } else if (PLATFORM === 'darwin') {
    if (fs.existsSync('/Applications/Google Chrome.app')) return '/Applications/Google Chrome.app'
  } else {
    for (const cand of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      try { const p = execSync(`command -v ${cand}`, { encoding: 'utf8', windowsHide: true }).trim(); if (p) return p } catch {}
    }
  }
  return null
}

ipcMain.handle('launch-browser-no-gpu', (_, url) => {
  const safeUrl = safeHttpUrl(url)
  if (!safeUrl) return { error: 'invalid url' }
  const noGpuArgs = ['--disable-gpu', '--disable-gpu-compositing', '--disable-accelerated-2d-canvas', '--disable-accelerated-video-decode', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-webgpu']

  const spawnDetached = (cmd, args) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
  }

  // 1) Wan2GP repo's canonical script (per user: \Wan2GP\scripts\start-chrome-no-gpu.*)
  const repoScript = path.join(getRepoDir(), 'scripts', 'start-chrome-no-gpu' + (IS_WIN ? '.bat' : '.sh'))
  if (fs.existsSync(repoScript)) {
    try {
      if (IS_WIN) spawnDetached('cmd.exe', ['/c', repoScript, safeUrl])
      else { fs.chmodSync(repoScript, 0o755); spawnDetached(repoScript, [safeUrl]) }
      return { success: true }
    } catch (e) { /* fall through */ }
  }

  // 2) Vendored script bundled with the desktop app
  const vendored = path.join(__dirname, 'scripts', 'start-chrome-no-gpu' + (IS_WIN ? '.bat' : '.sh'))
  if (fs.existsSync(vendored)) {
    try {
      if (IS_WIN) spawnDetached('cmd.exe', ['/c', vendored, safeUrl])
      else { fs.chmodSync(vendored, 0o755); spawnDetached(vendored, [safeUrl]) }
      return { success: true }
    } catch (e) { /* fall through */ }
  }

  // 3) Direct Chrome launch with the flags (no script available)
  const chrome = findChrome()
  if (chrome) {
    try {
      if (IS_WIN) spawnDetached(chrome, [...noGpuArgs, safeUrl])
      else if (PLATFORM === 'darwin') spawnDetached('open', ['-a', chrome, '--args', ...noGpuArgs, safeUrl])
      else spawnDetached(chrome, [...noGpuArgs, safeUrl])
      return { success: true }
    } catch (e) { return { error: e.message } }
  }

  return { error: 'Chrome not found — install Google Chrome or run \\Wan2GP\\scripts\\start-chrome-no-gpu.bat' }
})

// Whether Chrome is installed (used to enable/disable the "Launch in Browser (no GPU)" button).
ipcMain.handle('chrome-available', () => !!findChrome())

// ── Desktop config ──
ipcMain.handle('check-command', (_, cmd) => {
  if (!cmd) return false
  // Also check common install paths for tools that don't add to PATH
  if (IS_WIN) {
    const user = process.env.USERPROFILE || ''
    const appdata = process.env.APPDATA || ''
    if (cmd === 'conda') {
      const commonPaths = [
        path.join(user, 'Miniconda3', 'condabin', 'conda.bat'),
        path.join(user, 'Anaconda3', 'condabin', 'conda.bat'),
        path.join(user, 'Miniconda3', 'Scripts', 'conda.exe'),
        path.join(user, 'Anaconda3', 'Scripts', 'conda.exe'),
      ]
      for (const p of commonPaths) {
        if (fs.existsSync(p)) return true
      }
    }
    if (cmd === 'uv') {
      const commonPaths = [
        path.join(user, '.local', 'bin', 'uv.exe'),
        path.join(appdata, 'uv', 'bin', 'uv.exe'),
        path.join(user, '.cargo', 'bin', 'uv.exe'),
      ]
      for (const p of commonPaths) {
        if (fs.existsSync(p)) return true
      }
    }
  } else {
    const home = process.env.HOME || ''
    if (cmd === 'conda') {
      const commonPaths = [
        path.join(home, 'miniconda3', 'bin', 'conda'),
        path.join(home, 'anaconda3', 'bin', 'conda'),
        path.join(home, 'Miniconda3', 'bin', 'conda'),
      ]
      for (const p of commonPaths) {
        if (fs.existsSync(p)) return true
      }
    }
    if (cmd === 'uv') {
      const commonPaths = [
        path.join(home, '.local', 'bin', 'uv'),
        path.join(home, '.cargo', 'bin', 'uv'),
      ]
      for (const p of commonPaths) {
        if (fs.existsSync(p)) return true
      }
    }
  }
  try {
    const out = execSync(IS_WIN ? `where ${cmd}` : `which ${cmd}`, { encoding: 'utf8', timeout: 5000, windowsHide: true })
    return out.trim().length > 0
  } catch { return false }
})

ipcMain.handle('config-load', () => loadConfig())
ipcMain.handle('config-save', (_, cfg) => {
  saveConfig(cfg)
  // Re-apply the update policy immediately so toggling auto-updates in
  // settings takes effect without an app restart.
  if (typeof applyAutoUpdatePolicy === 'function') applyAutoUpdatePolicy()
  return true
})

// ── Install paths ──
ipcMain.handle('get-install-paths', () => ({
  appData: getDataDir(),
  repo: getRepoDir(),
  config: getConfigFile()
}))
ipcMain.handle('get-data-dir', () => getDataDir())
ipcMain.handle('set-data-dir', (_, dir) => {
  fs.writeFileSync(DATA_DIR_OVERRIDE, dir)
  try {
    const ed = path.join(dir, '.electron')
    fs.mkdirSync(ed, { recursive: true })
    app.setPath('userData', ed)
  } catch {}
  return true
})
ipcMain.handle('open-folder', (_, dir) => {
  try { shell.openPath(dir) } catch {}
})
ipcMain.handle('reset-data-dir', () => {
  try {
    if (fs.existsSync(DATA_DIR_OVERRIDE)) fs.rmSync(DATA_DIR_OVERRIDE, { force: true })
    // Compute the default from the ORIGINAL userData (pre-redirect) — using
    // app.getPath('userData') here nested the app under <dataDir>/.electron.
    const d = path.join(ORIGINAL_USER_DATA, 'Wan2GP')
    fs.mkdirSync(d, { recursive: true })
    app.setPath('userData', path.join(d, '.electron'))
  } catch {}
  return true
})

// ── Install a prerequisite tool (Git, Python, uv, Miniconda) ──
ipcMain.handle('install-prerequisite', async (_, tool) => {
  const tmpDir = require('os').tmpdir()
  const sendLog = (msg) => send('launch-log', msg + '\n')

  // Run a command and stream its output into the log panel (live progress).
  // Without this, "Installing uv..." sits silent for minutes and users can't
  // tell if anything is happening.
  const runLive = (cmd, opts = {}) => new Promise((resolve, reject) => {
    const child = spawn(cmd, { shell: true, windowsHide: true, ...opts })
    let buf = ''
    const fwd = (chunk) => {
      buf += chunk.toString()
      const parts = buf.split(/\r?\n/)
      buf = parts.pop()
      for (const p of parts) { const line = p.replace(/\r/g, '').trim(); if (line) sendLog('    ' + line) }
    }
    child.stdout.on('data', fwd)
    child.stderr.on('data', fwd)
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Command exited with code ${code}: ${cmd}`)))
    if (opts.timeout) {
      setTimeout(() => { try { child.kill() } catch {}; reject(new Error(`Command timed out after ${Math.round(opts.timeout / 1000)}s: ${cmd}`)) }, opts.timeout).unref()
    }
  })

  try {
    if (tool === 'git') {
      if (!IS_WIN) {
        // POSIX: git usually ships with the OS or a dev toolchain; never auto-sudo.
        try { execSync('command -v git', { encoding: 'utf8', timeout: 5000 }); sendLog('[*] git is already installed.'); return { success: true } } catch {}
        sendLog('[!] git is not installed. Install it with your package manager, e.g.:')
        sendLog('      Ubuntu/Debian:  sudo apt install git')
        sendLog('      Fedora:          sudo dnf install git')
        sendLog('      Arch:            sudo pacman -S git')
        sendLog('      macOS:           brew install git')
        return { error: 'git not installed — install it via your package manager (see log output)' }
      }
      sendLog('[*] Downloading Git for Windows (~120 MB)...')
      // NOTE: Update Git version periodically — check https://git-scm.com/download/win
      const url = 'https://github.com/git-for-windows/git/releases/download/v2.49.0.windows.1/Git-2.49.0-64-bit.exe'
      const dest = path.join(tmpDir, 'Git-2.49.0-64-bit.exe')
      await downloadFile(url, dest)
      sendLog('[*] Downloaded. Installing silently — this can take a couple of minutes...')
      await asyncExec(`"${dest}" /VERYSILENT /NORESTART /SUPPRESSMSGBOXES /CLOSEAPPLICATIONS`, { timeout: 120000, windowsHide: true })
      sendLog('[*] Git installed. Please restart the launcher to pick up the new PATH.')
      return { success: true }

    } else if (tool === 'python') {
      if (!IS_WIN) {
        // POSIX: prefer uv-managed Python 3.11 (the install flow already auto-fetches it).
        try { execSync('command -v python3', { encoding: 'utf8', timeout: 5000 }); sendLog('[*] python3 is already installed. The launcher uses a uv-managed Python 3.11 for installs.'); return { success: true } } catch {}
        sendLog('[!] python3 is not installed. Install it with your package manager, e.g.:')
        sendLog('      Ubuntu/Debian:  sudo apt install python3 python3-venv')
        sendLog('      Fedora:          sudo dnf install python3')
        sendLog('      Arch:            sudo pacman -S python')
        sendLog('      macOS:           brew install python@3.11')
        return { error: 'python3 not installed — install it via your package manager (see log output)' }
      }
      sendLog('[*] Downloading Python 3.11 (~25 MB)...')
      // NOTE: Update Python version when 3.11.x goes EOL. Check python.org for latest 3.11.x.
      const url = 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe'
      const dest = path.join(tmpDir, 'python-3.11.9-amd64.exe')
      await downloadFile(url, dest)
      sendLog('[*] Downloaded. Installing silently — this can take a couple of minutes...')
      await asyncExec(`"${dest}" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0`, { timeout: 180000, windowsHide: true })
      sendLog('[*] Python 3.11 installed. Please restart the launcher to pick up the new PATH.')
      return { success: true }

    } else if (tool === 'uv') {
      if (!IS_WIN) {
        sendLog('[*] Installing uv via the official install script...')
        sendLog('[*]   This downloads ~30 MB and can take a minute or two.')
        await runLive('curl -LsSf https://astral.sh/uv/install.sh | sh', { timeout: 120000 })
        // Verify the install actually landed (PATH isn't updated in this process yet).
        const userHome = process.env.HOME || ''
        const candidates = [path.join(userHome, '.local', 'bin', 'uv'), path.join(userHome, '.cargo', 'bin', 'uv')]
        const uvExe = candidates.find((c) => fs.existsSync(c))
        if (!uvExe) {
          sendLog('[!] uv install finished but uv was not found in the usual locations.')
          sendLog('[!] Install it manually in a terminal:  curl -LsSf https://astral.sh/uv/install.sh | sh')
          return { error: 'uv install did not produce uv (see output above)' }
        }
        let ver = '?'
        try { ver = execSync(`"${uvExe}" --version`, { encoding: 'utf8' }).trim() } catch {}
        sendLog(`[✓] ${ver} installed at ${uvExe}`)
        sendLog('[*] Please restart the launcher to pick up the new PATH.')
        return { success: true }
      }
      sendLog('[*] Installing uv via PowerShell...')
      sendLog('[*]   This downloads ~30 MB and can take a minute or two.')
      await runLive('powershell -NoProfile -Command "& { iwr -useb https://astral.sh/uv/install.ps1 | iex }"', { timeout: 120000 })
      // Verify the install actually landed (PATH isn't updated in this process yet).
      const userHome = process.env.USERPROFILE || process.env.HOME || ''
      const candidates = [path.join(userHome, '.local', 'bin', 'uv.exe'), path.join(userHome, '.cargo', 'bin', 'uv.exe')]
      const uvExe = candidates.find((c) => fs.existsSync(c))
      if (!uvExe) {
        sendLog('[!] uv install finished but uv.exe was not found in the usual locations.')
        sendLog('[!] Install it manually in a terminal:  irm https://astral.sh/uv/install.ps1 | iex')
        return { error: 'uv install did not produce uv.exe (see output above)' }
      }
      let ver = '?'
      try { ver = execSync(`"${uvExe}" --version`, { encoding: 'utf8', windowsHide: true }).trim() } catch {}
      sendLog(`[✓] ${ver} installed at ${uvExe}`)
      sendLog('[*] Please restart the launcher to pick up the new PATH.')
      return { success: true }

    } else if (tool === 'conda') {
      if (!IS_WIN) {
        // POSIX: Miniconda ships as a self-extracting .sh installer (batch mode: -b -p).
        const isMac = PLATFORM === 'darwin'
        const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
        const url = isMac
          ? `https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-${arch}.sh`
          : 'https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh'
        const dest = path.join(tmpDir, 'Miniconda3-installer.sh')
        sendLog('[*] Downloading Miniconda (~90 MB)...')
        await downloadFile(url, dest)
        sendLog('[*] Downloaded. Installing silently — this can take a few minutes...')
        const prefix = path.join(process.env.HOME || '', 'miniconda3')
        await runLive(`bash "${dest}" -b -p "${prefix}"`, { timeout: 240000 })
        sendLog(`[✓] Miniconda installed at ${prefix}`)
        sendLog('[*] Please restart the launcher to pick up the new PATH.')
        return { success: true }
      }
      sendLog('[*] Downloading Miniconda (~90 MB)...')
      const url = 'https://repo.anaconda.com/miniconda/Miniconda3-latest-Windows-x86_64.exe'
      const dest = path.join(tmpDir, 'Miniconda3-latest-Windows-x86_64.exe')
      await downloadFile(url, dest)
      sendLog('[*] Downloaded. Installing silently — this can take a few minutes...')
      await asyncExec(`"${dest}" /InstallationType=JustMe /RegisterPython=0 /S /D=%USERPROFILE%\\Miniconda3`, { timeout: 180000, windowsHide: true })
      sendLog('[*] Miniconda installed. Please restart the launcher to pick up the new PATH.')
      return { success: true }
    }
    return { error: 'Unknown tool: ' + tool }
  } catch (e) {
    // Never reject: a rejection makes the renderer's await throw and the UI
    // silently freezes on "Installing..." with no feedback. Surface it instead.
    sendLog(`[!] ${tool} install failed: ${e.message}`)
    sendLog('[!] Check your network connection, and your antivirus — MalwareBytes and others can block installers/downloads. Then retry.')
    return { error: e.message }
  }
})

// ── Hardware-tuned default settings for wgp_config.json ──
// Single source of truth: delegates profile/vae/coefficient/audio decisions to
// services/auto-tune.js (same engine as the Settings → Auto-Tune tab), so the
// install-time defaults and the in-app tuner can never disagree (fixes the old
// P4-install → P5-downgrade on 12GB/32GB machines). Attention/compile stay
// generation-based here (sage2 is sm90+; Ampere and older get sage).
function getHardwareDefaults() {
  const out = { attention: 'auto', compile: '', profile: 5, hierarchy: 1, audio_profile: 5, vram_safety_coefficient: 0.8, vae_config: 0 }
  try {
    const gpu = getGpuInfo()
    const gpuName = gpu.name || ''
    const vramMB = gpu.vramMB || 0

    // Detect total RAM
    let ramGB = 0
    try {
      if (IS_WIN) {
        const r = execSync('powershell -Command "Get-CimInstance Win32_ComputerSystem | ForEach-Object { [math]::Round($_.TotalPhysicalMemory / 1GB) }"', { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim()
        ramGB = parseInt(r) || 0
      } else if (PLATFORM === 'darwin') {
        const r = execSync('sysctl -n hw.memsize', { encoding: 'utf8', timeout: 5000 }).trim()
        ramGB = Math.round(Number(r) / (1024**3))
      } else {
        const r = execSync('free -b | grep Mem', { encoding: 'utf8', timeout: 5000, shell: true }).trim()
        ramGB = Math.round(parseInt(r.split(/\s+/)[1]) / (1024**3))
      }
    } catch {}
    if (ramGB <= 0) ramGB = 16; // fallback

    const upper = gpuName.toUpperCase()

    // Attention mode by GPU generation
    if (upper.includes('RTX') || upper.includes('QUADRO')) {
      if (/50\s*\d0|RTX 50|5090|5080|5070|5060/.test(upper)) {
        out.attention = 'sage2'
        out.compile = 'transformer'
      }
      else if (/40\s*\d0|RTX 40|4090|4080|4070|4060/.test(upper)) {
        out.attention = 'sage2'
        out.compile = 'transformer'
      }
      else if (/30\s*\d0|RTX 30|3090|3080|3070|3060/.test(upper)) {
        // sage2 is sm90+ only — Ampere must use sage v1 (shared/attention.py)
        out.attention = 'sage'
      }
      else if (/20\s*\d0|RTX 20|2080|2070|2060/.test(upper)) {
        out.attention = 'sage'
      }
      else {
        out.attention = 'auto'
      }
    } else {
      out.attention = 'auto'
    }

    // Profiles / VAE / coefficient: same engine as the Auto-Tune tab.
    const rec = autoTune.recommend({
      cuda_available: gpu.vendor === 'NVIDIA',
      vram_tier: vramMB >= 24 * 1024 ? 'high' : (vramMB >= 12 * 1024 ? 'low' : 'tight'),
      ram_tier: ramGB >= 64 ? 'high' : (ramGB >= 32 ? 'low' : 'very_low'),
      gpu_vram_gb: vramMB / 1024
    })
    out.profile = rec.video_profile
    out.audio_profile = rec.audio_profile
    out.vram_safety_coefficient = rec.vram_safety_coefficient
    out.vae_config = rec.vae_config

    // Hierarchy: 2 (expert) if >16GB VRAM, else 1 (standard)
    out.hierarchy = vramMB > 16 * 1024 ? 2 : 1
  } catch {}
  return out
}

ipcMain.handle('write-wgp-config', async (_, { checkpointsPaths, lorasRoot, savePath }) => {
  const hw = getHardwareDefaults()
  const configPath = path.join(getRepoDir(), 'wgp_config.json')
  const existed = fs.existsSync(configPath)
  let cfg = {}
  try {
    if (fs.existsSync(configPath)) {
      cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    }
  } catch {}
  if (checkpointsPaths) cfg.checkpoints_paths = checkpointsPaths
  if (lorasRoot) cfg.loras_root = lorasRoot
  if (savePath) {
    cfg.save_path = savePath
    cfg.image_save_path = savePath
    cfg.audio_save_path = savePath
  }
  // Hardware-tuned defaults — only fill missing
  // Attention defaults to AUTO (gradio UI can override)
  if (cfg.attention_mode === undefined) cfg.attention_mode = 'auto'
  // Profile 1-5 from the shared auto-tune engine (video/image/audio decoupled:
  // audio must follow Wan2GP's fast-decoder gate — int(profile) in (1, 3), wgp.py)
  if (cfg.video_profile === undefined) cfg.video_profile = hw.profile
  if (cfg.image_profile === undefined) cfg.image_profile = hw.profile
  if (cfg.audio_profile === undefined) cfg.audio_profile = hw.audio_profile
  // Compile mode: 'transformer' for RTX 40+ with sage2 attn, else ''
  if (cfg.compile === undefined) cfg.compile = hw.compile
  if (cfg.transformer_quantization === undefined) cfg.transformer_quantization = 'int8'
  if (cfg.text_encoder_quantization === undefined) cfg.text_encoder_quantization = 'int8'
  if (cfg.metadata_type === undefined) cfg.metadata_type = 'metadata'
  if (cfg.boost === undefined) cfg.boost = 1
  if (cfg.enable_int8_kernels === undefined) cfg.enable_int8_kernels = 1
  if (cfg.clear_file_list === undefined) cfg.clear_file_list = 10
  if (cfg.keep_intermediate_sliding_windows === undefined) cfg.keep_intermediate_sliding_windows = 1
  if (cfg.keep_resolution_on_model_switch === undefined) cfg.keep_resolution_on_model_switch = true
  if (cfg.enable_4k_resolutions === undefined) cfg.enable_4k_resolutions = 0
  if (cfg.max_reserved_loras === undefined) cfg.max_reserved_loras = -1
  if (cfg.vae_config === undefined) cfg.vae_config = hw.vae_config
  // Auto-tuned VRAM safety coefficient — written to config AND forwarded as a CLI
  // arg at launch (pushAutoTunedCoefficient), which is the only way wgp.py reads it.
  if (cfg.vram_safety_coefficient === undefined) cfg.vram_safety_coefficient = hw.vram_safety_coefficient
  if (cfg.preload_model_policy === undefined) cfg.preload_model_policy = []
  if (cfg.UI_theme === undefined) cfg.UI_theme = 'default'
  if (cfg.save_queue_if_crash === undefined) cfg.save_queue_if_crash = 1
  if (cfg.queue_color_scheme === undefined) cfg.queue_color_scheme = 'pastel'
  if (cfg.process_queues_when_browser_unfocused === undefined) cfg.process_queues_when_browser_unfocused = 1
  if (cfg.model_hierarchy_type === undefined) cfg.model_hierarchy_type = hw.hierarchy
  if (cfg.prompt_enhancer_quantization === undefined) cfg.prompt_enhancer_quantization = 'quanto_int8'
  // On-Demand Button mode (matches Wan2GP's own default; wgp.py otherwise treats a
  // missing enhancer_mode as Automatic, hiding the "Enhance Prompt" button).
  if (cfg.enhancer_mode === undefined) cfg.enhancer_mode = 1
  if (cfg.prompt_enhancer_temperature === undefined) cfg.prompt_enhancer_temperature = 0.6
  if (cfg.prompt_enhancer_top_p === undefined) cfg.prompt_enhancer_top_p = 0.9
  if (cfg.prompt_enhancer_randomize_seed === undefined) cfg.prompt_enhancer_randomize_seed = true
  // Enable real-time RAM/VRAM stats display in Wan2GP UI
  if (cfg.display_stats === undefined || cfg.display_stats === 0) cfg.display_stats = 1
  // Default outputs to desktop data dir only when the user picked no custom folder
  if (!cfg.save_path) {
    cfg.save_path = path.join(getDataDir(), 'outputs')
    cfg.image_save_path = cfg.save_path
    cfg.audio_save_path = cfg.save_path
  }
  // Ensure all tensors default to cuda:0
  if (cfg.device === undefined) cfg.device = 'cuda:0'
  // Multi-GPU picker overrides the device key (write-wgp-config runs at install;
  // the launch path also injects --gpu cuda:N so this stays consistent)
  try {
    const lc = loadConfig()
    const gpuDevice = (lc.gpuDevice || 'auto').trim()
    if (gpuDevice !== 'auto' && /^cuda:\d+$/.test(gpuDevice)) cfg.device = gpuDevice
  } catch {}
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 4))
  // First-boot auto-tune (one-shot): a brand-new install gets one full
  // detect → recommend → apply pass so users who never open Settings still run
  // tuned. Existing configs are never touched here — manual tuning wins.
  if (!existed) {
    try {
      const tuner = await autoTune.fullTune(getRepoDir(), getDataDir())
      const label = tuner && tuner.recommendation && tuner.recommendation._recommendation_label
      console.log(`[auto-tune] first-boot applied${label ? ` (${label})` : ''}`)
    } catch (e) {
      console.error('[auto-tune] first-boot tune failed:', e.message)
    }
  }
  return true
})

ipcMain.handle('select-folder', async () => {
  const { dialog } = require('electron')
  const result = await dialog.showOpenDialog(mainWin, { properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

// ── Auto-detect model folders ──
ipcMain.handle('get-model-paths', () => {
  const configPath = path.join(getRepoDir(), 'wgp_config.json')
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    const paths = {}
    if (cfg.checkpoints_paths && Array.isArray(cfg.checkpoints_paths)) paths.checkpoints = cfg.checkpoints_paths[0]
    if (cfg.loras_root) paths.loras = cfg.loras_root
    if (cfg.save_path) paths.output = cfg.save_path
    return Object.keys(paths).length ? paths : null
  } catch { return null }
})

ipcMain.handle('detect-model-folders', () => {
  const repo = getRepoDir()
  const ckptsDir = path.join(repo, 'ckpts')
  const lorasDir = path.join(repo, 'loras')
  const suggestions = {
    checkpointsPaths: [ckptsDir, repo],
    lorasRoot: fs.existsSync(lorasDir) ? lorasDir : ''
  }
  // If existing config has saved paths, use those instead
  const configPath = path.join(repo, 'wgp_config.json')
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      if (cfg.checkpoints_paths && Array.isArray(cfg.checkpoints_paths)) suggestions.checkpointsPaths = cfg.checkpoints_paths
      if (cfg.loras_root) suggestions.lorasRoot = cfg.loras_root
    }
  } catch {}
  return suggestions
})

// ── Repair settings (issue #7: "Value: 2 is not in the list of choices: [0, 1]") ──
// Scans models/_settings.json + every *_settings.json in the install dir and clamps
// dropdown values that fall outside the choices Wan2GP accepts. A stale value (e.g. 2
// from an older version or imported settings) makes Gradio reject the ENTIRE form on
// save — this is the launcher-side fix for the core-side dropdown bug (upstream PR
// #2088 was withdrawn). Each file is backed up as <name>.bak-repair before editing.
// Pure logic lives in services/settings-repair.js (shared with the test suite).
const { DROPDOWN_CLAMPS, clampSettingsFile, collectSettingsFiles, repairNestedModelPaths } = require('./services/settings-repair')

ipcMain.handle('repair-settings', async () => {
  const repo = getRepoDir()
  if (!repo || !fs.existsSync(path.join(repo, 'wgp.py'))) {
    return { success: false, error: 'Wan2GP is not installed — nothing to repair.' }
  }
  const files = collectSettingsFiles(repo)
  const results = []
  let totalFixed = 0
  for (const f of files) {
    const r = clampSettingsFile(f)
    if (r.file) r.file = path.relative(repo, r.file)
    if (r.backup) r.backup = path.relative(repo, r.backup)
    if (r.fixed) totalFixed += r.fixed
    results.push(r)
  }
  const problems = results.filter(r => r.error)
  // Model-path sanity check (issue #18): nested <repo>\Wan2GP\... entries in
  // wgp_config.json get redirected to the launcher's data-dir model home.
  const modelPaths = repairNestedModelPaths(repo, getDataDir())
  return {
    success: true,
    scanned: files.length,
    fixed: totalFixed,
    results,
    problems: problems.length ? problems : null,
    modelPaths
  }
})


// ── Create Desktop Shortcut for Wan2GP (standalone launch without desktop app) ──
// Windows: creates a .bat on the desktop. Linux: .desktop entry + launch script.
// macOS: .command file (double-click opens Terminal).
ipcMain.handle('create-desktop-shortcut', () => {
  try {
    const env = getActiveEnv()
    if (!env) return { error: 'No active environment' }
    const py = getPythonForEnv(env)
    if (!py) return { error: 'Cannot find Python for active env' }
    const repo = getRepoDir()
    if (!repo || !fs.existsSync(path.join(repo, 'wgp.py'))) return { error: 'Wan2GP repo not found' }
    const desktop = app.getPath('desktop')
    if (!desktop) return { error: 'Cannot find desktop path' }

    const cfg = loadConfig()
    const port = cfg.serverPort || 7860
    const extraArgs = (cfg.launchArgs || '').trim()

    if (!IS_WIN) {
      // ── POSIX: self-contained launch script + platform launcher ──
      const shq = (s) => "'" + String(s).replace(/'/g, `'\\''`) + "'"
      // Build activation command based on env type
      let activate = ''
      const envPath = path.isAbsolute(env.path) ? env.path : path.join(getRepoDir(), env.path)
      if (env.type === 'venv' || env.type === 'uv') {
        const activateScript = path.join(envPath, 'bin', 'activate')
        if (fs.existsSync(activateScript)) activate = 'source "' + activateScript + '"'
      } else if (env.type === 'conda') {
        const activateScript = path.join(envPath, 'bin', 'activate')
        if (fs.existsSync(activateScript)) activate = 'source "' + activateScript + '"'
      }
      const hasServerName = extraArgs.split(/\s+/).filter(Boolean).some(a => a === '--server-name')
      const serverNameArg = hasServerName ? '' : ' --server-name 127.0.0.1'
      const hasShare = extraArgs.split(/\s+/).filter(Boolean).some(a => a === '--share')
      const shareArg = (!hasShare && cfg.share) ? ' --share' : ''
      // First Block Cache / advanced UI (upstream parity) — see launch handler.
      const hasAdvanced = extraArgs.split(/\s+/).filter(Boolean).some(a => a === '--advanced')
      const advancedArg = hasAdvanced ? '' : ' --advanced'
      const hasMultiImg = extraArgs.split(/\s+/).filter(Boolean).some(a => a === '--multiple-images')
      const multiImgArg = hasMultiImg ? '' : ' --multiple-images'
      const escapedExtra = extraArgs ? ' ' + extraArgs.split(/\s+/).filter(Boolean).map(shq).join(' ') : ''
      const shContent = [
        '#!/usr/bin/env bash',
        'export PYTHONIOENCODING=utf-8',
        'export PYTHONUTF8=1',
        'cd ' + shq(repo),
        'echo "[Wan2GP Desktop Launcher]"',
        'echo "Starting Wan2GP on port ' + port + '..."',
        'echo ""',
        ...(activate ? ['echo "Activating environment: ' + env.name + ' (' + env.type + ')"', activate, 'echo ""'] : []),
        'exec ' + shq(py) + ' -u ' + shq(bootstrapScriptPath()) + ' wgp.py --server-port ' + port + serverNameArg + shareArg + advancedArg + multiImgArg + escapedExtra
      ].join('\n') + '\n'

      if (PLATFORM === 'linux') {
        // Launch script lives in the data dir (stable path, survives temp cleaners).
        const shPath = path.join(getDataDir(), 'Launch-Wan2GP.sh')
        fs.writeFileSync(shPath, shContent, 'utf8')
        fs.chmodSync(shPath, 0o755)
        // .desktop entry — Exec field quoting per freedesktop spec: wrap in double quotes,
        // escape \, ", $, ` (a lone space inside a path also requires quoting).
        const escDesktop = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`') + '"'
        const desktopContent = [
          '[Desktop Entry]',
          'Type=Application',
          'Name=Wan2GP',
          'Comment=Launch Wan2GP (via Wan2GP Desktop Launcher)',
          'Exec=' + escDesktop(shPath),
          'Terminal=true',
          'Icon=' + escDesktop(path.join(__dirname, 'resources', 'icon-1024.png')),
          'Categories=Development;',
          'StartupNotify=false'
        ].join('\n') + '\n'
        const desktopPath = path.join(desktop, 'Wan2GP.desktop')
        fs.writeFileSync(desktopPath, desktopContent, 'utf8')
        fs.chmodSync(desktopPath, 0o755)
        return { success: true, path: desktopPath }
      } else {
        // macOS: .command is executable and opens in Terminal on double-click.
        const cmdPath = path.join(desktop, 'Launch Wan2GP.command')
        fs.writeFileSync(cmdPath, shContent, 'utf8')
        fs.chmodSync(cmdPath, 0o755)
        return { success: true, path: cmdPath }
      }
    }

    // ── Windows: .bat on the desktop ──
    let activate = ''
    const envPath = path.isAbsolute(env.path) ? env.path : path.join(getRepoDir(), env.path)
    if (env.type === 'venv' || env.type === 'uv') {
      const activateScript = path.join(envPath, 'Scripts', 'activate')
      if (fs.existsSync(activateScript)) {
        activate = 'call "' + activateScript + '"'
      }
    } else if (env.type === 'conda') {
      activate = 'call conda activate "' + envPath + '"'
    }

    let batContent = '@echo off\n'
    batContent += 'title Wan2GP\n'
    batContent += 'cd /d "' + repo + '"\n'
    batContent += 'echo.\n'
    batContent += 'echo [Wan2GP Desktop Launcher]\n'
    batContent += 'echo Starting Wan2GP on port ' + port + '...\n'
    batContent += 'echo.\n'
    if (activate) {
      batContent += 'echo Activating environment: ' + escapeBat(env.name) + ' (' + escapeBat(env.type) + ')\n'
      batContent += activate + '\n'
      if (env.type === 'venv' || env.type === 'uv') {
        batContent += 'set PATH=' + path.join(envPath, 'Scripts') + ';%PATH%\n'
      }
    }
    batContent += 'echo.\n'
    batContent += 'echo Starting wgp.py in background...\n'
    // Run wgp.py in background so we can monitor + open browser when ready
    // Ensure --server-name is set (default 127.0.0.1 to avoid proxy/localhost Gradio issues)
    const hasServerName = extraArgs.split(/\s+/).filter(Boolean).some(a => a === '--server-name')
    const serverNameArg = hasServerName ? '' : ' --server-name 127.0.0.1'
    const hasShare = extraArgs.split(/\s+/).filter(Boolean).some(a => a === '--share')
    const shareArg = (!hasShare && cfg.share) ? ' --share' : ''
    // First Block Cache / advanced UI (upstream parity) — see launch handler.
    const hasAdvanced = extraArgs.split(/\s+/).filter(Boolean).some(a => a === '--advanced')
    const advancedArg = hasAdvanced ? '' : ' --advanced'
    const hasMultiImg = extraArgs.split(/\s+/).filter(Boolean).some(a => a === '--multiple-images')
    const multiImgArg = hasMultiImg ? '' : ' --multiple-images'
    const escapedExtra = extraArgs ? ' ' + extraArgs.split(/\s+/).filter(Boolean).map(escapeBatCmdArg).join(' ') : ''
    batContent += `start /b "" cmd /c "python -u "${bootstrapScriptPath()}" wgp.py --server-port ${port}${serverNameArg}${shareArg}${advancedArg}${multiImgArg}${escapedExtra}" 2>&1\n`
    batContent += 'echo.\n'
    batContent += 'echo Waiting for Wan2GP server on port ' + port + '...\n'
    // Poll via HTTP (wait for real Gradio response, not just TCP socket)
    batContent += 'set RETRY_COUNT=0\n'
    batContent += ':waitloop\n'
    batContent += 'timeout /t 2 /nobreak >nul\n'
    batContent += 'set /a RETRY_COUNT+=1\n'
    batContent += 'if %RETRY_COUNT% gtr 60 (echo Server failed to start within 2 minutes. Check console for errors. & pause & exit /b 1)\n'
    batContent += 'powershell -Command "try{$(Invoke-WebRequest -Uri http://127.0.0.1:' + port + '/config -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200;exit 0}catch{exit 1}" >nul 2>&1 && goto ready\n'
    batContent += 'goto waitloop\n'
    batContent += ':ready\n'
    batContent += 'echo Wan2GP is ready! Opening browser...\n'
    batContent += 'start http://127.0.0.1:' + port + '\n'
    batContent += 'echo.\n'
    batContent += 'echo [Wan2GP] Server is running. Close this window to stop it.\n'
    batContent += 'pause >nul\n'

    const batPath = path.join(desktop, 'Launch Wan2GP.bat')
    fs.writeFileSync(batPath, batContent, 'utf8')
    return { success: true, path: batPath }
  } catch (e) { return { error: e.message } }
})

// ── Disk space ──
ipcMain.handle('get-disk-space', () => {
  try {
    const p = getDataDir()
    if (!p) return null
    const root = path.parse(p).root || p.substring(0, 2)
    if (typeof fs.statfs === 'function') {
      const s = fs.statfsSync(root)
      return { free: s.bsize * s.bfree, total: s.bsize * s.blocks }
    }
    const out = execSync('wmic logicaldisk where caption="' + root.charAt(0) + ':" get freespace,size /format:csv', { timeout: 5000, encoding: 'utf8' })
    const parts = out.trim().split(/\\r?\\n/)
    if (parts.length >= 2) {
      const cols = parts[1].split(',')
      if (cols.length >= 3) {
        return { free: parseInt(cols[1]) || 0, total: parseInt(cols[2]) || 0 }
      }
    }
  } catch {}
  return null
})


// ── Wan2GP upstream version ──
ipcMain.handle('get-wangp-local-version', () => getLocalWangpHead())

// Upstream commit list is cached (5 min TTL) so periodic re-checks while the
// app is open don't hammer the GitHub API (60 req/hr unauthenticated limit).
let _wangpUpstreamCache = { data: null, ts: 0 }
const WANGP_UPSTREAM_TTL = 300000

ipcMain.handle('get-wangp-upstream-info', async () => {
  if (_wangpUpstreamCache.data && Date.now() - _wangpUpstreamCache.ts < WANGP_UPSTREAM_TTL) return _wangpUpstreamCache.data
  try {
    const data = await fetchUrl(`https://api.github.com/repos/${WAN2GP_UPSTREAM}/commits?per_page=10&sha=main`, {
      headers: { 'User-Agent': 'wan2gp-desktop', 'Accept': 'application/vnd.github.v3+json' }
    })
    if (!Array.isArray(data)) return { error: 'Invalid response' }
    const result = {
      commits: data.map(c => ({
        hash: c.sha,
        date: c.commit.author.date,
        message: c.commit.message.split('\n')[0],
        author: c.commit.author.name
      }))
    }
    _wangpUpstreamCache = { data: result, ts: Date.now() }
    return result
  } catch (e) { return { error: e.message } }
})

// ── Desktop app git info ──
ipcMain.handle('get-desktop-git-info', () => {
  if (_gitCache.desktop && Date.now() - _gitCache.ts < GIT_CACHE_TTL) return _gitCache.desktop
  try {
    const cwd = path.resolve(__dirname)
    if (!fs.existsSync(path.join(cwd, '.git'))) return null
    const hash = execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf8', timeout: 5000 }).trim()
    const date = execSync('git log -1 --format=%cI', { cwd, encoding: 'utf8', timeout: 5000 }).trim()
    const msg = execSync('git log -1 --format=%s', { cwd, encoding: 'utf8', timeout: 5000 }).trim()
    const result = { hash, date, message: msg }
    _gitCache = { wangp: _gitCache.wangp, desktop: result, ts: Date.now() }
    return result
  } catch { return null }
})

ipcMain.handle('get-desktop-version', () => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'))
    return pkg.version || null
  } catch { return null }
})

ipcMain.handle('get-wangp-version', async () => {
  try {
    const body = await fetchUrl(`https://raw.githubusercontent.com/${WAN2GP_UPSTREAM}/main/README.md`)
    if (!body) return null
    const m = body.match(/WanGP\s+v?(\d+\.\d+(?:\.\d+)?)/i)
    return m ? m[1] : null
  } catch { return null }
})

// ── Check PyPI for latest package versions ──
const _pypiCache = {}
// Single source of truth for all package names that can be checked/installed/uninstalled.
// The security whitelist for check-package is derived from this list.
const ALL_PACKAGES = [
  'torch', 'triton', 'sageattention', 'spas_sage_attn', 'flash_attn',
  'diffusers', 'transformers', 'gradio', 'accelerate', 'onnxruntime',
  'xformers', 'nunchaku', 'gguf', 'mmgp', 'moviepy', 'opencv-python',
  'insightface', 'peft', 'timm', 'vector_quantize_pytorch', 'torchcodec',
  'torchaudio', 'huggingface_hub', 'lightx2v', 'bitsandbytes', 'hf_xet'
]

// Security guard for pip install/upgrade/uninstall handlers. Without a
// whitelist a name like "--index-url <host>" or "-r <url>" would make pip
// fetch or install arbitrary code — check-package already whitelists, the
// mutating handlers must too.
function assertWhitelistedPackage(pkgName) {
  if (typeof pkgName !== 'string' || !ALL_PACKAGES.includes(pkgName)) {
    throw new Error('Package not in whitelist')
  }
}

ipcMain.handle('check-package-updates', async (_, installedVersions) => {
  const results = []
  if (!installedVersions || typeof installedVersions !== 'object') return results
  const names = Object.keys(installedVersions).filter(n => n !== 'python' && n !== 'error')
  const fetchOne = async (name) => {
    try {
      if (_pypiCache[name] && Date.now() - _pypiCache[name].ts < 300000) {
        return { name, latest: _pypiCache[name].latest, installed: installedVersions[name] }
      }
      const pypiName = ({sageattention:'sageattention',spas_sage_attn:'spas-sage-attn',opencv:'opencv-python',hfhub:'huggingface-hub',huggingface_hub:'huggingface-hub',flash_attn:'flash-attn',onnxruntime:'onnxruntime',nunchaku:'nunchaku',gguf:'gguf',mmgp:'mmgp',moviepy:'moviepy',insightface:'insightface',peft:'peft',timm:'timm',vector_quantize_pytorch:'vector-quantize-pytorch',torchcodec:'torchcodec',torchaudio:'torchaudio',lightx2v:'lightx2v',xformers:'xformers'})[name] || name
      const data = await fetchUrl(`https://pypi.org/pypi/${pypiName}/json`, { timeout: 8000 })
      const latest = (data && data.info && data.info.version) || null
      if (latest) _pypiCache[name] = { latest, ts: Date.now() }
      return { name, installed: installedVersions[name], latest }
    } catch { return { name, installed: installedVersions[name], latest: null } }
  }
  const settled = await Promise.allSettled(names.map(fetchOne))
  for (const s of settled) { if (s.status === 'fulfilled' && s.value) results.push(s.value) }
  return results
})

// ── Upgrade a single package in the active env ──
ipcMain.handle('upgrade-package', async (_, pkgName) => {
  try {
    assertWhitelistedPackage(pkgName)
    const env = getActiveEnv()
    if (!env) return { error: 'No active environment' }
    const py = getPythonForEnv(env)
    if (!py) return { error: 'Cannot find Python' }
    send('launch-log', '[*] Upgrading ' + pkgName + '...\n')
    await new Promise((resolve, reject) => {
      const proc = spawn(py, ['-m', 'pip', 'install', '--upgrade', pkgName], {
        cwd: getRepoDir(), timeout: 120000, windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1', TQDM_MININTERVAL: '0', TQDM_MINITERS: '1' }
      })
      proc.stdout.on('data', (d) => { const s = d.toString(); if (s) send('launch-log', s) })
      proc.stderr.on('data', (d) => { const s = d.toString(); if (s) send('launch-log', s) })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error('pip exited code ' + code))
      })
      proc.on('error', reject)
    })
    send('launch-log', '[*] ' + pkgName + ' upgraded successfully.\n')
    delete _pypiCache[pkgName]
    return { success: true }
  } catch (e) { return { error: e.message } }
})

// ── Install a single package (e.g. triton, flash_attn) into active env ──
ipcMain.handle('install-package', async (_, pkgName) => {
  try {
    assertWhitelistedPackage(pkgName)
    const env = getActiveEnv()
    if (!env) return { error: 'No active environment' }
    const py = getPythonForEnv(env)
    if (!py) return { error: 'Cannot find Python' }
    send('launch-log', '[*] Installing ' + pkgName + '...\n')
    await new Promise((resolve, reject) => {
      const proc = spawn(py, ['-m', 'pip', 'install', pkgName], {
        cwd: getRepoDir(), timeout: 300000, windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1', TQDM_MININTERVAL: '0', TQDM_MINITERS: '1' }
      })
      proc.stdout.on('data', (d) => { const s = d.toString(); if (s) send('launch-log', s) })
      proc.stderr.on('data', (d) => { const s = d.toString(); if (s) send('launch-log', s) })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error('pip exited code ' + code))
      })
      proc.on('error', reject)
    })
    send('launch-log', '[*] ' + pkgName + ' installed successfully.\n')
    return { success: true }
  } catch (e) { return { error: e.message } }
})

// ── Uninstall a single package from the active env ──
ipcMain.handle('uninstall-package', async (_, pkgName) => {
  try {
    assertWhitelistedPackage(pkgName)
    const env = getActiveEnv()
    if (!env) return { error: 'No active environment' }
    const py = getPythonForEnv(env)
    if (!py) return { error: 'Cannot find Python' }
    send('launch-log', `[*] Uninstalling ${pkgName}...\n`)
    await new Promise((resolve, reject) => {
      const proc = spawn(py, ['-m', 'pip', 'uninstall', '--yes', pkgName], {
        cwd: getRepoDir(), timeout: 60000, windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      })
      proc.stdout.on('data', (d) => { const s = d.toString(); if (s) send('launch-log', s) })
      proc.stderr.on('data', (d) => { const s = d.toString(); if (s) send('launch-log', s) })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error('pip uninstall exited code ' + code))
      })
      proc.on('error', reject)
    })
    send('launch-log', `[*] ${pkgName} uninstalled successfully.\n`)
    return { success: true }
  } catch (e) { return { error: e.message } }
})

// ── Check if a package is installed in the active env ──
// Security whitelist derived from ALL_PACKAGES (single source of truth).
// The check-package IPC can test if any known package is installed.
ipcMain.handle('check-package', async (_, pkgName) => {
  if (!ALL_PACKAGES.includes(pkgName)) {
    console.warn('[SECURITY] check-package blocked for:', pkgName)
    return { installed: false, error: 'Package not in whitelist' }
  }
  try {
    const env = getActiveEnv()
    if (!env) return { installed: false }
    const py = getPythonForEnv(env)
    if (!py) return { installed: false }
    // Use a Python helper script written to disk (not inline code) to avoid injection.
    // The package name is written into the script as a JSON string before execution.
    const helperPath = path.join(getDataDir(), '.check_pkg.py')
    const script = [
      'import sys, json',
      'try:',
      '  import importlib',
      '  mod = sys.argv[1]',
      '  importlib.import_module(mod)',
      '  print("ok")',
      'except:',
      '  print("no")',
    ].join('\n')
    fs.writeFileSync(helperPath, script)
    // Use spawn with arg array — no shell interpretation of pkgName.
    const modName = pkgName.replace(/-/g, '_')
    let r = 'no'
    try {
      r = await new Promise((resolve, reject) => {
        const child = spawn(py, [helperPath, modName], {
          cwd: getRepoDir(), timeout: 10000, windowsHide: true, encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe']
        })
        let out = ''
        child.stdout.on('data', d => { out += d.toString() })
        child.on('close', () => resolve(out.trim()))
        child.on('error', reject)
      })
    } catch {}
    return { installed: r === 'ok' }
  } catch { return { installed: false } }
})

// ── Restore all packages from requirements.txt ──
ipcMain.handle('restore-requirements', async () => {
  try {
    const env = getActiveEnv()
    if (!env) return { error: 'No active environment' }
    const py = getPythonForEnv(env)
    if (!py) return { error: 'Cannot find Python' }
    const reqPath = path.join(getRepoDir(), 'requirements.txt')
    if (!fs.existsSync(reqPath)) return { error: 'requirements.txt not found' }
    send('launch-log', '[*] Restoring packages from requirements.txt...\n')
    await new Promise((resolve, reject) => {
      const proc = spawn(py, ['-m', 'pip', 'install', '-r', reqPath], {
        cwd: getRepoDir(), timeout: 300000, windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1', TQDM_MININTERVAL: '0', TQDM_MINITERS: '1' }
      })
      proc.stdout.on('data', (d) => { const s = d.toString(); if (s) send('launch-log', s) })
      proc.stderr.on('data', (d) => { const s = d.toString(); if (s) send('launch-log', s) })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error('pip exited code ' + code))
      })
      proc.on('error', reject)
    })
    send('launch-log', '[*] Requirements restored successfully.\n')
    return { success: true }
  } catch (e) { return { error: e.message } }
})

// ── Hardware detection ──
ipcMain.handle('detect-hardware', async () => {
  // Async, bounded — CPU/RAM come from node os (instant), GPU/VRAM from the
  // shared async probe engine. Previously this was execSync with up to 10s
  // per probe and a WMI fallback cascade: ~15-20s of frozen main process on
  // machines where nvidia-smi is slow or absent (installer + dashboard cards).
  return autoTune.hardwareInfo()
})

// ── Auto-Tune (detect → recommend → apply to wgp_config.json) ──
// autoTune (require above, top of file) runs detect asynchronously with bounded
// subprocess timeouts so the Electron main process never blocks.

ipcMain.handle('auto-tune:detect', async () => {
  return autoTune.detect(getRepoDir())
})

ipcMain.handle('auto-tune:recommend', async (_, hw, opts) => {
  // If caller passes hardware data, use it; otherwise detect first
  const data = hw || await autoTune.detect(getRepoDir())
  return autoTune.recommend(data, opts)
})

ipcMain.handle('auto-tune:full-tune', async () => {
  return autoTune.fullTune(getRepoDir(), getDataDir())
})

// ── Hardware profile: maps detected GPU → expected install packages ──
ipcMain.handle('get-hardware-profile', () => {
  const profiles = {
    GTX_10:  { python: '3.10.9', torch: '2.7.1 CU12.8', triton: null, sage: null, sparge: null, flash: null, kernels: [] },
    RTX_20:  { python: '3.11.14', torch: '2.10.0 CU13',  triton: 'latest', sage: '1.0.6', sparge: null, flash: '2.8.3', kernels: ['nunchaku','gguf'] },
    RTX_30:  { python: '3.11.14', torch: '2.10.0 CU13',  triton: 'latest', sage: '2.2.0', sparge: '0.1.0', flash: '2.8.3', kernels: ['nunchaku','gguf'] },
    RTX_40:  { python: '3.11.14', torch: '2.10.0 CU13',  triton: 'latest', sage: '2.2.0', sparge: '0.1.0', flash: '2.8.3', kernels: ['nunchaku','gguf'] },
    RTX_50:  { python: '3.11.14', torch: '2.10.0 CU13',  triton: 'latest', sage: '2.2.0', sparge: '0.1.0', flash: '2.8.3', kernels: ['nunchaku','lightx2v','gguf'] },
    MPS:     { python: '3.11.14', torch: 'MPS',          triton: null, sage: null, sparge: null, flash: null, kernels: [] },
    AMD:     { python: '3.11.14', torch: 'ROCm 6.5',     triton: null, sage: null, sparge: null, flash: null, kernels: [] },
  }
  const result = { profile: 'STANDARD', packages: [] }
  try {
    const out = execSync('nvidia-smi --query-gpu=name --format=csv,noheader', { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim().split('\n')[0].trim().toUpperCase()
    if (out.includes('RTX')) {
      if (/50\d0/.test(out)) result.profile = 'RTX_50'
      else if (/40\d0/.test(out)) result.profile = 'RTX_40'
      else if (/30\d0/.test(out)) result.profile = 'RTX_30'
      else if (/20\d0/.test(out)) result.profile = 'RTX_20'
    } else if (out.includes('GTX') || /10\d0/.test(out)) {
      result.profile = 'GTX_10'
    }
  } catch {
    // Fallback MPS/AMD — keep STANDARD
  }
  if (profiles[result.profile]) {
    const p = profiles[result.profile]
    if (p.python) result.packages.push('🐍 Python ' + p.python)
    if (p.torch) result.packages.push('🔥 PyTorch ' + p.torch)
    if (p.triton) result.packages.push('⚡ Triton (' + p.triton + ')')
    if (p.sage) result.packages.push('🌀 Sage Attn ' + p.sage)
    if (p.sparge) result.packages.push('🌊 Sparge Attn ' + p.sparge)
    if (p.flash) result.packages.push('💥 Flash Attn ' + p.flash)
    for (const k of p.kernels) {
      const labels = { nunchaku: '🔩 Nunchaku INT4/FP4', lightx2v: '⚡ Lightx2v NVFP4', gguf: '📦 GGUF llama.cpp' }
      result.packages.push(labels[k] || k)
    }
    // All profiles get requirements.txt
    result.packages.push('📋 50+ reqs (diffusers, gradio, opencv, moviepy…)')
  }
  return result
})

// ── Live system metrics (free RAM / free VRAM) ──
// CPU + RAM come from the node `os` module (sub-ms, no subprocess).
// VRAM via nvidia-smi is async (spawn) to avoid blocking the main process every 2s.
// CPU values are deltas across successive calls (live utilization, not boot cumulative).
let _prevCpuTimes = null
let _lastNvidiaResult = null // fallback when nvidia-smi fails (e.g. GPU process restart)

/** Run nvidia-smi asynchronously and parse structured GPU metrics. */
function queryGpuMetricsAsync() {
  return new Promise((resolve) => {
    const child = spawn('nvidia-smi', [
      '--query-gpu=memory.free,memory.used,memory.total,utilization.gpu',
      '--format=csv,noheader,nounits'
    ], { timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) { resolve(null); return }
      resolve(stdout.trim())
    })
    child.on('error', () => resolve(null))
  })
}

ipcMain.handle('get-system-metrics', async () => {
  const result = { ramFree: null, vramFree: null, cpu: null, gpu: null, ramUsed: null, ramTotal: null, vramUsed: null, vramTotal: null }
  try {
    const total = os.totalmem(), free = os.freemem()
    const used = total - free
    const gb = b => Math.round(b / 1073741824) + ' GB'
    result.ramFree = gb(free)
    result.ramTotal = gb(total)
    result.ramUsed = gb(used)
    result.ram = Math.min(100, Math.round(used / total * 100))
    // CPU utilization via delta between successive samples (live, not cumulative).
    const cpus = os.cpus()
    let idle = 0, busy = 0
    for (const c of cpus) { for (const k in c.times) { if (k === 'idle') idle += c.times[k]; else busy += c.times[k] } }
    if (_prevCpuTimes) {
      const dIdle = idle - _prevCpuTimes.idle
      const dBusy = busy - _prevCpuTimes.busy
      const dTotal = dIdle + dBusy
      result.cpu = dTotal > 0 ? Math.round((dBusy / dTotal) * 100) : 0
    } else {
      result.cpu = null // first tick — no delta yet
    }
    _prevCpuTimes = { idle, busy }
  } catch { }
  // Async nvidia-smi query — non-blocking on the event loop
  try {
    const nvOut = await queryGpuMetricsAsync()
    if (nvOut) {
      const lines = nvOut.split('\n').map(l => l.trim()).filter(l => l)
      if (lines.length) {
        let free = 0, used = 0, total = 0, gpu = 0
        for (const ln of lines) {
          const p = ln.split(',').map(x => parseInt(x.trim()))
          if (p[0] != null && !isNaN(p[0])) free += p[0]
          if (p[1] != null && !isNaN(p[1])) used += p[1]
          if (p[2] != null && !isNaN(p[2])) total += p[2]
          if (p[3] != null && !isNaN(p[3])) gpu += p[3]
        }
        result.vramFree = total >= 1024 ? Math.round(free / 1024) + ' GB' : free + ' MB'
        result.vramUsed = total >= 1024 ? Math.round(used / 1024) + ' GB' : used + ' MB'
        result.vramTotal = total >= 1024 ? Math.round(total / 1024) + ' GB' : total + ' MB'
        result.vram = total ? Math.round(used / total * 100) : null
        result.gpu = lines.length > 1 ? Math.round(gpu / lines.length) : gpu
        _lastNvidiaResult = result
      }
    } else if (_lastNvidiaResult) {
      // nvidia-smi failed this tick — return last known values instead of blanks
      result.vramFree = _lastNvidiaResult.vramFree
      result.vramUsed = _lastNvidiaResult.vramUsed
      result.vramTotal = _lastNvidiaResult.vramTotal
      result.vram = _lastNvidiaResult.vram
      result.gpu = _lastNvidiaResult.gpu
    }
  } catch { }
  return result
})

// ── Report issue bundler ──
// One click: gather system info + launch-log tail + error_queue.zip (core crash
// diagnostics) into a folder under the data dir, zip it, open it in Explorer,
// and prefill a GitHub issue with the key diagnostics. Kills the
// "please paste your launch log" round-trip.
ipcMain.handle('report-issue', async () => {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const bundleDir = path.join(getDataDir(), 'report-' + stamp)
    fs.mkdirSync(bundleDir, { recursive: true })
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'))
    let wv = null
    try { wv = getLocalWangpHead() } catch {}
    const gpu = getGpuInfo()
    const gb = b => Math.round(b / 1073741824)
    const lines = []
    lines.push('Wan2GP Desktop Launcher version: ' + (pkg.version || 'unknown'))
    lines.push('Wan2GP core (local): ' + (wv || 'unknown'))
    lines.push('GPU: ' + (gpu.name || 'unknown') + ' (' + (gpu.vendor || '?') + ', ' + (gpu.vramMB || 0) + ' MB)')
    lines.push('OS: ' + os.platform() + ' ' + os.release() + ' arch=' + os.arch())
    lines.push('RAM: ' + gb(os.totalmem()) + ' GB total, ' + gb(os.freemem()) + ' GB free')
    lines.push('')
    lines.push('── Last ' + _logHistory.length + ' log line(s) ──')
    for (const h of _logHistory.slice(-300)) {
      lines.push(String(h.data || '').replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '').trimEnd())
    }
    fs.writeFileSync(path.join(bundleDir, 'system-info.txt'), lines.join('\n'), 'utf8')
    // Copy error_queue.zip from the Wan2GP repo if present (core crash diagnostics)
    let hadErrorQueue = false
    const eq = path.join(getRepoDir(), 'error_queue.zip')
    if (fs.existsSync(eq)) {
      try { fs.copyFileSync(eq, path.join(bundleDir, 'error_queue.zip')); hadErrorQueue = true } catch {}
    }
    // Zip the bundle (Windows-native Compress-Archive; launcher is Windows-only anyway)
    let zipPath = null
    if (IS_WIN) {
      try {
        const z = path.join(getDataDir(), 'report-' + stamp + '.zip')
        execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${bundleDir}\\*' -DestinationPath '${z}' -Force"`, { timeout: 30000, windowsHide: true })
        zipPath = z
      } catch {}
    }
    // Prefill the GitHub issue URL with key diagnostics
    const title = encodeURIComponent('[Issue report] ' + ((gpu.name || 'unknown GPU').slice(0, 60)))
    const body = [
      '**Launcher:** ' + (pkg.version || 'unknown'),
      '**Wan2GP core:** ' + (wv || 'unknown'),
      '**GPU:** ' + (gpu.name || 'unknown') + ' (' + (gpu.vramMB || 0) + ' MB)',
      '**OS:** ' + os.platform() + ' ' + os.release(),
      '',
      '**Describe the issue:**',
      '',
      '',
      '**Log tail:**',
      '```',
      ..._logHistory.slice(-30).map(h => String(h.data || '').replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '').trimEnd()),
      '```',
      '',
      '> Diagnostic bundle saved to: ' + (zipPath || bundleDir)
    ].join('\n')
    const issueUrl = 'https://github.com/GKartist75/wan2gp-desktop/issues/new?title=' + title + '&body=' + encodeURIComponent(body)
    shell.openPath(zipPath || bundleDir)
    shell.openExternal(issueUrl)
    return { success: true, bundleDir, zipPath, hadErrorQueue, logLines: _logHistory.length }
  } catch (e) {
    logError('report-issue', e)
    return { success: false, error: e.message }
  }
})

// ── Pulsebar (floating always-on-top progress) ──
// A tiny frameless, always-on-top window showing generation progress. It is driven
// by the same launch-log events the Queue Notifier parses, so it lights up the
// moment Wan2GP starts a generation and clears on completion/failure.
let _pulseWin = null

function pulseHtml() {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;background:rgba(20,20,28,0.92);font-family:sans-serif;overflow:hidden;}
  #w{height:6px;background:#2a2a36;}
  #f{height:100%;width:0;background:linear-gradient(90deg,#6c5ce7,#00b894);transition:width .3s;}
  #p{position:absolute;top:10px;left:12px;color:#cfd2dc;font-size:12px;}
  #x{position:absolute;top:8px;right:10px;color:#888;font-size:12px;cursor:pointer;}
</style></head><body>
<div id="w"><div id="f"></div></div>
<div id="p">Wan2GP</div><div id="x">×</div>
<script>
  const { ipcRenderer } = require('electron')
  document.getElementById('x').onclick = () => ipcRenderer.invoke('pulsebar-hide')
  ipcRenderer.on('pulse-update', (_, d) => {
    const f = document.getElementById('f'); const p = document.getElementById('p')
    f.style.width = (d.percent||0) + '%'
    p.textContent = (d.status||'Wan2GP') + (d.percent!=null ? ' · ' + d.percent + '%' : '')
  })
</script></body></html>`
}

function pulseShow(status, percent) {
  if (!_pulseWin) {
    const { screen } = require('electron')
    const s = screen.getPrimaryDisplay().workAreaSize
    _pulseWin = new BrowserWindow({
      width: 320, height: 32,
      x: Math.round((s.width - 320) / 2), y: s.height - 60,
      frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
      resizable: false, hasShadow: false, show: false
    })
    _pulseWin.loadURL('data:text/html,' + encodeURIComponent(pulseHtml()))
    _pulseWin.on('closed', () => { _pulseWin = null })
  }
  _pulseWin.webContents.once('did-finish-load', () => {
    _pulseWin.webContents.send('pulse-update', { status, percent })
    if (!_pulseWin.isVisible()) _pulseWin.show()
  })
  if (_pulseWin.webContents.isLoading?.()) return
  _pulseWin.webContents.send('pulse-update', { status, percent })
  if (!_pulseWin.isVisible()) _pulseWin.show()
}

function pulseHide() {
  if (_pulseWin) { try { _pulseWin.close() } catch {} _pulseWin = null }
}

ipcMain.handle('pulsebar-show', (_, { status, percent } = {}) => { pulseShow(status || 'Wan2GP', percent); return { ok: true } })
ipcMain.handle('pulsebar-hide', () => { pulseHide(); return { ok: true } })
ipcMain.handle('pulsebar-update', (_, { status, percent } = {}) => {
  if (_pulseWin) { _pulseWin.webContents.send('pulse-update', { status, percent }); return { ok: true } }
  return { ok: false }
})

// ── Desktop experience IPC handlers (tray, auto-start, notifications, theme) ──
ipcMain.handle('set-auto-start', (_, enabled) => {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled })
    const cfg = loadConfig(); cfg.autoStart = enabled; saveConfig(cfg)
    return { success: true }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('set-theme-follow-system', (_, enabled) => {
  try {
    const cfg = loadConfig(); cfg.themeFollowSystem = enabled; saveConfig(cfg)
    // Re-register or remove the native theme listener
    nativeTheme.removeAllListeners('updated')
    if (enabled) {
      nativeTheme.on('updated', () => {
        mainWin?.webContents.send('system-theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
      })
      // Send initial state immediately
      mainWin?.webContents.send('system-theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
    }
    return { success: true }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('set-notifications-enabled', (_, enabled) => {
  const cfg = loadConfig(); cfg.notificationsEnabled = enabled; saveConfig(cfg)
  return { success: true }
})

ipcMain.handle('quit-app', () => {
  app.isQuitting = true; app.quit()
})

// ── Auto-updater ──
// Update policy is config-driven. When autoUpdateEnabled is off we never check
// on launch, never auto-download, and never auto-install on quit — updates only
// happen through explicit user action (Check for updates → Download → Install & Restart).
function applyAutoUpdatePolicy() {
  const enabled = loadConfig().autoUpdateEnabled !== false
  autoUpdater.autoDownload = enabled
  // electron-updater's default is to install a downloaded update on quit.
  // Force it off when auto-updates are disabled so a manual download never
  // turns into a surprise install+restart at the next app exit.
  autoUpdater.autoInstallOnAppQuit = enabled
  return enabled
}
applyAutoUpdatePolicy()
autoUpdater.allowPrerelease = false

autoUpdater.on('checking-for-update', () => { console.log('[DEBUG] Checking for update...'); send('update-status', { status: 'checking' }) })
autoUpdater.on('update-available', (info) => { console.log('[DEBUG] Update available:', info.version); send('update-status', { status: 'available', version: info.version, releaseNotes: info.releaseNotes, autoDownload: autoUpdater.autoDownload }) })
autoUpdater.on('update-not-available', () => { console.log('[DEBUG] Up to date'); send('update-status', { status: 'up-to-date' }) })
autoUpdater.on('download-progress', (p) => { console.log('[DEBUG] Download progress:', p.percent); send('update-status', { status: 'downloading', percent: Math.round(p.percent), bytesPerSecond: p.bytesPerSecond, total: p.total, transferred: p.transferred }) })
autoUpdater.on('update-downloaded', (info) => { console.log('[DEBUG] Update downloaded:', info.version); send('update-status', { status: 'downloaded', version: info.version }) })
autoUpdater.on('error', (err) => { console.log('[DEBUG] Update error:', err.message); send('update-status', { status: 'error', message: err.message || err.toString() }) })

// ── VRAM / RAM Adjuster (manual memory-profile overrides) ──
ipcMain.handle('memory-profile:read', async () => {
  try {
    return { ok: true, settings: memoryProfile.readMemorySettings(getRepoDir(), getDataDir()) }
  } catch (e) {
    logError('memory-profile:read', e)
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('memory-profile:apply', async (_, settings) => {
  try {
    const r = memoryProfile.applyMemorySettings(settings, getRepoDir(), getDataDir())
    if (!r.success) return { ok: false, error: r.error }
    return { ok: true, applied: r.applied, path: r.path }
  } catch (e) {
    logError('memory-profile:apply', e)
    return { ok: false, error: e.message }
  }
})

// ── Queue Notifier (external delivery via Apprise) ──
const _notifierState = { lastPercent: null }
const _pulseState = { lastPercent: null }

function getNotifierConfig() {
  const cfg = loadConfig().notifier || {}
  // ensure shape; defaults applied by the pure module on set too
  const norm = queueNotifier.normalizeConfig(cfg)
  return norm.ok ? norm.config : { enabled: false, url: '', notifyOnComplete: true, notifyOnFail: true, notifyOnProgress: false, attachMedia: false, progressStep: 25 }
}

function saveNotifierConfig(cfg) {
  const norm = queueNotifier.normalizeConfig(cfg)
  if (!norm.ok) return { ok: false, error: norm.error }
  const c = loadConfig()
  c.notifier = norm.config
  saveConfig(c)
  return { ok: true, config: norm.config }
}

// Resolve the env's `apprise` CLI (apprise is pip-installable into the Wan2GP env).
function resolveApprise() {
  const env = getActiveEnv()
  const py = env ? getPythonForEnv(env) : null
  if (py) {
    for (const exe of ['apprise', 'apprise.exe']) {
      const p = path.join(path.dirname(py), exe)
      if (fs.existsSync(p)) return p
    }
    // fall back to python -m apprise
    return py
  }
  return 'apprise'
}

// Fire notifications for notable Wan2GP log events (called from the launch-log stream).
function notifyFromLog(text) {
  const cfg = getNotifierConfig()
  if (cfg.enabled && cfg.url) {
    const lines = String(text).split('\n')
    const events = queueNotifier.detectEvents(lines, _notifierState)
    for (const ev of events) {
      if (!queueNotifier.shouldNotify(ev, cfg)) continue
      const body = queueNotifier.buildMessage(ev, { jobName: cfg.jobName, includeLog: ev.kind === 'fail' })
      deliverNotifier(cfg.url, body).catch((e) => logError('notifyFromLog', e))
    }
  }
  // Pulsebar (independent of notifier) — driven by the same events.
  const pc = loadConfig().pulsebar
  if (pc && pc.enabled) {
    const lines = String(text).split('\n')
    const events = queueNotifier.detectEvents(lines, _pulseState)
    for (const ev of events) {
      if (ev.kind === 'progress') pulseShow('Generating', ev.percent)
      else if (ev.kind === 'complete') { pulseShow('Done', 100); setTimeout(pulseHide, 2500) }
      else if (ev.kind === 'fail') { pulseShow('Failed', null); setTimeout(pulseHide, 4000) }
    }
  }
}

// Deliver a message via Apprise. `py` arg means resolveApprise returned a python
// interpreter → use `python -m apprise`.
function deliverNotifier(url, body) {
  const apprise = resolveApprise()
  const args = ['-b', body, url]
  if (apprise.endsWith('apprise') && !apprise.includes(path.sep)) {
    // it's the literal `apprise`/python — if it's python, prepend -m
    if (apprise.includes('python')) return spawnAsync(apprise, ['-m', 'apprise', ...args])
    return spawnAsync(apprise, args)
  }
  return spawnAsync(apprise, args)
}

function spawnAsync(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: 'pipe' })
    let stderr = ''
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error('apprise exited ' + code + ': ' + stderr.slice(-400))))
    child.on('error', reject)
  })
}

ipcMain.handle('notifier-config', async () => ({ ok: true, config: getNotifierConfig() }))
ipcMain.handle('notifier-set', async (_, cfg) => saveNotifierConfig(cfg))
ipcMain.handle('notifier-test', async (_, cfg) => {
  const norm = queueNotifier.normalizeConfig(cfg || {})
  if (!norm.ok) return { ok: false, error: norm.error }
  try {
    await deliverNotifier(norm.config.url, 'Wan2GP Desktop Launcher: ✅ notifier test message')
    return { ok: true }
  } catch (e) { return { ok: false, error: e.message } }
})

// Lazily ensure `apprise` is installed into the active env (one-time, on enable).
ipcMain.handle('notifier-ensure', async () => {
  const env = getActiveEnv()
  const py = env ? getPythonForEnv(env) : null
  if (!py) return { ok: false, error: 'No active Wan2GP env — install Wan2GP first.' }
  try {
    // already resolvable?
    if (fs.existsSync(path.join(path.dirname(py), 'apprise.exe')) || fs.existsSync(path.join(path.dirname(py), 'apprise'))) {
      return { ok: true, already: true }
    }
    await spawnAsync(py, ['-m', 'pip', 'install', '--quiet', 'apprise'])
    return { ok: true }
  } catch (e) { return { ok: false, error: e.message } }
})

// ── Install hardening: pre-flight plan + post-install validation ──
function getFreeDiskBytes() {
  try {
    const p = getDataDir()
    if (!p) return 0
    const root = path.parse(p).root || p.substring(0, 2)
    if (typeof fs.statfsSync === 'function') {
      const s = fs.statfsSync(root)
      return s.bsize * s.bfree
    }
  } catch {}
  return 0
}

// Run a python one-liner and capture stdout+stderr (for install validation).
function spawnAsyncCaptured(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: 'pipe' })
    let stdout = '', stderr = ''
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error('exit ' + code + ': ' + stderr.slice(-500))))
    child.on('error', reject)
  })
}

ipcMain.handle('install-plan', async () => {
  try {
    const gpus = await autoTune.queryGpuList()
    const gpu = gpus[0] || null
    const ramGb = Math.round(os.totalmem() / 1073741824)
    // Compute capability best-effort from name (RTX 50 → 10.0, else let buildPlan
    // decide kernels from vendor only). CUDA *version* is not compute capability,
    // so we only special-case RTX 50 for the Nunchaku/LightX2V kernel list.
    const cap = /RTX\s*50/i.test(gpu ? gpu.name : '') ? 10.0 : 0
    const hw = {
      vendor: gpu ? gpu.vendor : 'UNKNOWN',
      name: gpu ? gpu.name : '',
      vramGb: gpu ? Math.round((gpu.vramMB || 0) / 1024) : 0,
      driverVersion: (getGpuInfo().driverVersion) || '',
      capability: cap,
      ramGb
    }
    const plan = installPlan.buildPlan(hw)
    const free = getFreeDiskBytes()
    const disk = { ...installPlan.diskCheck(Math.round(free / 1073741824)), freeGb: Math.round(free / 1073741824) }
    const gtxExempt = plan.driverWarning && / (10|16)\d{2}/.test(hw.name)
    const nvCu130Driver = !!plan.driverWarning && plan.vendor === 'NVIDIA' && !gtxExempt
    // Hard block: NVIDIA cu130 driver too old (generation will fail) or no disk.
    // AMD/Intel driver warnings are surfaced as soft warnings (may degrade, not fatal).
    const blocked = (!disk.ok) || nvCu130Driver
    const softWarn = !!plan.driverWarning && !nvCu130Driver
    return { ok: true, plan, disk, blocked, softWarn }
  } catch (e) {
    logError('install-plan', e)
    return { ok: false, error: e.message }
  }
})

// Post-install validation: confirm torch + CUDA actually import in the built env.
ipcMain.handle('validate-install', async () => {
  const env = getActiveEnv()
  const py = env ? getPythonForEnv(env) : null
  if (!py) return { ok: false, error: 'No active Wan2GP env' }
  try {
    const out = await spawnAsyncCaptured(py, ['-c',
      'import torch; print("torch=" + torch.__version__); print("cuda=" + str(torch.cuda.is_available())); print("cudaver=" + (torch.version.cuda or "n/a"))'])
    const cudaAvailable = /cuda=True/i.test(out.stdout)
    const torchVer = (out.stdout.match(/torch=([^\n]+)/) || [])[1] || '?'
    const cudaVer = (out.stdout.match(/cudaver=([^\n]+)/) || [])[1] || 'n/a'
    return { ok: true, torch: torchVer, cudaAvailable, cudaVer, raw: out.stdout.trim() }
  } catch (e) {
    return { ok: false, error: (e.stderr || e.message || '').toString().slice(-400) }
  }
})

ipcMain.handle('check-update', async (_, opts) => {
  if (opts?.local) {
    // Shift+click — test against local server
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: 'http://localhost:8888'
    })
  } else {
    const cfg = loadConfig()
    if (cfg.githubToken) {
      process.env.GH_TOKEN = cfg.githubToken
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'GKartist75',
        repo: 'wan2gp-desktop',
        token: cfg.githubToken
      })
    } else {
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'GKartist75',
        repo: 'wan2gp-desktop'
      })
    }
  }
  // checkForUpdates() returns a Promise — must await so a rejection (e.g. 404 on a
  // missing channel file, like latest-linux.yml before a Linux release exists) is
  // caught instead of killing the app with an unhandled rejection (Linux crash fix).
  try { await autoUpdater.checkForUpdates() } catch (e) { send('update-status', { status: 'error', message: e.message }) }
})

ipcMain.handle('download-update', async () => {
  try { await autoUpdater.downloadUpdate() } catch (e) { send('update-status', { status: 'error', message: e.message }) }
})

ipcMain.handle('install-update', async () => autoUpdater.quitAndInstall())

// ── Webview native context menu (copy/paste/select all) + DevTools lifecycle ──
app.on('web-contents-created', (_event, contents) => {
  contents.on('context-menu', (_event, params) => {
    const menu = new Menu()
    if (params.isEditable) {
      menu.append(new MenuItem({ label: 'Undo', role: 'undo' }))
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({ label: 'Cut', role: 'cut' }))
    }
    menu.append(new MenuItem({ label: 'Copy', role: 'copy' }))
    if (params.isEditable) menu.append(new MenuItem({ label: 'Paste', role: 'paste' }))
    menu.append(new MenuItem({ type: 'separator' }))
    menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }))
    menu.popup({ window: contents })
  })
  // Ensure DevTools renderer process is cleaned up when closing the DevTools window.
  // Electron undocked DevTools window can leave the renderer alive in background.
  contents.on('devtools-closed', () => {
    setImmediate(() => { try { contents.closeDevTools() } catch {} })
  })
  // Route F12 to BrowserView DevTools when in desktop mode, so the user can inspect
  // the embedded Wan2GP page instead of the Electron shell. Falls back to the focused
  // webContents' own DevTools when no BrowserView is active.
  // Build the picker menu once (cached to avoid GC churn on every keypress).
  let _devtoolsPicker = null
  contents.on('before-input-event', (event, input) => {
    if ((input.key === 'F12' || (input.control && input.shift && input.key === 'I')) && input.type === 'keyDown') {
      event.preventDefault()
      setImmediate(() => {
        try {
          if (_bv && mainWin && mainWin.getBrowserViews().includes(_bv)) {
            // Both DevTools available — let the user pick
            if (!_devtoolsPicker) {
              _devtoolsPicker = Menu.buildFromTemplate([
                { label: 'Wan2GP (embedded content)',  click: () => toggleDevTools(_bv.webContents) },
                { label: 'Electron Shell (launcher UI)', click: () => toggleDevTools(mainWin.webContents) },
              ])
            }
            _devtoolsPicker.popup({ window: mainWin })
          } else {
            toggleDevTools(contents)
          }
        } catch {}
      })
    }
  })
})

// ── System Tray (minimize-to-tray with context menu) ──
function updateTrayMenu() {
  if (!tray) return
  const isRunning = _wangpProc !== null || _currentPort > 0
  const showLabel = mainWin && mainWin.isVisible() ? 'Hide Window' : 'Show Window'
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: showLabel, click: () => { if (mainWin) { mainWin.isVisible() ? mainWin.hide() : mainWin.show() } } },
    { type: 'separator' },
    { label: isRunning ? 'Stop Wan2GP Server' : 'Wan2GP Stopped', enabled: isRunning, click: () => {
      stopWangpServer()
      send('wangp-exit', -1); send('launch-log', '[!] Wan2GP stopped via tray.\n')
    }},
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit() } },
  ]))
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png')
  try {
    tray = new Tray(iconPath)
    tray.setToolTip('Wan2GP Desktop')
    updateTrayMenu()
  } catch (e) { console.error('[TRAY] Failed to create tray:', e.message) }
}

// ── Renderer crash recovery ──
// "The GUI disappeared" reports: on Windows a display-driver hiccup (TDR) under
// heavy GPU load — a Wan2GP generation saturating the card — can kill
// Chromium's GPU process and take a renderer down with it. The window goes
// blank while the main process (and the generation, which runs in its own
// Python process) keeps running. There was no handler anywhere, so the only
// recovery was a manual reload back to the dashboard. This watchdog detects
// those deaths and heals the window automatically: reload the launcher
// renderer (bounded — no reload loops), auto-reload a crashed embedded-Wan2GP
// BrowserView, and let the reloaded UI put itself back where it was (see
// get-crash-recovery-info) instead of stranding the user on the dashboard.
let _uiMode = null                 // last UI mode the renderer reported: 'app' | 'browser' | null
let _pendingCrashRestore = false   // set on a launcher-renderer crash; consumed by the reloaded UI
let _gpuProcessDied = false        // GPU process crashed since startup (driver hiccup — likely culprit)
let _crashTimes = []               // timestamps of launcher-UI crashes (bounds the auto-reload)
let _bvUrl = null                  // last URL loaded into the Wan2GP BrowserView (for auto-reload)

const CRASH_RELOAD_WINDOW_MS = 10 * 60 * 1000
const CRASH_RELOAD_MAX = 2

function watchRenderer(contents, label, onGone) {
  contents.on('render-process-gone', (_e, details) => {
    const reason = details && details.reason ? String(details.reason) : 'unknown'
    const exitCode = details && typeof details.exitCode === 'number' ? details.exitCode : '?'
    if (reason === 'clean-exit') return // normal teardown (window closed), not a crash
    console.error(`[crash] ${label} renderer gone (${reason}, exit ${exitCode})`)
    if (onGone) onGone(details)
  })
}

function handleMainRendererGone(details) {
  const now = Date.now()
  _crashTimes = _crashTimes.filter(t => now - t < CRASH_RELOAD_WINDOW_MS)
  _crashTimes.push(now)
  _pendingCrashRestore = true
  const reason = details && details.reason ? String(details.reason) : 'unknown'
  const gpuHint = _gpuProcessDied
  const gpuLine = gpuHint
    ? ' The display driver likely reset while the GPU was under heavy load (a running generation). The server itself is unaffected.'
    : ''
  // Auto-reload (bounded) so the window heals itself instead of staying dead grey.
  if (_crashTimes.length <= CRASH_RELOAD_MAX) {
    // If the GPU process just died, give Chromium ~2s to respawn it before
    // reloading — a reload into a still-dead GPU process crashes right back.
    const delay = gpuHint ? 2000 : 800
    setTimeout(() => {
      if (!mainWin || mainWin.isDestroyed()) return
      send('launch-log', `[!] Launcher UI ${reason} — reloading automatically. The Wan2GP server keeps running.${gpuLine}\n`)
      try { mainWin.webContents.reload() } catch (e) { logError('crash-reload', e) }
    }, delay)
  } else {
    // Repeated crashes: stop the reload loop and say what to do instead.
    send('launch-log', `[!] Launcher UI ${reason} repeatedly (${_crashTimes.length} crashes in 10 min) — not auto-reloading again.${gpuLine}\n`)
    send('launch-log', '[!] If this keeps happening during generation, disable GPU acceleration: Settings → General → “Enable GPU acceleration”, then restart the launcher. The UI restart never touches generation.\n')
    try {
      if (loadConfig().notificationsEnabled !== false) {
        new Notification({ title: 'Wan2GP Desktop', body: 'Launcher UI crashed repeatedly. Disable GPU acceleration in Settings → General and restart the launcher.' }).show()
      }
    } catch {}
  }
}

// GPU-process death is the usual accomplice of a display-driver reset: flag it
// so the main-window recovery waits for the respawn and mentions the cause.
app.on('child-process-gone', (_e, details) => {
  if (!details || details.type !== 'GPU') return
  if (details.reason === 'clean-exit') return
  _gpuProcessDied = true
  console.error('[crash] GPU process died:', details.reason, 'exit', details.exitCode)
})

// The renderer reports which UI mode it is in so a later crash can be undone.
ipcMain.handle('ui-mode-set', (_e, mode) => {
  _uiMode = mode === 'app' ? 'app' : (mode === 'browser' ? 'browser' : null)
  return true
})

// Consumed once by the reloaded launcher UI: tells it a crash just happened,
// whether the Wan2GP server is still up, and what mode it was in — so it can
// put the window back exactly where the user was instead of the bare dashboard.
ipcMain.handle('get-crash-recovery-info', () => {
  const info = {
    pending: _pendingCrashRestore,
    mode: _uiMode,
    serverRunning: _wangpProc !== null || _currentPort > 0,
    url: _currentPort > 0 ? `http://127.0.0.1:${_currentPort}` : null,
    gpuProcessDied: _gpuProcessDied
  }
  _pendingCrashRestore = false
  return info
})

// ── Window ──

function toggleDevTools(wc) {
  if (wc.isDevToolsOpened()) wc.closeDevTools()
  else wc.openDevTools({ mode: 'detach' })
}

function createWindow() {
  const savedState = (loadConfig().windowState || {})

  mainWin = new BrowserWindow({
    width: savedState.width || 1280, height: savedState.height || 800,
    minWidth: 900, minHeight: 600,
    x: savedState.x, y: savedState.y,
    title: 'Wan2GP Desktop Launcher',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
    show: false, backgroundColor: '#0f0f0f', maximizable: true,
  })
  // Hide the default Electron menu (File/Edit/View/Window) — this app has its own UI.
  if (PLATFORM !== 'darwin') Menu.setApplicationMenu(null)
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // Crash watchdog: a dead renderer blanked the window with no recovery.
  watchRenderer(mainWin.webContents, 'launcher', handleMainRendererGone)

  // Restore maximized state after load
  if (savedState.maximized) mainWin.maximize()

  // Save window state on changes — debounced (a sync config write on every
  // resize/move tick was jank; 400ms coalescing keeps the last position).
  let _wsDebounce = null
  const persistWindowState = () => {
    if (!mainWin || app.isQuitting) return
    const cfg = loadConfig()
    const state = { maximized: mainWin.isMaximized() }
    if (!state.maximized) {
      const b = mainWin.getBounds()
      state.x = b.x; state.y = b.y; state.width = b.width; state.height = b.height
    }
    cfg.windowState = state
    saveConfig(cfg)
  }
  const saveWindowState = () => {
    if (!mainWin || app.isQuitting) return
    clearTimeout(_wsDebounce)
    _wsDebounce = setTimeout(persistWindowState, 400)
  }
  mainWin.on('resize', saveWindowState)
  mainWin.on('move', saveWindowState)
  // Flush the pending write on close so the final position is never lost.
  mainWin.on('close', () => { if (_wsDebounce) { clearTimeout(_wsDebounce); persistWindowState() } })

  // Close → quit app so tray is always cleaned up in before-quit
  mainWin.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); app.quit() }
  })
  mainWin.on('show', () => updateTrayMenu())
  mainWin.on('hide', () => updateTrayMenu())

  mainWin.once('ready-to-show', () => {
    mainWin.show()
  })
  mainWin.on('closed', () => { mainWin = null })
}

process.on('uncaughtException', err => console.error('[FATAL]', err))
process.on('unhandledRejection', reason => console.error('[FATAL] Unhandled Rejection:', reason))

// ── Single-instance lock: re-runs focus the existing window instead of stacking ──
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore()
      mainWin.focus()
    }
  })
}

app.whenReady().then(() => {
  // Pin data dir on first launch so it never shifts between updates
  try {
    if (!fs.existsSync(DATA_DIR_OVERRIDE)) {
      const d = path.join(app.getPath('userData'), 'Wan2GP')
      fs.mkdirSync(d, { recursive: true })
      fs.writeFileSync(DATA_DIR_OVERRIDE, d)
    }
    // Redirect Electron's internal runtime data (Cache, blob_storage, etc.) to chosen dir
    if (fs.existsSync(DATA_DIR_OVERRIDE)) {
      const d = fs.readFileSync(DATA_DIR_OVERRIDE, 'utf8').trim()
      if (d) {
        const ed = path.join(d, '.electron')
        fs.mkdirSync(ed, { recursive: true })
        app.setPath('userData', ed)
      }
    }
  } catch (e) { logError('data-dir-init', e) }
  createWindow()
  createTray()

  // Native theme auto-follow
  try {
    const startupCfg = loadConfig()
    if (startupCfg.themeFollowSystem) {
      nativeTheme.on('updated', () => {
        mainWin?.webContents.send('system-theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
      })
    }
  } catch {}

  setTimeout(() => {
    (async () => {
      try {
        const cfg = loadConfig()
        // Auto-update gate: when disabled, never check on launch. Updates only
        // happen through the explicit "Check for updates" button in the UI.
        if (cfg.autoUpdateEnabled === false) return
        if (cfg.githubToken) {
          process.env.GH_TOKEN = cfg.githubToken
          autoUpdater.setFeedURL({
            provider: 'github',
            owner: 'GKartist75',
            repo: 'wan2gp-desktop',
            token: cfg.githubToken
          })
        }
        // checkForUpdates() returns a Promise — await so a rejection (404 on missing
        // channel file, e.g. latest-linux.yml before a Linux release exists) is caught
        // instead of killing the app (Linux startup crash fix).
        await autoUpdater.checkForUpdates()
      } catch {}
    })()
  }, 5000)
})
app.on('window-all-closed', () => {
  killProcessTree(setupProc); setupProc = null
  stopWangpServer()
  app.isQuitting = true
  if (PLATFORM !== 'darwin') app.quit()
})
app.on('activate', () => { if (!mainWin) createWindow() })
app.on('before-quit', () => {
  app.isQuitting = true
  killProcessTree(setupProc); setupProc = null
  stopWangpServer()
  // Close any open DevTools to prevent orphan renderer processes
  try { if (mainWin) { if (mainWin.webContents.isDevToolsOpened()) mainWin.webContents.closeDevTools(); if (_bv && mainWin.getBrowserViews().includes(_bv) && _bv.webContents.isDevToolsOpened()) _bv.webContents.closeDevTools() } } catch {}
  // Destroy tray so the icon doesn't linger in notification area
  try { if (tray) { tray.destroy(); tray = null } } catch {}
})
