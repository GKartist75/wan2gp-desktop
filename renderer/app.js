"use strict";

// ── Global Log Buffer ──
const logBuffer = []
const MAX_LOG = 5000
let lastLine = ''
let _carriageReturn = false  // next text part replaces lastLine instead of appending (tqdm progress bars)
function appendLog(text) {
  if (!text) return
  // Normalize Windows \r\n to \n first (avoids \r clearing lastLine before \n pushes it)
  const parts = text.replace(/\r\n/g, '\n').split(/(\r|\n)/)
  for (const part of parts) {
    if (part === '\r') {
      // \r = go to start of line — next text OVERWRITES lastLine, doesn't append.
      // The render shows lastLine as the in-progress line, so progress bars stay visible.
      _carriageReturn = true
    } else if (part === '\n') {
      if (lastLine.trim()) logBuffer.push(lastLine.trim())
      lastLine = ''
      _carriageReturn = false
    } else {
      if (_carriageReturn) {
        lastLine = part
        _carriageReturn = false
      } else {
        lastLine += part
      }
    }
  }
  while (logBuffer.length > MAX_LOG) logBuffer.shift()
  renderTerminals()
}

const termFollow = { termBody: true, ftTermBody: true, installTermBody: true }
const termAutoScroll = {}

function renderTerminals() {
  // Include the in-progress (carriage-return-updated) line so progress bars are visible
  // before a newline arrives. When lastLine is empty we show buffer only.
  const text = logBuffer.join('\n') + (lastLine ? '\n' + lastLine : '')
  ;['termBody','ftTermBody','installTermBody'].forEach(id => {
    const el = document.getElementById(id)
    if (!el) return
    el.textContent = text
    if (termFollow[id]) setTimeout(() => { el.scrollTop = el.scrollHeight }, 10)
  })
}

function setupScrollUnfollow(bodyId, btnId) {
  const body = document.getElementById(bodyId)
  const btn = btnId ? document.getElementById(btnId) : null
  if (!body) return
  body.addEventListener('scroll', () => {
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 30
    if (!atBottom && termFollow[bodyId]) { termFollow[bodyId] = false; if (btn) { btn.classList.remove('active'); const ft=btn.querySelector('.follow-text'); if(ft) ft.textContent='Follow' } }
    else if (atBottom && !termFollow[bodyId]) { termFollow[bodyId] = true; if (btn) { btn.classList.add('active'); const ft=btn.querySelector('.follow-text'); if(ft) ft.textContent='Follow' } }
  })
}

const $ = id => document.getElementById(id)
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); $(id).classList.add('active') }
function breakPath(p) { if (!p) return p; const zwsp = String.fromCharCode(0x200B); const bs = String.fromCharCode(0x5C); const s = String(p); return s.split(bs).join(bs + zwsp).split('/').join('/' + zwsp); }

// ── Floating Terminal state/helpers (hoisted so the launch handler can use them) ──
let _ftVisible = false
// A BrowserView always composites above DOM, so the terminal (plain DOM) can't sit on top of
// Wan2GP. Strategy: docked (bottom/top/left/right) → shrink the view, DOM console sits beside
// Wan2GP (side-by-side); floating → console is its OWN window (movable to another monitor) and
// Wan2GP is detached so the main window isn't left showing a grey Wan2GP panel.
function currentDock() {
  const ft = $('floatingTerminal')
  for (const d of ['bottom', 'top', 'left', 'right', 'floating']) {
    if (ft.classList.contains('dock-' + d)) return d
  }
  return 'bottom'
}
// Show the console for the current dock. Returns nothing.
function showTerminal() {
  const floating = $('floatingTerminal').classList.contains('dock-floating')
  if (floating) {
    // Wan2GP stays visible & full; the console lives in its own movable window.
    $('floatingTerminal').classList.add('hidden')
    window.w2gp.destroyTermView()
    window.w2gp.reattachBrowserView()
    window.w2gp.createTermView()
  } else {
    // DOM panel beside a shrunk Wan2GP.
    window.w2gp.destroyTermView()
    $('floatingTerminal').classList.remove('hidden')
    // Sync DOM terminal with the latest buffer (logs may have arrived while floating was active)
    renderTerminals()
    window.w2gp.reattachBrowserView()
    window.w2gp.bvSetDock(currentDock())
    window.w2gp.hideBrowserView('term')
  }
}
function hideTerminal() {
  $('floatingTerminal').classList.add('hidden')
  window.w2gp.destroyTermView()
  window.w2gp.reattachBrowserView()   // ensure Wan2GP is full again (no-op when already)
}
function toggleFloatingTerm() {
  if ($('dashBody').style.display === 'none') {
    _ftVisible = !_ftVisible
    if (_ftVisible) { renderTerminals(); showTerminal() }
    else { hideTerminal() }
  }
}
function closeFloatingTerm() {
  _ftVisible = false
  hideTerminal()
}
// Apply a dock position to the floating terminal (className + IPC), without toggling visibility.
// When the console is open this also switches the rendering mode (DOM vs overlay) as needed.
function setFtDock(dock) {
  const ft = $('floatingTerminal')
  ft.className = 'floating-term dock-' + dock + (ft.classList.contains('hidden') ? ' hidden' : '')
  if (dock !== 'floating') ft.style.cssText = ''
  document.querySelectorAll('.dock-btn').forEach(b => b.classList.toggle('active', b.dataset.dock === dock))
  window.w2gp.bvSetDock(dock)
  if ($('dashBody').style.display === 'none' && _ftVisible) showTerminal()
}
// Settings toggle handlers registered once (avoids memory leak from repeated onchange reassignment).
let _settingsTogglesReady = false
function initSettingsToggles() {
  if (_settingsTogglesReady) return
  _settingsTogglesReady = true

  $('electronGpuToggle')?.addEventListener('change', async () => {
    const gpu = $('electronGpuToggle')
    const c = await window.w2gp.configLoad()
    c.electronGpu = gpu.checked
    await window.w2gp.configSave(c)
    showToast(gpu.checked ? 'GPU enabled — restart to apply' : 'GPU disabled — restart to free VRAM')
  })
  $('autoStartToggle')?.addEventListener('change', async () => {
    const el = $('autoStartToggle')
    const r = await window.w2gp.setAutoStart(el.checked)
    if (r && r.success) showToast(el.checked ? 'Will start with Windows' : 'Removed from startup')
    else showToast('✗ ' + (r && r.error ? r.error : 'Failed'))
  })
  $('followSystemThemeToggle')?.addEventListener('change', async () => {
    const el = $('followSystemThemeToggle')
    await window.w2gp.setThemeFollowSystem(el.checked)
    showToast(el.checked ? 'Theme will follow system' : 'Manual theme control restored')
  })
  $('notificationsToggle')?.addEventListener('change', async () => {
    const el = $('notificationsToggle')
    await window.w2gp.setNotificationsEnabled(el.checked)
    showToast(el.checked ? 'Notifications enabled' : 'Notifications disabled')
  })
  $('shareToggle')?.addEventListener('change', async () => {
    const el = $('shareToggle')
    const c = await window.w2gp.configLoad()
    c.share = el.checked
    await window.w2gp.configSave(c)
    showToast(el.checked ? 'Share link enabled — Gradio will create a public tunnel on next launch' : 'Share link disabled')
  })
}

function openSettings() {
  initSettingsToggles()
  $('settingsPanel').classList.add('open'); $('settingsOverlay').classList.add('visible')
  // In webview (desktop) mode a BrowserView always composites above DOM, so it can't be
  // covered — detach it while Manage is open so the panel renders in front of the viewer.
  // The opaque backdrop class replaces the viewer area (no black flash).
  if ($('dashBody').style.display === 'none') {
    window.w2gp.detachBrowserView()
    $('settingsOverlay').classList.add('opaque')
  }
  window.w2gp.configLoad().then(function(cfg) {
    if ($('launchArgsInput')) $('launchArgsInput').value = cfg.launchArgs || ''
    if ($('portInput')) $('portInput').value = cfg.serverPort || 7860
    if ($('githubTokenInput')) $('githubTokenInput').value = cfg.githubToken || ''
    if ($('hfTokenInput')) $('hfTokenInput').value = cfg.hfToken || ''
    // Floating terminal default dock
    const td = cfg.termDockDefault || 'bottom'
    document.querySelectorAll('input[name="termDock"]').forEach(r => { r.checked = (r.value === td) })
    // Sync toggle states from config (handlers already registered via initSettingsToggles)
    const gpu = $('electronGpuToggle')
    if (gpu) gpu.checked = cfg.electronGpu !== false
    const autoStart = $('autoStartToggle')
    if (autoStart) autoStart.checked = cfg.autoStart === true
    const followTheme = $('followSystemThemeToggle')
    if (followTheme) followTheme.checked = cfg.themeFollowSystem === true
    const notifications = $('notificationsToggle')
    if (notifications) notifications.checked = cfg.notificationsEnabled !== false
    const share = $('shareToggle')
    if (share) share.checked = cfg.share === true
  })
  loadBrowserList()
  // Check hf_xet install status
  updateXetStatus()
}
function closeSettings() { $('settingsPanel').classList.remove('open'); $('settingsOverlay').classList.remove('visible')
  // Restore the BrowserView (re-attach the still-alive view) when leaving Manage in webview mode.
  if ($('dashBody').style.display === 'none') {
    $('settingsOverlay').classList.remove('opaque')
    // Don't reattach over an open terminal — restore the correct view state instead.
    if (_ftVisible) showTerminal()
    else window.w2gp.reattachBrowserView()
  }
 }
// Populate the Manage "Default Browser" list from the main process.
async function loadBrowserList() {
  const list = $('browserList')
  if (!list) return
  list.innerHTML = '<div class="browser-row"><label class="browser-opt"><input type="radio" name="defaultBrowser" value="system" checked> System default</label></div>'
  try {
    const { browsers, defaultBrowser } = await window.w2gp.detectBrowsers()
    for (const b of browsers) {
      const row = document.createElement('div')
      row.className = 'browser-row'
      const label = document.createElement('label')
      label.className = 'browser-opt'
      const radio = document.createElement('input')
      radio.type = 'radio'; radio.name = 'defaultBrowser'; radio.value = b.id
      radio.disabled = !b.installed
      if (b.id === defaultBrowser) radio.checked = true
      label.appendChild(radio)
      label.appendChild(document.createTextNode(' ' + b.name + (b.installed ? '' : ' (not installed)')))
      row.appendChild(label)
      list.appendChild(row)
    }
    list.querySelectorAll('input[name="defaultBrowser"]').forEach(r => {
      r.addEventListener('change', async () => {
        if (!r.checked) return
        const cfg = await window.w2gp.configLoad()
        cfg.defaultBrowser = r.value
        await window.w2gp.configSave(cfg)
        appendLog(`[*] Default browser set to: ${r.value}`)
      })
    })
  } catch (e) { appendLog(`[!] Browser detection failed: ${e.message}`) }
}
// ── Theme ──
function applyTheme(theme) {
  const html = document.documentElement
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    const sun = btn.querySelector('.sun-icon')
    const moon = btn.querySelector('.moon-icon')
    if (theme === 'dark') {
      if (sun) sun.style.display = 'none'
      if (moon) moon.style.display = ''
    } else {
      if (sun) sun.style.display = ''
      if (moon) moon.style.display = 'none'
    }
  })
  if (theme === 'dark') html.setAttribute('data-theme', 'dark')
  else html.removeAttribute('data-theme')
}

async function toggleTheme() {
  const cfg = await window.w2gp.configLoad()
  const next = cfg.theme === 'dark' ? 'light' : 'dark'
  cfg.theme = next
  await window.w2gp.configSave(cfg)
  applyTheme(next)
}

let prevPhaseId = null

// Show renderer errors on splash so blank-screen root cause is visible
window.addEventListener('error', e => {
  const el = $('splashError')
  if (el) { el.textContent = e.error?.stack || e.message || String(e); el.classList.remove('hidden') }
})
window.addEventListener('unhandledrejection', e => {
  const el = $('splashError')
  if (el) { el.textContent = e.reason?.stack || String(e.reason); el.classList.remove('hidden') }
})

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  try {
  const installed = await window.w2gp.checkInstalled()

  window.w2gp.getDesktopVersion().then(function(v) {
    if (!v) return
    document.title = 'Wan2GP Desktop Launcher v' + v
    var verEl = $('settingsVersionNum')
    if (verEl) verEl.textContent = v
    var appVerEl = $('appVersionTag')
    if (appVerEl) appVerEl.textContent = 'v' + v
    var desktopVerEl = $('desktopVersionNum')
    if (desktopVerEl) desktopVerEl.textContent = v
  })
  setupScrollUnfollow('termBody','dashTermFollowBtn')
  setupScrollUnfollow('installTermBody','installFollowBtn')

  window.w2gp.onSetupOutput(t => appendLog(t.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,'').replace(/\x08/g,'')))

  window.w2gp.onLaunchLog(t => appendLog(t.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,'').replace(/\x08/g,'')))
  window.w2gp.onSetupPhase(p => {
    if (p.done) {
      if (prevPhaseId && prevPhaseId !== p.id) taskComplete(prevPhaseId)
      taskComplete(p.id)
      prevPhaseId = null
    } else {
      if (prevPhaseId && prevPhaseId !== p.id) taskComplete(prevPhaseId)
      taskStart(p.id)
      appendLog('[*] ' + p.label)
      prevPhaseId = p.id
    }
  })
  window.w2gp.onSetupProfile(p => { $('installProfile').textContent=p; $('installProfileRow').style.display='flex' })

  const cfg = await window.w2gp.configLoad()
  if (cfg.theme === 'dark') applyTheme('dark')

  // Listen for system theme changes (native theme follow)
  window.w2gp.onSystemThemeChange(function(theme) {
    applyTheme(theme)
  })

  loadHardware()

  if (installed.repo && installed.env) {
    show('dashboard')
    refreshDashboard()
    // Live system metrics polling (topbar sparklines + dashboard free-text)
    startMetricsPolling()
  } else {
    $('splashStatus').textContent = 'First-time setup...'
    const hw = await window.w2gp.detectHardware()
    $('installCpu').textContent=hw.cpu||'—'; $('installRam').textContent=hw.ram||'—'
    $('installGpu').textContent=hw.gpu||'—'; $('installVram').textContent=hw.vram||'—'
    loadPaths()
    try {
      const mf = await window.w2gp.detectModelFolders()
      if (mf.checkpointsPaths && mf.checkpointsPaths.length) {
        _modelCkpts = mf.checkpointsPaths[0]
        $('installCkptsPath').textContent = _modelCkpts
      }
      if (mf.lorasRoot) {
        _modelLoras = mf.lorasRoot
        $('installLorasPath').textContent = _modelLoras
      }
    } catch {}
    show('installer')
    $('installSubtitle').textContent = 'Select environment type, then click Install'
    $('installStartBtn').classList.remove('hidden')
    $('envTypeSelect').classList.remove('disabled')
    document.querySelectorAll('.env-type-btn').forEach(b => b.disabled = false)
    // Show expected packages for this hardware
    window.w2gp.getHardwareProfile().then(function(hp) {
      var list = $('installPkgsList')
      var header = $('installPkgsProfile')
      if (!list || !hp || !hp.packages || !hp.packages.length) return
      if (header) header.textContent = '(' + hp.profile.replace(/_/g,' ') + ')'
      list.innerHTML = hp.packages.map(function(p) { return '<span class="ipkg-item">' + p + '</span>' }).join('')
      $('installPkgs').style.display = ''
    })
  }
  } catch (e) {
    const el = $('splashError')
    if (el) { el.textContent = e.stack || String(e); el.classList.remove('hidden') }
    $('splashStatus').textContent = 'Startup error'
  }
})

// ── Hardware ──
async function loadHardware() {
  const s = await window.w2gp.detectHardware()
  $('specCpu').textContent=s.cpu||'—'; $('specRam').textContent=s.ram||'—'
  $('specGpu').textContent=s.gpu||'—'; $('specVram').textContent=s.vram||'—'
}

// ── Live topbar metrics (CPU/GPU/RAM/VRAM sparklines) ──
const _sparkHistory = { cpu: [], gpu: [], ram: [], vram: [] }
const _sparkMax = 60  // samples kept (~2 min at 2s)

function drawSpark(id, data, color) {
  const c = $(id); if (!c) return
  const ctx = c.getContext('2d')
  const w = c.width, h = c.height
  ctx.clearRect(0, 0, w, h)
  if (data.length < 2) return
  const max = 100
  ctx.beginPath()
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - (Math.max(0, Math.min(max, v)) / max) * h
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  })
  ctx.strokeStyle = color; ctx.lineWidth = 1.25; ctx.stroke()
  // fill under curve
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath()
  ctx.fillStyle = color + '22'; ctx.fill()
}

function pushMetric(key, val) {
  const arr = _sparkHistory[key]
  arr.push(val == null ? 0 : val)
  if (arr.length > _sparkMax) arr.shift()
}

function startMetricsPolling() {
  const tick = async () => {
    let m
    try { m = await window.w2gp.getSystemMetrics() } catch { return }
    if (!m) return
    if (m.ramFree) { const el = $('specRamFree'); if (el) el.textContent = '(' + m.ramFree + ' free)' }
    if (m.vramFree) { const el = $('specVramFree'); if (el) el.textContent = '(' + m.vramFree + ' free)' }
    pushMetric('cpu', m.cpu); pushMetric('gpu', m.gpu); pushMetric('ram', m.ram); pushMetric('vram', m.vram)
    if ($('valCpu')) $('valCpu').textContent = m.cpu != null ? m.cpu + '%' : '—'
    if ($('valGpu')) $('valGpu').textContent = m.gpu != null ? m.gpu + '%' : '—'
    if ($('valRam')) $('valRam').textContent = m.ramUsed ? m.ramUsed + '/' + m.ramTotal : '—'
    if ($('valVram')) $('valVram').textContent = m.vramUsed ? m.vramUsed + '/' + m.vramTotal : '—'
    drawSpark('sparkCpu', _sparkHistory.cpu, '#4ADE80')
    drawSpark('sparkGpu', _sparkHistory.gpu, '#60A5FA')
    drawSpark('sparkRam', _sparkHistory.ram, '#FBBF24')
    drawSpark('sparkVram', _sparkHistory.vram, '#F472B6')
  }
  if (window.__metricsTimer) clearInterval(window.__metricsTimer)
  window.__metricsTick = tick
  tick()
  window.__metricsTimer = setInterval(tick, 2000)
}

// ── Task List ──
const taskMap = {}; document.querySelectorAll('.task').forEach(t => { taskMap[t.dataset.id]=t })
function taskStart(id){ const t=taskMap[id];if(!t)return; t.className='task active'; t.querySelector('.task-icon').textContent='○'; t.querySelector('.task-status').textContent='running' }
function taskComplete(id,failed){ const t=taskMap[id];if(!t)return; t.className=failed?'task fail':'task done'; t.querySelector('.task-icon').textContent=failed?'✕':'✓'; t.querySelector('.task-status').textContent=failed?'failed':'done' }
function resetTasks(){ Object.values(taskMap).forEach(t=>{ t.className='task pending'; t.querySelector('.task-icon').textContent='○'; t.querySelector('.task-status').textContent='pending' }) }

// ── Installer ──
let selectedEnvType = 'uv'

document.querySelectorAll('.env-type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.env-type-btn').forEach(b => b.classList.remove('selected'))
    btn.classList.add('selected')
    selectedEnvType = btn.dataset.env
  })
})

$('installStartBtn').addEventListener('click', startInstall)
$('reinstallFreshBtn').addEventListener('click', () => doInstall(null, 'reinstall'))
$('reinstallUpdateBtn').addEventListener('click', () => doInstall(null, 'update'))
$('reinstallSkipBtn').addEventListener('click', () => doInstall(null, 'skip'))

$('browseAppDataPath')?.addEventListener('click', async () => {
  const folder = await window.w2gp.selectFolder()
  if (!folder) return
  await window.w2gp.setDataDir(folder)
  loadPaths()
})

$('clearAppDataPath')?.addEventListener('click', async () => {
  await window.w2gp.resetDataDir()
  loadPaths(true)
})

let _modelCkpts = '', _modelLoras = '', _modelOutput = ''

function setModelPath(type, folder) {
  const elMap = { ckpts: 'installCkptsPath', loras: 'installLorasPath', output: 'installOutputPath' }
  const clearMap = { ckpts: 'clearCkptsPath', loras: 'clearLorasPath', output: 'clearOutputPath' }
  const el = $(elMap[type])
  const clearBtn = $(clearMap[type])
  if (!el) return
  if (folder) {
    el.textContent = folder; el.style.color = ''
    if (clearBtn) clearBtn.style.display = ''
    if (type === 'ckpts') _modelCkpts = folder
    else if (type === 'loras') _modelLoras = folder
    else _modelOutput = folder
  } else {
    el.textContent = '(default)'; el.style.color = 'var(--text-tertiary)'
    if (clearBtn) clearBtn.style.display = 'none'
    if (type === 'ckpts') _modelCkpts = ''
    else if (type === 'loras') _modelLoras = ''
    else _modelOutput = ''
  }
}

async function browseModelFolder(type) {
  const folder = await window.w2gp.selectFolder()
  if (!folder) return
  setModelPath(type, folder)
  const cfg = await window.w2gp.configLoad()
  if (type === 'ckpts') cfg.modelCkptsPath = folder
  else if (type === 'loras') cfg.modelLorasPath = folder
  else cfg.modelOutputPath = folder
  await window.w2gp.configSave(cfg)
}

$('browseCkptsPath')?.addEventListener('click', () => browseModelFolder('ckpts'))
$('browseLorasPath')?.addEventListener('click', () => browseModelFolder('loras'))
$('clearCkptsPath')?.addEventListener('click', async () => {
  const p = await window.w2gp.getInstallPaths()
  const def = p?.appData ? p.appData + '\\ckpt' : '(default)'
  setModelPath('ckpts', '')
  const el = $('installCkptsPath')
  if (el) { el.textContent = def; el.style.color = 'var(--text-tertiary)' }
  const cfg = await window.w2gp.configLoad()
  delete cfg.modelCkptsPath
  await window.w2gp.configSave(cfg)
})
$('clearLorasPath')?.addEventListener('click', async () => {
  const p = await window.w2gp.getInstallPaths()
  const def = p?.appData ? p.appData + '\\lora' : '(default)'
  setModelPath('loras', '')
  const el = $('installLorasPath')
  if (el) { el.textContent = def; el.style.color = 'var(--text-tertiary)' }
  const cfg = await window.w2gp.configLoad()
  delete cfg.modelLorasPath
  await window.w2gp.configSave(cfg)
})
$('browseOutputPath')?.addEventListener('click', () => browseModelFolder('output'))
$('clearOutputPath')?.addEventListener('click', async () => {
  const p = await window.w2gp.getInstallPaths()
  const def = p?.appData ? p.appData + '\\outputs' : '(default)'
  setModelPath('output', '')
  const el = $('installOutputPath')
  if (el) { el.textContent = def; el.style.color = 'var(--text-tertiary)' }
  const cfg = await window.w2gp.configLoad()
  delete cfg.modelOutputPath
  await window.w2gp.configSave(cfg)
})

async function startInstall(){
  // Helper to show prereq help card
  function showPrereqHelp(title, text, url, tool) {
    $('prereqHelp').classList.remove('hidden')
    $('prereqTitle').textContent = title
    $('prereqText').innerHTML = text
    $('prereqDownloadBtn').onclick = async function() {
      this.disabled = true; this.textContent = 'Installing...'
      appendLog('[*] Installing ' + tool + '...')
      var r = await window.w2gp.installPrerequisite(tool)
      this.disabled = false; this.textContent = 'Download & Install'
      if (r && r.success) { showToast('✓ ' + tool + ' installed. Please restart the launcher.') }
      else showToast('✗ Install failed: ' + (r?.error || 'unknown'))
    }
    $('prereqManualBtn').onclick = function() { window.w2gp.openExternal(url) }
    $('installStartBtn').classList.remove('hidden')
    $('envTypeSelect').classList.remove('disabled')
    document.querySelectorAll('.env-type-btn').forEach(b => b.disabled = false)
  }

  // Check prerequisites
  var hasGit = await window.w2gp.checkCommand('git')
  if (!hasGit) { appendLog('[!] Git not found — showing install help'); showPrereqHelp('Git not found', 'Git is required to clone the Wan2GP repository. Click Download to install it silently, or use the manual button.', 'https://git-scm.com/downloads', 'git'); return }
  if (selectedEnvType === 'venv') {
    var hasPy = await window.w2gp.checkCommand('python')
    if (!hasPy) { appendLog('[!] Python not found — showing install help'); showPrereqHelp('Python not found', 'Python 3.10 or 3.11 is required for venv installs. Click Download to install Python 3.11 silently, or select uv/conda above.', 'https://www.python.org/downloads/', 'python'); return }
  }
  if (selectedEnvType === 'uv') {
    var hasUv = await window.w2gp.checkCommand('uv')
    if (!hasUv) { appendLog('[!] uv not found — showing install help'); showPrereqHelp('uv not found', 'uv is required for uv installs. Click Download to install it via PowerShell, or select venv/conda above.', 'https://docs.astral.sh/uv/#installation', 'uv'); return }
  }
  if (selectedEnvType === 'conda') {
    var hasConda = await window.w2gp.checkCommand('conda')
    if (!hasConda) { appendLog('[!] Conda not found — showing install help'); showPrereqHelp('Conda not found', 'Miniconda is required for conda installs. Click Download to install it silently, or select venv/uv above.', 'https://docs.anaconda.com/miniconda/', 'conda'); return }
  }
  show('installer'); resetTasks()
  $('envTypeSelect').classList.add('disabled')
  document.querySelectorAll('.env-type-btn').forEach(b => b.disabled = true)
  $('installStartBtn').classList.add('hidden')
  $('installSubtitle').textContent='Setting up Wan2GP...'
  const installed = await window.w2gp.checkInstalled()
  if(installed.repo) {
    $('reinstallChoice').classList.remove('hidden')
    $('installSubtitle').textContent='Wan2GP is already installed.'
    return
  }
  doInstall(installed)
}

async function doInstall(installed, mode) {
  $('reinstallChoice').classList.add('hidden')
  if (mode === 'skip') {
    show('dashboard'); refreshDashboard()
    return
  }
  let skipClone = false
  if (mode === 'reinstall') {
    $('installSubtitle').textContent='Removing existing installation...'
    appendLog('[*] Removing existing Wan2GP installation...')
    await window.w2gp.reinstall()
  } else {
    $('installSubtitle').textContent='Update instead of fresh install...'
    skipClone = true
  }
  if(!skipClone) { taskStart('clone'); prevPhaseId = 'clone'; appendLog('[*] Cloning Wan2GP repository...') } else { taskComplete('clone'); prevPhaseId = 'clone' }
  try {
    appendLog('[*] Installing Wan2GP (environment: ' + selectedEnvType + ')...')
    await window.w2gp.install(selectedEnvType)
    try {
      const gpu = await window.w2gp.detectGpu(); const hw = await window.w2gp.detectHardware()
      const name=(gpu.name||hw.gpu||'').toUpperCase(); const vendor=gpu.vendor||''
      let profile='STANDARD'
      if(vendor==='APPLE') profile='MPS'
      else if(name.match(/RTX 50|50\d0/)) profile='RTX 50'
      else if(name.match(/RTX 40|40\d0/)) profile='RTX 40'
      else if(name.match(/RTX 30|30\d0/)) profile='RTX 30'
      else if(name.match(/RTX 20|20\d0/)) profile='RTX 20'
      else if(name.includes('GTX')||name.includes('10')) profile='GTX 10'
      else if(vendor==='AMD') profile='AMD'
      $('installProfile').textContent=profile; $('installProfileRow').style.display='flex'
    } catch {}
    try {
      const modelCfg = {}
      if (_modelCkpts) modelCfg.checkpointsPaths = [_modelCkpts, '.']
      if (_modelLoras) modelCfg.lorasRoot = _modelLoras
      if (_modelOutput) modelCfg.savePath = _modelOutput
      await window.w2gp.writeWgpConfig(modelCfg)
      appendLog(`[*] wgp_config.json updated: ckpts=${_modelCkpts || '(default)'}, loras=${_modelLoras || '(default)'}`)
    } catch (e) {
      appendLog(`[!] Failed to write model config: ${e.message}`)
    }
    taskComplete('done'); $('installSubtitle').textContent='Wan2GP is ready!'; appendLog('[*] Installation complete!')
    setTimeout(()=>{ show('dashboard'); refreshDashboard(); startMetricsPolling() }, 1200)
  } catch(e){ taskComplete('done',true); $('installSubtitle').textContent='Installation failed'; appendLog(`[ERROR] ${e.message}`) }
}

$('settingsOverlay').addEventListener('click', closeSettings)

// ── Dashboard ──
async function refreshDashboard(){
  const status = await window.w2gp.getStatus()
  if(status.error||!status.env){
    $('envName').textContent='No active environment'
    $('envNameHint')?.classList.remove('hidden')
    document.querySelectorAll('.pkg-install-btn, .spec-latest, .spec-update-btn').forEach(function(el) { el.remove() })
    ;['specPython','specTorch','specCuda','specTriton','specSage','specFlash','specDiffusers','specTransformers','specGradio','specAccelerate','specOnnx','specOpencv','specPeft','specHfhub','specBits','specNumpy','specTokenizers'].forEach(id=>{ const el=$(id); if(el) el.textContent='—' })
    ;['dotPython','dotTorch','dotCuda','dotTriton','dotSage','dotFlash','dotDiffusers','dotTransformers','dotGradio','dotAccelerate','dotOnnx','dotOpencv','dotPeft','dotHfhub','dotBits','dotNumpy','dotTokenizers'].forEach(id=>{ const el=$(id); if(el) el.classList.remove('installed') })
  } else {
    $('envName').textContent=status.env.name; $('envType').textContent=status.env.type
    $('envNameHint')?.classList.add('hidden')
    // Clear old update/install buttons before re-creating
    document.querySelectorAll('.spec-latest, .spec-update-btn, .pkg-install-btn').forEach(function(el) { el.remove() })

    function setSpec(specId, dotId, val, pkgName) {
      const el=$(specId); if(el) el.textContent=val||'—'
      const dot=$(dotId); if(dot){ if(val) dot.classList.add('installed'); else dot.classList.remove('installed') }
      // Show install button if package is missing and we know its pip name
      if (!val && pkgName && el) {
        var parent = el.closest('.spec-row')
        if (parent) {
          var oldBtn = parent.querySelector('.pkg-install-btn')
          if (oldBtn) oldBtn.remove()
          var btn = document.createElement('button')
          btn.className = 'pkg-install-btn'
          btn.textContent = '+'
          btn.title = 'Install ' + pkgName
          btn.addEventListener('click', async function(ev) {
            ev.stopPropagation()
            this.disabled = true; this.textContent = '...'
            var res = await window.w2gp.installPackage(pkgName)
            if (res && res.success) {
              this.textContent = '✓'; this.classList.add('done')
              setTimeout(refreshDashboard, 2000)
            } else {
              this.textContent = '+'; this.disabled = false
              showToast('✗ Install failed: ' + (res && res.error ? res.error : 'unknown'))
            }
          })
          el.after(btn)
        }
      }
    }
    setSpec('specPython','dotPython', status.versions?.python)
    setSpec('specTorch','dotTorch', status.versions?.torch)
    const m=(status.versions?.torch||'').match(/cu(\d+)/)
    setSpec('specCuda','dotCuda', m ? `CUDA ${m[1]}` : null)
    setSpec('specTriton','dotTriton', status.versions?.triton, 'triton')
    setSpec('specSage','dotSage', status.versions?.sageattention||status.versions?.spas_sage_attn, 'spas_sage_attn')
    setSpec('specFlash','dotFlash', status.versions?.flash_attn, 'flash-attn')
    setSpec('specDiffusers','dotDiffusers', status.versions?.diffusers)
    setSpec('specTransformers','dotTransformers', status.versions?.transformers)
    setSpec('specGradio','dotGradio', status.versions?.gradio)
    setSpec('specAccelerate','dotAccelerate', status.versions?.accelerate)
    setSpec('specOnnx','dotOnnx', status.versions?.onnxruntime)
    setSpec('specOpencv','dotOpencv', status.versions?.opencv)
    setSpec('specPeft','dotPeft', status.versions?.peft)
    setSpec('specHfhub','dotHfhub', status.versions?.huggingface_hub)
    setSpec('specBits','dotBits', status.versions?.bitsandbytes, 'bitsandbytes')
    setSpec('specNumpy','dotNumpy', status.versions?.numpy)
    setSpec('specTokenizers','dotTokenizers', status.versions?.tokenizers)
  }
  const envs = await window.w2gp.manageList()
  const list=$('envList'); list.innerHTML=''
  envs.forEach(e=>{
    const div=document.createElement('div')
    div.className='env-list-item'+(e.active?' active':'')
    div.innerHTML=`<span class="env-dot"></span><span class="env-list-name">${e.name}</span><span style="font-size:0.65rem;color:#666;flex-shrink:0">${e.type}</span>`
    if(!e.active) div.addEventListener('click',async()=>{ await window.w2gp.manageSetActive(e.name); refreshDashboard() })
    list.appendChild(div)
  })
  loadWangpChangelog()
  loadPaths()
  loadDesktopInfo()
  loadModelPaths()
  document.querySelectorAll('.env-detail .spec-row').forEach(function(r) { r.classList.remove('has-update','up-to-date') })
  $('checkPkgUpdatesBtn').textContent = '↻ Check Updates'
  $('checkPkgUpdatesBtn').disabled = false
  refreshEnvUnlink()
  // Enable/disable no-GPU button based on Chrome availability
  ;(async () => {
    const available = await window.w2gp.chromeAvailable()
    const btn = $('browserNoGpuBtn')
    const hint = $('noGpuHint')
    if (btn) btn.disabled = !available
    if (hint) hint.style.display = available ? 'none' : 'block'
  })()
}

// ── Env unlink button visibility ──
function refreshEnvUnlink() {
  var btn = $('envUnlinkBtn')
  var restoreBtn = $('envRestoreBtn')
  var nameEl = $('envName')
  if (btn && nameEl) {
    var name = nameEl.textContent
    if (name && name !== '—' && name !== 'No active environment') {
      btn.style.display = ''; if (restoreBtn) restoreBtn.style.display = ''
      btn.onclick = async () => {
          if (!confirm('Uninstall environment "' + name + '"?')) return
          btn.disabled = true; btn.textContent = '...'
          appendLog('[*] Uninstalling environment ' + name + '...')
          var r = await window.w2gp.uninstallEnv(name)
          btn.disabled = false; btn.textContent = 'unlink'
          if (r && r.success) { appendLog('[*] Environment ' + name + ' uninstalled.'); refreshDashboard() }
          else showToast(r?.error || 'Failed')
        }
      } else {
        btn.style.display = 'none'; if (restoreBtn) restoreBtn.style.display = 'none'
      }
    }
    // Restore button handler
    if (restoreBtn) {
      restoreBtn.onclick = async () => {
        if (!confirm('Reinstall all packages from requirements.txt? This will restore pinned versions.')) return
        restoreBtn.disabled = true; restoreBtn.textContent = '...'
        appendLog('[*] Restoring packages from requirements.txt...')
        var r = await window.w2gp.restoreRequirements()
        restoreBtn.disabled = false; restoreBtn.textContent = 'restore'
        if (r && r.success) { appendLog('[*] Requirements restored.'); setTimeout(refreshDashboard, 2000) }
        else showToast(r?.error || 'Failed')
      }
    }
  }

const _labelToKey = {'Python':'python','Torch':'torch','CUDA':'cuda','Triton':'triton','Sage Attn':'sageattention','Flash Attn':'flash_attn','Diffusers':'diffusers','Transformers':'transformers','Gradio':'gradio','Accelerate':'accelerate','onnxruntime':'onnxruntime','OpenCV':'opencv','PEFT':'peft','hf_hub':'huggingface_hub'}

$('checkPkgUpdatesBtn').addEventListener('click', async function() {
  this.textContent = 'Checking...'
  this.classList.add('check-updates-loading')
  this.disabled = true
  const versions = {}
  document.querySelectorAll('.env-detail .spec-row').forEach(function(row) {
    const labelEl = row.querySelector('.spec-label')
    const valEl = row.querySelector('.spec-value')
    if (!labelEl || !valEl) return
    const label = labelEl.textContent.trim()
    const key = _labelToKey[label]
    if (!key) return
    const val = valEl.textContent.trim()
    if (val && val !== '—') versions[key] = val
  })
  if (Object.keys(versions).length === 0) {
    this.textContent = '↻ Check Updates'
    this.classList.remove('check-updates-loading')
    this.disabled = false
    return
  }
  var results = await window.w2gp.checkPackageUpdates(versions)
  this.textContent = '↻ Check Updates'
  this.classList.remove('check-updates-loading')
  this.disabled = false
  if (!results || !results.length) { showToast('No update info available'); return }
  let updateCount = 0
  results.forEach(function(r) {
    let row = document.querySelector('.env-detail .spec-row[data-pkg="' + r.name + '"]')
    if (!row) {
      const revMap = {}
      for (const k in _labelToKey) revMap[_labelToKey[k]] = k
      const label = revMap[r.name]
      if (!label) return
      const rows = document.querySelectorAll('.env-detail .spec-row')
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].querySelector('.spec-label') && rows[i].querySelector('.spec-label').textContent.trim() === label) {
          row = rows[i]
          row.setAttribute('data-pkg', r.name)
          break
        }
      }
    }
    if (!row) return
    const valEl = row.querySelector('.spec-value')
    if (!valEl) return
    const oldLatest = row.querySelector('.spec-latest')
    if (oldLatest) oldLatest.remove()
    const oldBtn = row.querySelector('.spec-update-btn')
    if (oldBtn) oldBtn.remove()
    if (!r.latest) return
    const latestSpan = document.createElement('span')
    latestSpan.className = 'spec-latest'
    latestSpan.textContent = '→ ' + r.latest
    valEl.after(latestSpan)
    if (r.installed && r.installed !== r.latest) {
      row.classList.add('has-update')
      row.classList.remove('up-to-date')
      updateCount++
      const dot = row.querySelector('.spec-dot')
      if (dot) { dot.classList.remove('installed','error','installing'); dot.classList.add('has-update') }
      const upBtn = document.createElement('button')
      upBtn.className = 'spec-update-btn'
      upBtn.textContent = '↑'
      upBtn.title = 'Upgrade ' + r.name + ' to ' + r.latest
      upBtn.addEventListener('click', async function(ev) {
        ev.stopPropagation()
        this.disabled = true; this.textContent = '...'
        if (dot) { dot.classList.remove('has-update','installed','error'); dot.classList.add('installing') }
        var res = await window.w2gp.upgradePackage(r.name)
        if (res && res.success) {
          this.textContent = '✓'; this.classList.add('done')
          if (dot) { dot.classList.remove('installing','has-update','error'); dot.classList.add('installed') }
          showToast('✓ ' + r.name + ' upgraded to ' + r.latest)
        } else {
          this.textContent = '↑'; this.disabled = false
          if (dot) { dot.classList.remove('installing','has-update','installed'); dot.classList.add('error') }
          showToast('✗ Upgrade failed: ' + (res && res.error ? res.error : 'unknown error'))
        }
      })
      latestSpan.after(upBtn)
    } else {
      row.classList.add('up-to-date')
      row.classList.remove('has-update')
    }
  })
  showToast(updateCount > 0 ? updateCount + ' updates available' : 'All packages up to date')
})

async function loadModelPaths() {
  const paths = await window.w2gp.getModelPaths()
  $('dashCkptPath').textContent = breakPath(paths?.checkpoints) || '(default)'; $('dashCkptPath').title = paths?.checkpoints || ''
  $('dashLoraPath').textContent = breakPath(paths?.loras) || '(default)'; $('dashLoraPath').title = paths?.loras || ''
  $('dashOutputPath').textContent = breakPath(paths?.output) || '(default)'; $('dashOutputPath').title = paths?.output || ''
}

$('dashBrowseCkpt').addEventListener('click', async () => {
  const dir = await window.w2gp.selectFolder()
  if (!dir) return
  $('dashCkptPath').textContent = breakPath(dir); $('dashCkptPath').title = dir
  await window.w2gp.writeWgpConfig({ checkpointsPaths: [dir, '.'] })
})
$('dashBrowseLora').addEventListener('click', async () => {
  const dir = await window.w2gp.selectFolder()
  if (!dir) return
  $('dashLoraPath').textContent = breakPath(dir); $('dashLoraPath').title = dir
  await window.w2gp.writeWgpConfig({ lorasRoot: dir })
})
$('dashBrowseOutput').addEventListener('click', async () => {
  const dir = await window.w2gp.selectFolder()
  if (!dir) return
  $('dashOutputPath').textContent = breakPath(dir); $('dashOutputPath').title = dir
  await window.w2gp.writeWgpConfig({ savePath: dir })
})

async function loadDesktopInfo() {
  const info = await window.w2gp.getDesktopGitInfo()
  const hashEl = $('desktopLocalCommit')
  const msgEl = $('desktopCommitMsg')
  if (info && info.hash) {
    if (hashEl) hashEl.textContent = info.hash
    if (msgEl) msgEl.textContent = info.message || ''
  } else {
    if (hashEl) hashEl.textContent = '(not in git)'
    if (msgEl) msgEl.textContent = ''
  }
  window.w2gp.getDesktopVersion().then(function(v) {
    var verEl = $('desktopVersionNum')
    if (verEl && v) verEl.textContent = v
  })
}

$('desktopRepoLink').addEventListener('click', (e) => {
  e.preventDefault()
  window.w2gp.openExternal('https://github.com/GKartist75/wan2gp-desktop')
})
$('ytLink').addEventListener('click', (e) => {
  e.preventDefault()
  window.w2gp.openExternal('https://www.youtube.com/@GK-Artist')
})

async function loadPaths(skipModelPaths) {
  const p = await window.w2gp.getInstallPaths()
  if (!p) return
  const set = (id, val) => { const e = $(id); if (e) { e.textContent = breakPath(val) || '—'; e.title = val || '' } }
  set('pathAppData', p.appData)
  set('installAppDataPath', p.appData + '\\Wan2GP')
  window.w2gp.getDiskSpace().then(function(d) {
    if (!d) return;
    var freeGb = (d.free / 1073741824).toFixed(1);
    $('pathFreeSpace').textContent = freeGb + ' GB free';
  });
  if (!skipModelPaths && p.appData) {
    if (!_modelCkpts) setModelPath('ckpts', p.appData + '\\ckpt')
    if (!_modelLoras) setModelPath('loras', p.appData + '\\lora')
    if (!_modelOutput) setModelPath('output', p.appData + '\\outputs')
  }
}

$('openAppDataBtn')?.addEventListener('click', function() {
  window.w2gp.getInstallPaths().then(function(p) { if (p) window.w2gp.openFolder(p.appData); });
});

async function loadWangpChangelog() {
  const localEl = $('localCommit')
  const listEl = $('updatesList')
  const verEl = $('wangpVersion')
  if (!listEl) return

  const local = await window.w2gp.getWangpLocalVersion()
  if (local && localEl) localEl.textContent = local.hash.substring(0, 7)

  window.w2gp.getWangpVersion().then(v => { if (v && verEl) verEl.textContent = v })

  const upstream = await window.w2gp.getWangpUpstreamInfo()
  if (!upstream || !upstream.commits) {
    listEl.innerHTML = '<div class="changelog-error">Could not fetch updates</div>'
    // Clear any stale green dot from a previous check — don't leave it dangling
    const updateBtn = $('updateBtn')
    if (updateBtn) {
      updateBtn.classList.remove('has-update')
      updateBtn.querySelector('.update-dot')?.remove()
    }
    return
  }

  const updateBtn = $('updateBtn')
  const hasUpdate = local && upstream.commits[0]?.hash !== local.hash
  if (hasUpdate) {
    updateBtn?.classList.add('has-update')
    if (!updateBtn?.querySelector('.update-dot')) {
      const dot = document.createElement('span')
      dot.className = 'update-dot'
      updateBtn.appendChild(dot)
    }
  } else {
    updateBtn?.classList.remove('has-update')
    updateBtn?.querySelector('.update-dot')?.remove()
  }

  listEl.innerHTML = upstream.commits.map(c =>
    `<div class="cl-item">
      <span class="cl-date">${fmtDate(c.date)}</span>
      <span class="cl-msg">${c.message}</span>
      <span class="cl-author">${c.author}</span>
    </div>`
  ).join('')
}

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  const days = (Date.now() - d) / 864e5
  if (days < 1) return 'today'
  if (days < 2) return 'yesterday'
  return days < 7 ? `${Math.floor(days)}d ago` : d.toLocaleDateString('en-US', {month:'short',day:'numeric'})
}

document.addEventListener('DOMContentLoaded', () => {
  $('changelogLink')?.addEventListener('click', (e) => {
    e.preventDefault()
    window.w2gp.openExternal('https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/CHANGELOG.md')
  })
  $('hfModelsLink')?.addEventListener('click', (e) => {
    e.preventDefault()
    window.w2gp.openExternal('https://huggingface.co/DeepBeepMeep')
  })
})

// ── Launch in Browser (uses the user's chosen default browser) ──
$('browserBtn').addEventListener('click', async () => {
  // Already running in browser mode → just re-open the URL (don't re-spawn the server).
  if (browserRunning && currentUrl) { await window.w2gp.launchBrowser(currentUrl); return }
  const btn = $('browserBtn')
  btn.disabled = true; btn.textContent = 'Starting...'
  $('launchInfo').classList.remove('hidden')
  try {
    const result = await window.w2gp.launch()
    currentUrl = result.url
    await window.w2gp.launchBrowser(result.url)
    browserRunning = true
    serverMode = 'browser'
    showBrowserRunningUI()
    btn.textContent = 'Open Wan2GP in Browser'
    $('browserNoGpuBtn').style.display = 'none'
  } catch(e){
    appendLog(`[LAUNCH ERROR] ${e.message}`)
  } finally {
    $('launchInfo').classList.add('hidden')
    $('browserBtn').disabled = false
    if (!browserRunning) $('browserBtn').textContent = 'Launch Wan2GP in Browser'
  }
})

// ── Launch in Browser with GPU disabled (start-chrome-no-gpu script) ──
$('browserNoGpuBtn').addEventListener('click', async () => {
  if (browserRunning && currentUrl) { await window.w2gp.launchBrowser(currentUrl); return }
  const btn = $('browserNoGpuBtn')
  btn.disabled = true; btn.textContent = 'Starting...'
  $('launchInfo').classList.remove('hidden')
  try {
    const result = await window.w2gp.launch()
    currentUrl = result.url
    const r = await window.w2gp.launchBrowserNoGpu(result.url)
    if (!r || !r.success) throw new Error(r && r.error ? r.error : 'no-GPU launch failed')
    appendLog(`[*] Launched in browser with GPU disabled.`)
    browserRunning = true
    serverMode = 'browser'
    showBrowserRunningUI()
    $('browserBtn').textContent = 'Open Wan2GP in Browser'
    btn.textContent = 'Open in Chrome (no GPU)'
    $('browserBtn').style.display = 'none'
    $('launchInfo').classList.add('hidden')
  } catch(e){
    appendLog(`[LAUNCH ERROR] ${e.message}`)
    $('launchInfo').classList.add('hidden')
  } finally {
    $('browserNoGpuBtn').disabled = false
    if (!browserRunning) $('browserNoGpuBtn').textContent = 'Launch in Chrome (no GPU script)'
  }
})

// ── Launch in a real terminal (run.bat style: server runs in a cmd window) ──
$('termBtn').addEventListener('click', async () => {
  if (browserRunning && currentUrl) { await window.w2gp.launchBrowser(currentUrl); return }
  const btn = $('termBtn')
  btn.disabled = true; btn.textContent = 'Starting...'
  $('launchInfo').classList.remove('hidden')
  try {
    const result = await window.w2gp.launch('terminal')
    currentUrl = result.url
    // The generated .bat opens localhost itself (mirrors the desktop shortcut), so we don't double-open.
    browserRunning = true
    serverMode = 'browser'   // UI treatment identical to browser mode (running + Stop + re-open)
    showBrowserRunningUI()
    btn.textContent = 'Open Wan2GP in Browser'
    $('browserBtn').style.display = 'none'
    $('browserNoGpuBtn').style.display = 'none'
    $('launchInfo').classList.add('hidden')
  } catch(e){
    appendLog(`[LAUNCH ERROR] ${e.message}`)
    $('launchInfo').classList.add('hidden')
  } finally {
    $('termBtn').disabled = false
    if (!browserRunning) $('termBtn').textContent = 'Launch in External Terminal'
  }
})

let currentUrl = null
// Tracks which launcher path started the server so we can reset the right UI on exit.
let serverMode = null      // 'app' | 'browser' | null
let browserRunning = false // browser-mode server currently up (button acts as re-open)

// ── Launch in App (BrowserView — renders Gradio reliably on Electron 40; intercepts
//     /manifest.json to dodge gradio#11553 blank-page bug) ──
$('appBtn').addEventListener('click', async () => {
  $('appBtn').disabled = true; $('appBtn').textContent = 'Starting...'
  $('launchInfo').classList.remove('hidden')

  try {
    const result = await window.w2gp.launchWebview()
    currentUrl = result.url
    const created = await window.w2gp.createBrowserView(result.url)
    if (!created || created.error) throw new Error(created && created.error ? created.error : 'failed to create embed')
    $('dashBody').style.display = 'none'
    $('webviewContainer').classList.remove('hidden')
    $('launchInfo').classList.add('hidden')
    showWebviewUI()
    updateLed('running')
    updateFtStatus('running')
    serverMode = 'app'
    if (browserRunning) resetBrowserLaunchUI()
    const overlay = $('launchOverlay')
    if (overlay) {
      overlay.classList.remove('hidden')
      setTimeout(() => overlay.classList.add('hidden'), 30000)
    }
    // Open the floating terminal per the saved default dock (or stay minimised)
    const cfg = await window.w2gp.configLoad()
    const dock = cfg.termDockDefault || 'bottom'
    if (dock === 'minimised') {
      if (!$('floatingTerminal').classList.contains('hidden')) closeFloatingTerm()
    } else {
      if ($('floatingTerminal').classList.contains('hidden')) toggleFloatingTerm()
      setFtDock(dock)
    }
  } catch(e){
    // Never leave the dashboard hidden behind a blank embed
    $('dashBody').style.display = ''
    $('webviewContainer').classList.add('hidden')
    hideWebviewUI()
    appendLog(`[LAUNCH ERROR] ${e.message}`)
  } finally {
    $('appBtn').disabled = false; $('appBtn').textContent = 'Launch Wan2GP in Desktop'
  }
})

function showWebviewUI() {
  $('wvControls').style.display = 'flex'
  $('runningLed').style.display = 'inline-flex'
  $('stopWangpBtn').style.display = ''
}

function hideWebviewUI() {
  $('wvControls').style.display = 'none'
  $('runningLed').style.display = 'none'
}

async function closeWebview() {
  // Close the terminal first — hideTerminal() re-attaches the Wan2GP BrowserView (correct for a
  // normal terminal toggle-off). Destroy the view LAST so it can't be left compositing on top of
  // the dashboard when we go back to menu.
  if (!$('floatingTerminal').classList.contains('hidden')) closeFloatingTerm()
  await window.w2gp.destroyBrowserView()
  $('webviewContainer').classList.add('hidden')
  $('dashBody').style.display = ''
  hideWebviewUI()
  appendLog('[*] Webview closed. Server still running.')
}

$('backToDashboardBtn').addEventListener('click', closeWebview)

// ── BrowserView navigation / zoom (relayed via main process) ──
function updateNavButtons(state) {
  if ($('wvBackBtn')) $('wvBackBtn').disabled = !state.canGoBack
  if ($('wvFwdBtn')) $('wvFwdBtn').disabled = !state.canGoForward
}

$('wvBackBtn').addEventListener('click', () => window.w2gp.bvNavigate('back'))
$('wvFwdBtn').addEventListener('click', () => window.w2gp.bvNavigate('forward'))
$('wvReloadBtn').addEventListener('click', () => window.w2gp.bvNavigate('reload'))
// Listen for live nav state updates (pushed from main process after each navigation)
window.w2gp.onBvNavState(updateNavButtons)
$('zoomSlider').addEventListener('input', () => {
  const pct = parseInt($('zoomSlider').value)
  $('zoomLabel').textContent = pct + '%'
  window.w2gp.bvSetZoom(pct / 100)
})

$('popoutBtn')?.addEventListener('click', () => {
  if (currentUrl) window.w2gp.popoutWebview(currentUrl)
})

// ── Running LED ──
function updateLed(state) {
  const led = $('runningLed')
  const dot = $('ledDot')
  const txt = $('ledText')
  if (!led || !dot || !txt) return
  led.style.display = 'inline-flex'
  if (state === 'running') {
    dot.className = 'led-dot led-running'
    txt.textContent = 'Running'
  } else {
    dot.className = 'led-dot led-stopped'
    txt.textContent = 'Stopped'
  }
}

// ── Browser-mode running UI (server runs in user's browser; dashboard stays visible) ──
function showBrowserRunningUI() {
  updateLed('running')
  $('stopWangpBtn').style.display = ''
}
function hideBrowserRunningUI() {
  $('runningLed').style.display = 'none'
  $('stopWangpBtn').style.display = 'none'
}
// Restore the dashboard launch buttons to their default (pre-launch) state.
function resetBrowserLaunchUI() {
  browserRunning = false
  serverMode = null
  $('browserBtn').textContent = 'Launch Wan2GP in Browser'
  $('browserBtn').style.display = ''
  $('browserBtn').disabled = false
  $('browserNoGpuBtn').textContent = 'Launch in Chrome (no GPU script)'
  $('browserNoGpuBtn').style.display = ''
  $('browserNoGpuBtn').disabled = false
  $('termBtn').textContent = 'Launch in External Terminal'
  $('termBtn').style.display = ''
  $('termBtn').disabled = false
}

// ── Stop Wan2GP button ──
$('stopWangpBtn').addEventListener('click', async () => {
  $('stopWangpBtn').style.display = 'none'
  appendLog('[*] Stopping Wan2GP server...')
  await window.w2gp.stopWangp()
  updateLed('stopped')
  updateFtStatus('stopped')
})

// ── Reset UI when server exits (manual stop or crash) ──
window.w2gp.onWangpExit(c => {
  appendLog(`[!] Wan2GP process exited (code ${c})`)
  if (serverMode === 'app') {
    if (!$('webviewContainer').classList.contains('hidden')) closeWebview()
  } else if (serverMode === 'browser') {
    hideBrowserRunningUI()
    resetBrowserLaunchUI()
  }
  $('stopWangpBtn').style.display = 'none'
  updateLed('stopped')
  updateFtStatus('stopped')
})

// ── Floating Terminal (Desktop/webview mode only) ──
function updateFtStatus(state) {
  const st = $('ftServerStatus')
  const dot = $('ftStatusDot')
  const txt = $('ftStatusText')
  if (!st || !dot || !txt) return
  st.style.display = ''
  if (state === 'running') {
    dot.className = 'ft-status-dot running'
    txt.textContent = 'Running'
  } else {
    dot.className = 'ft-status-dot stopped'
    txt.textContent = 'Stopped'
  }
}

// ── Event Wiring: Dashboard ──
$('updateBtn').addEventListener('click',async()=>{
  $('updateBtn').disabled=true; $('updateBtn').textContent='Working...'
  try{ await window.w2gp.update(); appendLog('[*] Wan2GP update complete'); refreshDashboard() }catch(e){ appendLog('[!] Update failed: '+e.message); alert('Update: '+e.message) }
  $('updateBtn').disabled=false; $('updateBtn').textContent='↻ Update Wan2GP (DeepBeepMeep)'
})
document.querySelectorAll('.theme-toggle').forEach(btn => btn.addEventListener('click', toggleTheme))

function switchSettingsTab(tabName) {
  document.querySelectorAll('.settings-tab').forEach(function(t) { t.classList.remove('active') })
  document.querySelectorAll('.settings-tab-content').forEach(function(c) { c.classList.remove('active') })
  var tab = document.querySelector('.settings-tab[data-tab="' + tabName + '"]')
  if (tab) tab.classList.add('active')
  var tabContent = document.querySelector('.settings-tab-content[data-tab="' + tabName + '"]')
  if (tabContent) tabContent.classList.add('active')
}

document.querySelectorAll('.settings-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    switchSettingsTab(tab.dataset.tab)
    tab.closest('.settings-tabs')?.querySelector('.settings-tabs-inner')?.scrollTo({ left: tab.offsetLeft - 80, behavior: 'smooth' })
  })
})
$('settingsBtn').addEventListener('click',()=>{ openSettings() })
$('autoTuneDashBtn').addEventListener('click',()=>{ openSettings(); switchSettingsTab('autotune') })
$('taskMgrBtn').addEventListener('click',()=>{ window.w2gp.openTaskManager() })

// ── Quick pip install ──
$('pipInstallBtn').addEventListener('click', async () => {
  const input = $('pipInput')
  const pkg = (input?.value || '').trim()
  if (!pkg) return
  input.disabled = true; $('pipInstallBtn').disabled = true; $('pipInstallBtn').textContent = 'installing...'
  const r = await window.w2gp.installPackage(pkg)
  input.disabled = false; $('pipInstallBtn').disabled = false; $('pipInstallBtn').textContent = 'pip install'
  if (r && r.success) {
    input.value = ''
    showToast('✓ ' + pkg + ' installed')
    refreshDashboard()
  } else {
    showToast('✗ ' + (r && r.error ? r.error : 'install failed'))
  }
})
$('pipInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('pipInstallBtn').click() })

$('desktopShortcutBtn').addEventListener('click', async function() {
  this.disabled = true; this.textContent = 'Creating...'
  const r = await window.w2gp.createDesktopShortcut()
  this.disabled = false; this.textContent = 'Create Desktop Shortcut'
  if (r && r.success) {
    showToast('✓ Shortcut created on desktop: Launch Wan2GP.bat')
  } else {
    showToast('✗ ' + (r && r.error ? r.error : 'Failed to create shortcut'))
  }
})

// ── Floating Terminal events ──
$('ftToggleBtn')?.addEventListener('click', toggleFloatingTerm)
$('ftCloseBtn')?.addEventListener('click', closeFloatingTerm)
// Dock buttons (always visible)
document.querySelectorAll('.dock-btn').forEach(btn => {
  btn.addEventListener('click', () => setFtDock(btn.dataset.dock))
})
// Events coming from the floating-terminal overlay (its own BrowserView, used for 'floating' dock)
window.w2gp.onTermDockChanged(dock => {
  const ft = $('floatingTerminal')
  ft.className = 'floating-term dock-' + dock + (ft.classList.contains('hidden') ? ' hidden' : '')
  if (dock !== 'floating') ft.style.cssText = ''
  document.querySelectorAll('.dock-btn').forEach(b => b.classList.toggle('active', b.dataset.dock === dock))
  window.w2gp.bvSetDock(dock)
  if (_ftVisible) showTerminal()
})
window.w2gp.onTermClosed(() => {
  _ftVisible = false
  hideTerminal()
})
// Floating drag for dock-floating mode
let _fdrag = null
$('floatingTerminal').addEventListener('mousedown', (e) => {
  if (!$('floatingTerminal').classList.contains('dock-floating')) return
  if (e.target.closest('.term-btn-small, .dock-menu')) return
  const r = $('floatingTerminal').getBoundingClientRect()
  _fdrag = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height }
  document.addEventListener('mousemove', _fdragMove)
  document.addEventListener('mouseup', _fdragEnd)
})
function _fdragMove(e) {
  if (!_fdrag) return
  const p = $('floatingTerminal')
  let x = e.clientX - _fdrag.dx, y = e.clientY - _fdrag.dy
  x = Math.max(0, Math.min(x, window.innerWidth - _fdrag.w))
  y = Math.max(0, Math.min(y, window.innerHeight - 30))
  p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.right = 'auto'; p.style.bottom = 'auto'
}
function _fdragEnd() { _fdrag = null; document.removeEventListener('mousemove', _fdragMove); document.removeEventListener('mouseup', _fdragEnd) }
// Follow toggle
$('ftFollowBtn').addEventListener('click', () => {
  termFollow.ftTermBody = !termFollow.ftTermBody
  const b = $('ftFollowBtn'); b.classList.toggle('active')
  const ft = b.querySelector('.follow-text')
  if (ft) ft.textContent = termFollow.ftTermBody ? 'Follow' : 'Paused'
  if (termFollow.ftTermBody) { const e = $('ftTermBody'); if (e) setTimeout(() => e.scrollTop = e.scrollHeight, 10) }
})
// Keyboard shortcut: Ctrl+` toggles floating terminal
document.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
  if (e.ctrlKey && e.key === '`') { e.preventDefault(); toggleFloatingTerm() }
})

// ── Dashboard console follow ──
$('dashTermFollowBtn').addEventListener('click', () => {
  termFollow.termBody = !termFollow.termBody
  const b = $('dashTermFollowBtn'); b.classList.toggle('active')
  const ft = b.querySelector('.follow-text')
  if (ft) ft.textContent = termFollow.termBody ? 'Follow' : 'Paused'
  if (termFollow.termBody) { const e = $('termBody'); if (e) setTimeout(() => e.scrollTop = e.scrollHeight, 10) }
})
$('installFollowBtn').addEventListener('click',()=>{
  termFollow.installTermBody=!termFollow.installTermBody
  const b=$('installFollowBtn'); b.classList.toggle('active')
  const ft=b.querySelector('.follow-text')
  if(ft) ft.textContent=termFollow.installTermBody?'Follow':'Paused'
  if(termFollow.installTermBody){ const e=$('installTermBody'); if(e) setTimeout(()=>e.scrollTop=e.scrollHeight,10) }
})

// ── Floating terminal: search, export, resize ──
let _lastFilter = ''
$('logSearch')?.addEventListener('input', () => {
  const q = ($('logSearch')?.value || '').toLowerCase()
  if (q === _lastFilter) return; _lastFilter = q
  const ft = $('ftTermBody')
  if (ft) ft.textContent = (q ? logBuffer.filter(l => l.toLowerCase().includes(q)) : logBuffer).join('\n')
})
$('logExportBtn')?.addEventListener('click', () => {
  const blob = new Blob([logBuffer.join('\n')], { type: 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = 'wan2gp-console.log'; a.click()
})
// Resize handle
let _resize = null
$('ftResize').addEventListener('mousedown', (e) => {
  e.preventDefault()
  const ft = $('floatingTerminal')
  if (!ft.classList.contains('dock-bottom') && !ft.classList.contains('dock-top')) return
  _resize = { startY: e.clientY, startH: ft.offsetHeight, dock: ft.classList.contains('dock-top') ? 'top' : 'bottom' }
  document.addEventListener('mousemove', _resizeMove)
  document.addEventListener('mouseup', _resizeEnd)
})
function _resizeMove(e) {
  if (!_resize) return
  const dh = e.clientY - _resize.startY
  let h = _resize.dock === 'top' ? _resize.startH + dh : _resize.startH - dh
  h = Math.max(80, Math.min(h, window.innerHeight * 0.6))
  $('floatingTerminal').style.height = h + 'px'
}
function _resizeEnd() { _resize = null; document.removeEventListener('mousemove', _resizeMove); document.removeEventListener('mouseup', _resizeEnd) }

// ── Keyboard shortcuts ──
document.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
  // Ctrl+` toggles floating terminal
  if (e.ctrlKey && e.key === '`') { e.preventDefault(); toggleFloatingTerm(); return }
  // Escape closes the webview/BrowserView
  if (e.key === 'Escape' && $('dashBody').style.display === 'none') { closeWebview(); return }
  // Ctrl+W closes the webview/BrowserView
  if (e.ctrlKey && (e.key === 'w' || e.key === 'W') && $('dashBody').style.display === 'none') { e.preventDefault(); closeWebview() }
})

function showToast(msg) {
  const t = document.createElement('div')
  t.textContent = msg
  t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#333;color:#e8e6e1;padding:8px 16px;border-radius:6px;font-size:13px;z-index:9999;font-family:Geist Mono,monospace;transition:opacity 0.3s;max-width:90vw;text-align:center'
  document.body.appendChild(t)
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400) }, 2500)
}

$('updateCheckBtn').addEventListener('click', () => {
  window.w2gp.checkUpdate()
})
$('updateDownloadBtn').addEventListener('click', () => {
  window.w2gp.downloadUpdate()
})
$('updateInstallBtn').addEventListener('click', () => {
  window.w2gp.installUpdate()
})
$('updateDismissBtn').addEventListener('click', () => {
  $('updateBanner').classList.add('hidden')
})

// ── Settings ──
$('settingsBackBtn').addEventListener('click',closeSettings)
$('browserRefreshBtn')?.addEventListener('click', loadBrowserList)
document.querySelectorAll('input[name="termDock"]').forEach(r => {
  r.addEventListener('change', async () => {
    if (!r.checked) return
    const cfg = await window.w2gp.configLoad()
    cfg.termDockDefault = r.value
    await window.w2gp.configSave(cfg)
    appendLog(`[*] Floating terminal default set to: ${r.value}`)
  })
})

// F12 is built-in DevTools shortcut. The IPC handler in main.js is kept
// (it opens the BrowserView DevTools when embedded), just no UI button needed.

// Topbar refresh: re-poll dashboard + hardware + a fresh metrics tick
$('refreshBtn')?.addEventListener('click', async () => {
  try { refreshDashboard() } catch {}
  try { loadHardware() } catch {}
  try {
    const m = await window.w2gp.getSystemMetrics()
    if (m) {
      if (m.ramFree) { const el = $('specRamFree'); if (el) el.textContent = '(' + m.ramFree + ' free)' }
      if (m.vramFree) { const el = $('specVramFree'); if (el) el.textContent = '(' + m.vramFree + ' free)' }
      // nudge sparkline redraw via the polling tick
      if (window.__metricsTick) window.__metricsTick()
    }
  } catch {}
  showToast('Refreshed')
})

$('tokenSaveBtn')?.addEventListener('click', async () => {
  const token = $('githubTokenInput')?.value
  if (!token) return
  const cfg = await window.w2gp.configLoad()
  cfg.githubToken = token
  await window.w2gp.configSave(cfg)
  showToast('GitHub token saved')
})
$('tokenClearBtn')?.addEventListener('click', async () => {
  const cfg = await window.w2gp.configLoad()
  cfg.githubToken = null
  await window.w2gp.configSave(cfg)
  if ($('githubTokenInput')) $('githubTokenInput').value = ''
  showToast('GitHub token cleared')
})
$('tokenDocsLink')?.addEventListener('click', (e) => {
  e.preventDefault()
  window.w2gp.openExternal('https://github.com/settings/tokens')
})
$('hfTokenSaveBtn')?.addEventListener('click', async () => {
  const token = $('hfTokenInput')?.value
  if (!token) return
  const cfg = await window.w2gp.configLoad()
  cfg.hfToken = token
  await window.w2gp.configSave(cfg)
  showToast('HuggingFace token saved')
})
$('hfTokenClearBtn')?.addEventListener('click', async () => {
  const cfg = await window.w2gp.configLoad()
  cfg.hfToken = null
  await window.w2gp.configSave(cfg)
  if ($('hfTokenInput')) $('hfTokenInput').value = ''
  showToast('HuggingFace token cleared')
})
$('launchArgsSaveBtn')?.addEventListener('click', async () => {
  const args = $('launchArgsInput')?.value || ''
  const cfg = await window.w2gp.configLoad()
  cfg.launchArgs = args.trim()
  await window.w2gp.configSave(cfg)
  showToast('Extra launch args saved')
})
$('portSaveBtn')?.addEventListener('click', async () => {
  const val = parseInt($('portInput')?.value) || 7860
  if (val < 1024 || val > 65535) { showToast('Port must be between 1024 and 65535'); return }
  const cfg = await window.w2gp.configLoad()
  cfg.serverPort = val
  await window.w2gp.configSave(cfg)
  showToast('Server port set to ' + val)
})
$('cliDocsLink')?.addEventListener('click', (e) => {
  e.preventDefault()
  window.w2gp.openExternal('https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/CLI.md')
})

// ── Auto-Update ──
let updateState = null

window.w2gp.onUpdateStatus((status) => {
  switch (status.status) {
    case 'checking':
      $('updateText').textContent = 'Checking for updates...'
      $('updateBanner').classList.remove('hidden')
      $('updateDownloadBtn').classList.add('hidden')
      $('updateInstallBtn').classList.add('hidden')
      $('updateActions').classList.remove('hidden')
      $('updateProgress').classList.add('hidden')
      $('updateDismissBtn').classList.add('hidden')
      break
    case 'available':
      updateState = status
      $('updateText').textContent = `v${status.version} — downloading...`
      $('updateDownloadBtn').classList.add('hidden')
      $('updateInstallBtn').classList.add('hidden')
      $('updateActions').classList.add('hidden')
      $('updateProgress').classList.remove('hidden')
      $('progressFill').style.width = '0%'
      $('progressText').textContent = '0%'
      $('updateBanner').classList.remove('hidden')
      $('updateDismissBtn').classList.add('hidden')
      break
    case 'up-to-date':
      $('updateText').textContent = 'Up to date ✓'
      $('updateDownloadBtn').classList.add('hidden')
      $('updateActions').classList.remove('hidden')
      $('updateProgress').classList.add('hidden')
      $('updateBanner').classList.remove('hidden')
      $('updateDismissBtn').classList.remove('hidden')
      setTimeout(() => $('updateBanner').classList.add('hidden'), 3000)
      break
    case 'downloading':
      $('updateText').textContent = 'Downloading...'
      $('updateDownloadBtn').classList.add('hidden')
      $('updateInstallBtn').classList.add('hidden')
      $('updateActions').classList.add('hidden')
      $('updateProgress').classList.remove('hidden')
      $('progressFill').style.width = status.percent + '%'
      $('progressText').textContent = status.percent + '%'
      $('updateBanner').classList.remove('hidden')
      $('updateDismissBtn').classList.add('hidden')
      break
    case 'downloaded':
      $('updateText').textContent = `v${status.version} downloaded — ready to install`
      $('updateDownloadBtn').classList.add('hidden')
      $('updateInstallBtn').classList.remove('hidden')
      $('updateActions').classList.remove('hidden')
      $('updateProgress').classList.add('hidden')
      $('updateBanner').classList.remove('hidden')
      $('updateDismissBtn').classList.remove('hidden')
      break
    case 'error':
      $('updateText').textContent = status.message.includes('401') || status.message.includes('403') || status.message.includes('authentication')
        ? 'GitHub rate limited — add token in Manage settings'
        : `Update error: ${status.message}`
      $('updateDownloadBtn').classList.add('hidden')
      $('updateInstallBtn').classList.add('hidden')
      $('updateActions').classList.add('hidden')
      $('updateProgress').classList.add('hidden')
      $('updateBanner').classList.remove('hidden')
      $('updateDismissBtn').classList.remove('hidden')
      setTimeout(() => $('updateBanner').classList.add('hidden'), 8000)
      break
  }
})

// ════════════════════════════════════════════
//  Auto-Tune
// ════════════════════════════════════════════

let _autotuneHardware = null
let _autotuneRecommendation = null

/** Render hardware info into the card. */
function renderAutoTuneHardware(hw) {
  const el = $('autotuneHardwareInfo')
  if (!hw) {
    el.innerHTML = '<p class="token-hint" style="margin:0">Click <strong>Detect</strong> to scan your system.</p>'
    return
  }
  if (!hw.cuda_available) {
    el.innerHTML = '<p class="token-hint" style="margin:0;color:var(--text-secondary)">No NVIDIA GPU detected.</p>'
    return
  }

  const badges = []
  if (hw.supports_fp8) badges.push('<span class="env-type-tag" style="background:#2D4A2E;color:#8BC48B">FP8</span>')
  if (hw.supports_nvfp4) badges.push('<span class="env-type-tag" style="background:#2D3A5E;color:#8AB4F8">NVFP4</span>')
  if (hw.supports_flash) badges.push('<span class="env-type-tag" style="background:#3A2D4E;color:#C58AF8">Flash</span>')
  if (hw.supports_sage) badges.push('<span class="env-type-tag" style="background:#2D4A3E;color:#8AF8C5">Sage</span>')
  if (hw.supports_triton) badges.push('<span class="env-type-tag" style="background:#4A3D2E;color:#F8C58A">Triton</span>')

  el.innerHTML = '\
    <div class="spec-grid" style="margin-bottom:8px">\
      <div class="spec-row"><span class="spec-label">GPU</span><span class="spec-value">' + escHtml(hw.gpu_name) + '</span></div>\
      <div class="spec-row"><span class="spec-label">VRAM</span><span class="spec-value">' + hw.gpu_vram_gb + ' GB</span></div>\
      <div class="spec-row"><span class="spec-label">RAM</span><span class="spec-value">' + hw.ram_gb + ' GB</span></div>\
      <div class="spec-row"><span class="spec-label">CUDA</span><span class="spec-value">' + (hw.cuda_version || '—') + '</span></div>\
      <div class="spec-row"><span class="spec-label">Capability</span><span class="spec-value">' + (hw.gpu_capability || '—') + '</span></div>\
    </div>\
    <div style="display:flex;gap:6px;flex-wrap:wrap">' + badges.join('') + '</div>'
}

/** Build a <select> for profiles 1-5 with the given selected value. */
function profileSelect(name, selectedVal) {
  var opts = ''
  var labels = {1:'HighRAM \u00b7 HighVRAM', 2:'HighRAM \u00b7 LowVRAM', 3:'LowRAM \u00b7 HighVRAM', 4:'LowRAM \u00b7 LowVRAM', 5:'Very LowRAM \u00b7 LowVRAM'}
  for (var i = 1; i <= 5; i++) {
    var sel = i === selectedVal ? ' selected' : ''
    opts += '<option value="' + i + '"' + sel + '>P' + i + ' \u2014 ' + labels[i] + '</option>'
  }
  return '<select class="profile-select" data-profile-key="' + name + '">' + opts + '</select>'
}

/** Render recommendation into the card with editable dropdowns. */
function renderAutoTuneRecommendation(rec) {
  var el = $('autotuneRecommendInfo')
  var btn = $('autotuneApplyBtn')
  if (!rec) {
    el.innerHTML = '<p class="token-hint" style="margin:0">Run detection first.</p>'
    btn.disabled = true
    return
  }

  var quantLabel = rec.transformer_quantization === 'int8' ? 'Scaled Int8 \u2705 recommended' : rec.transformer_quantization
  var vaeLabel = rec.vae_config === 0 ? 'Auto \u2705 recommended' : (['Default','Tiling','Spilt-Tiling','No Encode'][rec.vae_config] || 'Default')

  el.innerHTML = '\
    <div class="spec-grid" style="margin-bottom:8px">\
      <div class="spec-row"><span class="spec-label">Video Profile</span><span class="spec-value">' + profileSelect('video_profile', rec.video_profile) + '</span></div>\
      <div class="spec-row"><span class="spec-label">Image Profile</span><span class="spec-value">' + profileSelect('image_profile', rec.image_profile) + '</span></div>\
      <div class="spec-row"><span class="spec-label">Audio Profile</span><span class="spec-value">' + profileSelect('audio_profile', rec.audio_profile) + '</span></div>\
      <div class="spec-row"><span class="spec-label">Quantization</span><span class="spec-value" style="color:#6ee7b7"><code>' + quantLabel + '</code></span></div>\
      <div class="spec-row"><span class="spec-label">VAE Config</span><span class="spec-value" style="color:#6ee7b7">' + rec.vae_config + ' \u00b7 ' + vaeLabel + '</span></div>\
      <div class="spec-row"><span class="spec-label">VRAM Safety Coeff</span><span class="spec-value">' + rec.vram_safety_coefficient + '</span></div>\
    </div>\
    <p class="token-hint" style="margin:4px 0 0;color:var(--text-secondary)">' + escHtml(rec._recommendation_reason || '') + '<br><span style="color:var(--text-tertiary);font-size:0.65rem">Modify the profile dropdowns before applying if needed. Higher profiles (3-5) use less VRAM but may be slower. Scaled Int8 and VAE Auto are Wan2GP\'s recommended defaults.</span></p>'
  btn.disabled = false

  // Wire dropdown changes to update the recommendation object
  el.querySelectorAll('.profile-select').forEach(function(sel) {
    sel.addEventListener('change', function() {
      var key = sel.dataset.profileKey
      var val = parseFloat(sel.value)
      _autotuneRecommendation[key] = val
    })
  })
}

function escHtml(s) {
  if (typeof s !== 'string') return String(s)
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ── Auto-Tune: Detect ──
$('autotuneDetectBtn').addEventListener('click', async () => {
  const btn = $('autotuneDetectBtn')
  const status = $('autotuneStatus')
  btn.disabled = true
  btn.textContent = '\u27b3 Scanning\u2026'
  status.classList.add('hidden')

  try {
    const result = await window.w2gp.autoTuneFullTune()
    _autotuneHardware = result.hardware
    _autotuneRecommendation = result.recommendation

    renderAutoTuneHardware(_autotuneHardware)
    renderAutoTuneRecommendation(_autotuneRecommendation)

    status.className = ''
    status.style.background = 'var(--bg-tertiary)'
    if (result.applyResult.success) {
      status.innerHTML = '\u2705 Settings applied to <code>' + escHtml(result.applyResult.path) + '</code><br><small>Keys: ' + result.applyResult.applied.join(', ') + '</small>'
    } else {
      status.innerHTML = '\u2139\ufe0f Detection complete. <strong>Apply</strong> to write settings.'
    }
  } catch (e) {
    status.className = ''
    status.style.background = '#3A1E1E'
    status.innerHTML = '\u274c Detection failed: ' + escHtml(e.message)
  } finally {
    btn.disabled = false
    btn.textContent = '\u27b3 Detect'
  }
})

// ── Auto-Tune: Apply ──
$('autotuneApplyBtn').addEventListener('click', async () => {
  const btn = $('autotuneApplyBtn')
  const status = $('autotuneStatus')
  if (!_autotuneRecommendation) return

  btn.disabled = true
  btn.textContent = 'Applying\u2026'
  status.classList.add('hidden')

  try {
    const result = await window.w2gp.autoTuneApply(_autotuneRecommendation)
    if (result.success) {
      status.className = ''
      status.style.background = '#1E3A1E'
      status.innerHTML = '\u2705 Applied to <code>' + escHtml(result.path) + '</code><br><small>Keys: ' + result.applied.join(', ') + '</small>'
    } else {
      status.className = ''
      status.style.background = '#3A1E1E'
      status.innerHTML = '\u274c ' + escHtml(result.error || 'Unknown error')
    }
  } catch (e) {
    status.className = ''
    status.style.background = '#3A1E1E'
    status.innerHTML = '\u274c Apply failed: ' + escHtml(e.message)
  } finally {
    btn.disabled = false
    btn.textContent = 'Apply to Wan2GP'
  }
})

// ── Xet Storage (hf_xet) ──
async function updateXetStatus() {
  const btn = $('xetInstallBtn')
  const status = $('xetStatus')
  if (!btn || !status) return
  try {
    const r = await window.w2gp.checkPackage('hf_xet')
    if (r && r.installed) {
      status.textContent = 'installed'
      status.style.color = 'var(--signal-green)'
      btn.textContent = 'Uninstall hf_xet'
    } else {
      status.textContent = 'not installed'
      status.style.color = 'var(--text-tertiary)'
      btn.textContent = 'Install hf_xet'
    }
  } catch {
    status.textContent = 'error checking'
    status.style.color = 'var(--signal-red)'
  }
}

$('xetInstallBtn')?.addEventListener('click', async function() {
  this.disabled = true
  const status = $('xetStatus')
  if (status) status.textContent = 'working...'
  try {
    let r
    if (this.textContent.startsWith('Uninstall')) {
      r = await window.w2gp.uninstallPackage('hf_xet')
    } else {
      r = await window.w2gp.installPackage('hf_xet')
    }
    if (r && r.success) {
      updateXetStatus()
      showToast(r.success ? 'hf_xet ' + (this.textContent.startsWith('Uninstall') ? 'uninstalled' : 'installed') : 'Failed')
    } else {
      if (status) { status.textContent = 'failed'; status.style.color = 'var(--signal-red)' }
      showToast('✗ ' + (r && r.error ? r.error : 'Failed'))
    }
  } catch (e) {
    if (status) { status.textContent = 'error'; status.style.color = 'var(--signal-red)' }
    showToast('✗ ' + e.message)
  } finally {
    this.disabled = false
  }
})
