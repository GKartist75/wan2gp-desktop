"use strict";

// ── Global Log Buffer ──
const logBuffer = []
const MAX_LOG = 5000
let lastLine = ''
let _carriageReturn = false  // next text part replaces lastLine instead of appending (tqdm progress bars)
let _renderScheduled = false
// Coalesce terminal rewrites onto one animation frame: a pip/log flood can emit
// dozens of chunks per second, and each one used to rebuild up to 3 full
// 5k-line textContent blobs synchronously. Now renders at most once per frame.
function scheduleTerminalRender() {
  if (_renderScheduled) return
  _renderScheduled = true
  requestAnimationFrame(() => { _renderScheduled = false; renderTerminals() })
}
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
  scheduleTerminalRender()
}

const termFollow = { termBody: true, ftTermBody: true, installTermBody: true }
const termAutoScroll = {}
const termDirty = {}

function renderTerminals() {
  // Include the in-progress (carriage-return-updated) line so progress bars are visible
  // before a newline arrives. When lastLine is empty we show buffer only.
  const text = logBuffer.join('\n') + (lastLine ? '\n' + lastLine : '')
  ;['termBody','ftTermBody','installTermBody'].forEach(id => {
    const el = document.getElementById(id)
    if (!el) return
    // Skip offscreen consoles (webview mode hides the dashboard console, the
    // floating overlay hides the DOM console) — writing 5k lines to a hidden
    // element is pure waste. They are flagged dirty and flushed on next show
    // (showTerminal/toggleFloatingTerm call renderTerminals() explicitly).
    if (el.offsetParent === null) { termDirty[id] = true; return }
    termDirty[id] = false
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
  $('pulsebarToggle')?.addEventListener('change', async () => {
    const el = $('pulsebarToggle')
    const c = await window.w2gp.configLoad()
    c.pulsebar = { enabled: el.checked }
    await window.w2gp.configSave(c)
    if (!el.checked) window.w2gp.pulsebarHide()
    showToast(el.checked ? 'Floating progress bar enabled' : 'Floating progress bar disabled')
  })
  $('autoUpdateToggle')?.addEventListener('change', async () => {
    const el = $('autoUpdateToggle')
    const c = await window.w2gp.configLoad()
    c.autoUpdateEnabled = el.checked
    await window.w2gp.configSave(c)
    showToast(el.checked ? 'Auto-updates enabled' : 'Auto-updates disabled — updates only via "Check for updates"')
  })
  $('shareToggle')?.addEventListener('change', async () => {
    const el = $('shareToggle')
    const c = await window.w2gp.configLoad()
    c.share = el.checked
    await window.w2gp.configSave(c)
    showToast(el.checked ? 'Share link enabled — Gradio will create a public tunnel on next launch' : 'Share link disabled')
  })

  // ── Queue Notifier ──
  const notifStatus = (msg, isErr) => {
    const el = $('notifStatus')
    if (!el) return
    el.textContent = msg || ''
    el.style.color = isErr ? 'var(--signal-red)' : 'var(--signal-green)'
  }
  const notifCollect = () => ({
    enabled: $('notifEnabled')?.checked || false,
    notifyOnComplete: $('notifOnComplete')?.checked || false,
    notifyOnFail: $('notifOnFail')?.checked || false,
    notifyOnProgress: $('notifOnProgress')?.checked || false,
    progressStep: parseInt($('notifProgressStep')?.value || '25', 10) || 25,
    url: ($('notifUrl')?.value || '').trim()
  })
  const notifApplyDom = (cfg) => {
    if (!$('notifEnabled')) return
    $('notifEnabled').checked = !!cfg.enabled
    $('notifOnComplete').checked = cfg.notifyOnComplete !== false
    $('notifOnFail').checked = cfg.notifyOnFail !== false
    $('notifOnProgress').checked = !!cfg.notifyOnProgress
    $('notifProgressStep').value = cfg.progressStep || 25
    $('notifUrl').value = cfg.url || ''
  }
  window.w2gp.notifierConfig().then((r) => { if (r && r.ok) notifApplyDom(r.config) }).catch(() => {})
  $('notifSaveBtn')?.addEventListener('click', async () => {
    const r = await window.w2gp.notifierSet(notifCollect())
    if (r && r.ok) { notifStatus('✓ Saved', false); if (r.config.enabled && r.config.url) window.w2gp.notifierEnsure().catch(() => {}) }
    else notifStatus('✗ ' + ((r && r.error) || 'save failed'), true)
  })
  $('notifTestBtn')?.addEventListener('click', async () => {
    const r = await window.w2gp.notifierTest(notifCollect())
    if (r && r.ok) notifStatus('✓ Test sent', false)
    else notifStatus('✗ ' + ((r && r.error) || 'test failed'), true)
  })
  $('notifEnsureBtn')?.addEventListener('click', async () => {
    notifStatus('Installing Apprise…', false)
    const r = await window.w2gp.notifierEnsure()
    if (r && r.ok) notifStatus(r.already ? 'Apprise already present' : '✓ Apprise installed', false)
    else notifStatus('✗ ' + ((r && r.error) || 'install failed'), true)
  })
  $('notifAppriseLink')?.addEventListener('click', (e) => { e.preventDefault(); window.w2gp.openExternal('https://github.com/caronc/apprise') })
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
    const pulsebar = $('pulsebarToggle')
    if (pulsebar) pulsebar.checked = !!(cfg.pulsebar && cfg.pulsebar.enabled)
    const autoUpdate = $('autoUpdateToggle')
    if (autoUpdate) autoUpdate.checked = cfg.autoUpdateEnabled !== false
    const share = $('shareToggle')
    if (share) share.checked = cfg.share === true
    // GPU device picker: fill the dropdown from the main process, keep current choice
    loadGpuDeviceOptions(cfg.gpuDevice || 'auto')
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
    // Periodic Wan2GP update re-check while the app is open (30 min).
    // Launch-time check alone misses updates released mid-session; the
    // renderer-side timer re-polls and re-flags the green dot + changelog.
    startWangpPolling()
    // D1: silent settings auto-scan (issue #7 class) — out-of-range dropdown
    // values make Wan2GP reject the whole settings form on save; repair them
    // in the background so the user never hits the "can't save" wall. Writes
    // only when a fix is actually found (console log + toast otherwise quiet).
    silentSettingsRepair()
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
      list.innerHTML = hp.packages.map(function(p) { return '<span class="ipkg-item">' + escHtml(p) + '</span>' }).join('')
      $('installPkgs').style.display = ''
    })
    // Pre-flight resolved stack (CUDA build, driver/disk gates) — audit hardening
    window.w2gp.installPlan().then(function(r) {
      if (!r || !r.ok) return
      const grid = $('installStackGrid')
      const warn = $('installStackWarn')
      const stack = $('installStack')
      if (!grid) return
      const p = r.plan
      const rows = [
        ['GPU', p.gpuName || p.vendor],
        ['CUDA build', p.cuda],
        ['PyTorch', p.torch],
        ['Python', p.python],
        ['Env', p.envType],
        ['Attention kernels', (p.attention && p.attention.length) ? p.attention.join(', ') : '—'],
        ['Free disk', r.disk.freeGb + ' GB']
      ]
      grid.innerHTML = rows.map(function(row) {
        return '<div class="istack-row"><span class="istack-k">' + escHtml(row[0]) + '</span><span class="istack-v">' + escHtml(row[1]) + '</span></div>'
      }).join('')
      const warns = []
      if (p.driverWarning) warns.push(p.driverWarning)
      if (r.disk && r.disk.warn) warns.push(r.disk.warn)
      let warnHtml = warns.length ? warns.map(function(w) { return '<div class="istack-w">⚠ ' + escHtml(w) + '</div>' }).join('') : ''
      if (r.softWarn) warnHtml += '<div class="istack-hint">This is a compatibility warning, not a hard block — install can continue but generation may fall back to CPU.</div>'
      warn.innerHTML = warnHtml
      stack.style.display = ''
      // Block install only when a hard gate trips (old NVIDIA cu130 driver, or no disk).
      const startBtn = $('installStartBtn')
      if (startBtn && r.blocked) {
        startBtn.disabled = true
        startBtn.title = 'Resolve the warnings above before installing'
        startBtn.textContent = 'Install blocked — see warnings'
      }
    }).catch(function() {})
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
    // Skip sampling while the dashboard is hidden (webview/embed open): the
    // IPC + nvidia-smi query every 2s was running even when nothing displayed
    // it. The next shown-state tick resumes automatically.
    const dash = $('dashBody')
    if (dash && dash.style.display === 'none') return
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

// ── Periodic Wan2GP update check ──
// Re-polls the upstream commit list every 30 min while the app is open so an
// update released mid-session still flags the green dot + changelog without a
// manual refresh. Silent re-check (no loading flash); the GitHub cache in
// main.js keeps this off the rate-limit radar. Skips while the dashboard is
// hidden (user is in the webview / embedded browser).
const WANGP_POLL_MS = 30 * 60 * 1000
function startWangpPolling() {
  if (window.__wangpPollTimer) clearInterval(window.__wangpPollTimer)
  const poll = () => {
    const dash = $('dashBody')
    if (dash && dash.style.display === 'none') return
    loadWangpChangelog(false)
  }
  window.__wangpPollTimer = setInterval(poll, WANGP_POLL_MS)
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

$('validateInstallBtn')?.addEventListener('click', async () => {
  const btn = $('validateInstallBtn')
  const warn = $('installStackWarn')
  btn.disabled = true; btn.textContent = 'Validating…'
  if (warn) warn.innerHTML = ''
  try {
    const r = await window.w2gp.validateInstall()
    if (r && r.ok) {
      const line = `✓ torch ${r.torch} · CUDA available: ${r.cudaAvailable} (${r.cudaVer})`
      if (warn) warn.innerHTML = '<div class="istack-ok">⚡ ' + escHtml(line) + '</div>'
      btn.textContent = 'Validated ✓'
    } else {
      if (warn) warn.innerHTML = '<div class="istack-w">✗ ' + escHtml((r && r.error) || 'validation failed') + '</div>'
      btn.textContent = 'Validate failed'
    }
  } catch (e) {
    if (warn) warn.innerHTML = '<div class="istack-w">✗ ' + escHtml(e.message) + '</div>'
    btn.textContent = 'Validate failed'
  }
})

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
      var r
      try { r = await window.w2gp.installPrerequisite(tool) }
      catch (e) { r = { error: (e && e.message) || String(e) } } // never leave the button frozen
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
    const ok = await window.w2gp.reinstall()
    if (!ok) {
      appendLog('[!] Reinstall aborted — the existing installation could not be removed (files likely locked by a running process or a terminal open in the folder).')
      appendLog('[!] Close any terminal/Explorer window open in the Wan2GP folder, then retry.')
      showToast('✗ Could not remove existing installation')
      $('installSubtitle').textContent='Setup Wan2GP'
      $('envTypeSelect').classList.remove('disabled')
      document.querySelectorAll('.env-type-btn').forEach(b => b.disabled = false)
      $('installStartBtn').classList.remove('hidden')
      return
    }
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
    const vb = $('validateInstallBtn')
    if (vb) { vb.style.display = ''; vb.disabled = false; vb.textContent = 'Validate installation' }
    setTimeout(()=>{ show('dashboard'); refreshDashboard(); startMetricsPolling() }, 1200)
  } catch(e){ taskComplete('done',true); $('installSubtitle').textContent='Installation failed'; appendLog(`[ERROR] ${e.message}`) }
}

$('settingsOverlay').addEventListener('click', closeSettings)

// ── Dashboard ──
async function refreshDashboard(){
  // status / checkInstalled / manageList are independent — run them in one
  // batch instead of 3 sequential IPC round-trips (~2-6ms saved each, more
  // when the machine is under load from a running install).
  const [status, instRes, envs] = await Promise.all([
    window.w2gp.getStatus(),
    window.w2gp.checkInstalled().catch(() => null),
    window.w2gp.manageList().catch(() => [])
  ])
  // Launch buttons only make sense when Wan2GP is actually installed
  try {
    setLaunchButtonsInstalled(!!(instRes && instRes.repo))
  } catch {}
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
  const list=$('envList'); list.innerHTML=''
  envs.forEach(e=>{
    const div=document.createElement('div')
    div.className='env-list-item'+(e.active?' active':'')
    div.innerHTML=`<span class="env-dot"></span><span class="env-list-name">${escHtml(e.name)}</span><span style="font-size:0.65rem;color:#666;flex-shrink:0">${escHtml(e.type)}</span>`
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
  set('pathAppData', p.repo)
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
  window.w2gp.getInstallPaths().then(function(p) { if (p) window.w2gp.openFolder(p.repo); });
});

// Re-entrancy guard: periodic + manual checks share one flight; a slow GitHub
// response can't stack overlapping fetches.
let _wangpCheckBusy = false
async function loadWangpChangelog(showLoading) {
  const localEl = $('localCommit')
  const listEl = $('updatesList')
  const verEl = $('wangpVersion')
  if (!listEl) return
  if (_wangpCheckBusy) return
  _wangpCheckBusy = true
  try {
    if (showLoading) listEl.innerHTML = '<div class="changelog-loading">Checking for updates...</div>'

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
        <span class="cl-msg">${escHtml(c.message)}</span>
        <span class="cl-author">${escHtml(c.author)}</span>
      </div>`
    ).join('')
  } finally {
    _wangpCheckBusy = false
  }
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
  $('wangpCheckLink')?.addEventListener('click', (e) => {
    e.preventDefault()
    loadWangpChangelog(true)
  })
  $('changelogLink')?.addEventListener('click', (e) => {
    e.preventDefault()
    window.w2gp.openExternal('https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/CHANGELOG.md')
  })
  $('hfModelsLink')?.addEventListener('click', (e) => {
    e.preventDefault()
    window.w2gp.openExternal('https://huggingface.co/DeepBeepMeep')
  })
})

// ── Launch buttons: disabled + hint when Wan2GP is not installed ──
function setLaunchButtonsInstalled(installed) {
  ;['browserBtn', 'browserNoGpuBtn', 'termBtn', 'appBtn'].forEach(id => {
    const b = $(id)
    if (b) b.disabled = !installed
  })
  const hint = $('notInstalledHint')
  if (hint) hint.style.display = installed ? 'none' : 'block'
}

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

// ── Plugin Catalog ───────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function catalogCard(p) {
  const statusTag = p.installed
    ? (p.enabled ? '<span class="cat-tag cat-installed">Installed</span>'
                 : '<span class="cat-tag cat-disabled">Disabled</span>')
    : '<span class="cat-tag cat-available">Available</span>'
  const verifiedTag = p.verified === false
    ? '<span class="cat-tag cat-unverified" title="Repo URL/tag not confirmed — flips to verified before install">Unverified</span>' : ''
  const versionTag = '<span class="cat-version">v' + escHtml(p.version) + '</span>'
  const typeTag = '<span class="cat-type">' + escHtml(p.type) + '</span>'
  // Primary action depends on install state.
  let actions = ''
  if (!p.installed) {
    actions += '<button class="cat-btn cat-install" data-id="' + p.id + '">Install</button>'
  } else {
    actions += '<button class="cat-btn cat-toggle" data-id="' + p.id + '" data-on="' + (p.enabled ? '0' : '1') + '">' + (p.enabled ? 'Disable' : 'Enable') + '</button>'
    actions += '<button class="cat-btn cat-update" data-id="' + p.id + '">Update</button>'
    actions += '<button class="cat-btn cat-remove" data-id="' + p.id + '">Remove</button>'
  }
  // Verification gate: unverified repos must be confirmed before install is allowed.
  if (p.verified === false) {
    actions += '<button class="cat-btn cat-verify" data-id="' + p.id + '" title="Check repo URL + tag exist (git ls-remote)">Verify</button>'
  }
  const home = p.homepage ? '<a class="cat-link" href="#" data-home="' + escHtml(p.homepage) + '">Homepage ↗</a>' : ''
  return '' +
    '<div class="cat-card" data-id="' + p.id + '">' +
      '<div class="cat-card-head"><div class="cat-title">' + escHtml(p.name) + '</div>' + statusTag + verifiedTag + '</div>' +
      '<div class="cat-meta">' + typeTag + versionTag + '<span class="cat-author">by ' + escHtml(p.author) + '</span></div>' +
      '<div class="cat-summary">' + escHtml(p.summary || '') + '</div>' +
      '<div class="cat-actions">' + actions + home + '</div>' +
      '<div class="cat-status-line" id="cat-status-' + p.id + '"></div>' +
    '</div>'
}

async function loadCatalog() {
  const list = $('catalogList')
  if (list) list.innerHTML = '<div class="catalog-loading">Loading catalog…</div>'
  try {
    const res = await window.w2gp.catalogList()
    if (!res || !res.ok) throw new Error((res && res.error) || 'catalog error')
    if (list) {
      if (!res.plugins.length) {
        list.innerHTML = '<div class="catalog-loading">No plugins in catalog.</div>'
      } else {
        list.innerHTML = res.plugins.map(catalogCard).join('')
      }
    }
  } catch (e) {
    if (list) list.innerHTML = '<div class="catalog-error">Failed to load catalog: ' + escHtml(e.message) + '</div>'
  }
}

function setCatStatus(id, msg, isError) {
  const el = document.getElementById('cat-status-' + id)
  if (!el) return
  el.textContent = msg
  el.className = 'cat-status-line' + (isError ? ' cat-status-error' : '')
}

async function catalogVerifyAction(id) {
  setCatStatus(id, 'Verifying repo…', false)
  try {
    const r = await window.w2gp.catalogVerify(id)
    if (!r || !r.ok) throw new Error((r && r.error) || 'verify failed')
    if (r.verified) setCatStatus(id, '✓ Repo + tag confirmed — safe to install.', false)
    else setCatStatus(id, '✗ ' + ((r.error) || 'repo/tag not found'), true)
    // Reload so the Unverified tag flips if it became verified (manifest is read-only
    // for safety, so a verified result just means the user can proceed with install).
    await loadCatalog()
  } catch (e) {
    setCatStatus(id, '✗ ' + e.message, true)
  }
}


async function catalogAction(action, id, extra) {
  const fn = { install: window.w2gp.catalogInstall, update: window.w2gp.catalogUpdate, remove: window.w2gp.catalogRemove, toggle: window.w2gp.catalogToggle }[action]
  if (!fn) return
  const args = action === 'toggle' ? [id, extra, true] : [id, true]
  try {
    const r = await fn.apply(null, args)
    if (!r || !r.ok) throw new Error((r && r.error) || 'action failed')
    setCatStatus(id, action === 'remove' ? 'Removed.' : (action === 'toggle' ? 'Toggled.' : 'Done.'), false)
    await loadCatalog()
  } catch (e) {
    setCatStatus(id, e.message, true)
  }
}

function wireCatalog() {
  const pb = $('pluginsBtn')
  if (pb) pb.addEventListener('click', () => { show('catalog'); loadCatalog() })
  const back = $('catalogBackBtn')
  if (back) back.addEventListener('click', () => show('dashboard'))
  const refresh = $('catalogRefreshBtn')
  if (refresh) refresh.addEventListener('click', loadCatalog)
  // Event delegation for card buttons + homepage links.
  const list = $('catalogList')
  if (!list) return
  list.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-id]')
    if (btn) {
      const id = btn.getAttribute('data-id')
      if (btn.classList.contains('cat-install')) catalogAction('install', id)
      else if (btn.classList.contains('cat-update')) catalogAction('update', id)
      else if (btn.classList.contains('cat-remove')) catalogAction('remove', id)
      else if (btn.classList.contains('cat-toggle')) catalogAction('toggle', id, btn.getAttribute('data-on') === '1')
      else if (btn.classList.contains('cat-verify')) catalogVerifyAction(id)
      return
    }
    const link = ev.target.closest('a[data-home]')
    if (link) {
      ev.preventDefault()
      window.w2gp.openExternal(link.getAttribute('data-home'))
    }
  })
}
wireCatalog()

// ── Gallery (native output browser) ────────────────────────────────────────────
function escHtmlGallery(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function galleryCard(it) {
  const isImg = it.type === 'image'
  const thumb = isImg ? `<img class="g-thumb" src="file:///${encodeURI(it.path)}" loading="lazy" onerror="this.style.display='none'">`
                      : `<div class="g-thumb g-vid">▶</div>`
  const meta = it.metadata || {}
  const metaBits = []
  if (meta.prompt) metaBits.push('<span class="g-prompt">' + escHtmlGallery(meta.prompt.slice(0, 120)) + (meta.prompt.length > 120 ? '…' : '') + '</span>')
  if (meta.model) metaBits.push('<span class="g-meta-tag">model: ' + escHtmlGallery(meta.model) + '</span>')
  if (meta.seed != null) metaBits.push('<span class="g-meta-tag">seed: ' + escHtmlGallery(meta.seed) + '</span>')
  const metaHtml = metaBits.length ? '<div class="g-meta">' + metaBits.join(' ') + '</div>' : ''
  return '' +
    '<div class="g-card" data-path="' + escHtmlGallery(it.path) + '">' +
      '<a class="g-thumb-link" href="#" data-open="' + escHtmlGallery(it.path) + '">' + thumb + '</a>' +
      '<div class="g-name" title="' + escHtmlGallery(it.name) + '">' + escHtmlGallery(it.name) + '</div>' +
      metaHtml +
      '<div class="g-actions">' +
        '<button class="cat-btn g-open" data-open="' + escHtmlGallery(it.path) + '">Open</button>' +
        '<button class="cat-btn g-folder" data-folder="' + escHtmlGallery(it.dir) + '">Folder</button>' +
      '</div>' +
    '</div>'
}

async function loadGallery() {
  const grid = $('galleryGrid')
  const dirs = $('galleryDirs')
  if (grid) grid.innerHTML = '<div class="catalog-loading">Scanning outputs…</div>'
  try {
    const res = await window.w2gp.galleryScan()
    if (!res || !res.ok) throw new Error((res && res.error) || 'scan failed')
    if (dirs) dirs.textContent = (res.outputDirs && res.outputDirs.length) ? res.outputDirs.join(' · ') : 'No output folders found'
    if (grid) {
      if (!res.items.length) grid.innerHTML = '<div class="catalog-loading">No media found in output folders.</div>'
      else grid.innerHTML = res.items.map(galleryCard).join('')
    }
  } catch (e) {
    if (grid) grid.innerHTML = '<div class="catalog-error">Gallery scan failed: ' + escHtmlGallery(e.message) + '</div>'
  }
}

function wireGallery() {
  $('galleryBtn')?.addEventListener('click', () => { show('gallery'); loadGallery() })
  $('galleryBackBtn')?.addEventListener('click', () => show('dashboard'))
  $('galleryRefreshBtn')?.addEventListener('click', loadGallery)
  const grid = $('galleryGrid')
  if (!grid) return
  grid.addEventListener('click', async (ev) => {
    const openBtn = ev.target.closest('[data-open]')
    if (openBtn) { window.w2gp.openExternal('file:///' + openBtn.getAttribute('data-open')); return }
    const folderBtn = ev.target.closest('[data-folder]')
    if (folderBtn) { window.w2gp.openExternal('file:///' + folderBtn.getAttribute('data-folder')); return }
  })
  // Join frames: pick a frame folder, run join, then refresh.
  const joinBtn = document.createElement('button')
  joinBtn.className = 'btn btn-primary small'
  joinBtn.textContent = 'Join Frames → MP4'
  joinBtn.style.marginLeft = 'auto'
  joinBtn.addEventListener('click', async () => {
    const folder = await window.w2gp.selectFolder()
    if (!folder) return
    joinBtn.disabled = true; joinBtn.textContent = 'Joining…'
    try {
      const r = await window.w2gp.galleryJoin({ folder })
      if (r && r.ok) { showToast('✓ Joined → ' + r.outPath); }
      else showToast('✗ ' + ((r && r.error) || 'join failed'))
    } catch (e) { showToast('✗ ' + e.message) }
    finally { joinBtn.disabled = false; joinBtn.textContent = 'Join Frames → MP4'; }
  })
  const topRight = document.querySelector('#gallery .catalog-topbar-right')
  topRight?.appendChild(joinBtn)
}
wireGallery()



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

  // Auto-Tune: check if Wan2GP is installed — disable if not
  if (tabName === 'autotune') {
    checkAutoTuneInstalled()
  }
}

async function checkAutoTuneInstalled() {
  const installed = await window.w2gp.checkInstalled()
  const notInstalledEl = $('autotuneNotInstalled')
  const contentEl = $('autotuneContent')
  if (!notInstalledEl || !contentEl) return
  if (!installed.repo) {
    notInstalledEl.classList.remove('hidden')
    contentEl.classList.add('hidden')
  } else {
    notInstalledEl.classList.add('hidden')
    contentEl.classList.remove('hidden')
    // D3: first visit to the tab — auto-run detection so the panel shows a live
    // recommendation instead of an empty "Run detection first" state. Only once
    // per session; a failed detect leaves the button enabled for a manual retry.
    if (!_autotuneHardware && !_autotuneAutoDetectDone) {
      _autotuneAutoDetectDone = true
      setTimeout(() => $('autotuneDetectBtn')?.click(), 150)
    }
  }
}

document.querySelectorAll('.settings-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    switchSettingsTab(tab.dataset.tab)
    tab.closest('.settings-tabs')?.querySelector('.settings-tabs-inner')?.scrollTo({ left: tab.offsetLeft - 80, behavior: 'smooth' })
  })
})
$('settingsBtn').addEventListener('click',()=>{ openSettings() })
$('autoTuneDashBtn').addEventListener('click',()=>{ openSettings(); switchSettingsTab('autotune') })
// Windows-only UI: hide the Task Manager button on other platforms.
if (window.w2gp && window.w2gp.platform !== 'win32') {
  const taskMgrBtn = $('taskMgrBtn')
  if (taskMgrBtn) taskMgrBtn.style.display = 'none'
}
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
// GPU device picker (multi-GPU machines) — populate dropdown + save selection
async function loadGpuDeviceOptions(current) {
  const sel = $('gpuDeviceSelect')
  if (!sel) return
  try {
    const gpus = await window.w2gp.detectGpus()
    // Keep "Auto" first, then one option per detected GPU
    const existing = Array.from(sel.options).map(o => o.value)
    gpus.forEach(g => {
      const v = 'cuda:' + g.index
      if (!existing.includes(v)) {
        const opt = document.createElement('option')
        opt.value = v
        opt.textContent = g.name + ' (' + (g.vramMB ? (g.vramMB + ' MB') : 'VRAM n/a') + ') — ' + v
        sel.appendChild(opt)
      }
    })
    sel.value = (current && /^cuda:\d+$/.test(current)) ? current : 'auto'
  } catch (e) {
    sel.value = 'auto'
  }
}
$('gpuDeviceSaveBtn')?.addEventListener('click', async () => {
  const val = $('gpuDeviceSelect')?.value || 'auto'
  const cfg = await window.w2gp.configLoad()
  cfg.gpuDevice = val
  await window.w2gp.configSave(cfg)
  showToast(val === 'auto' ? 'GPU device set to Auto' : 'GPU device set to ' + val + ' (applies on next launch)')
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
      if (status.autoDownload === false) {
        // Auto-updates disabled: don't auto-download — offer the manual
        // Download button instead.
        $('updateText').textContent = `v${status.version} available`
        $('updateDownloadBtn').classList.remove('hidden')
        $('updateInstallBtn').classList.add('hidden')
        $('updateActions').classList.remove('hidden')
        $('updateProgress').classList.add('hidden')
        $('updateBanner').classList.remove('hidden')
        $('updateDismissBtn').classList.add('hidden')
      } else {
        $('updateText').textContent = `v${status.version} — downloading...`
        $('updateDownloadBtn').classList.add('hidden')
        $('updateInstallBtn').classList.add('hidden')
        $('updateActions').classList.add('hidden')
        $('updateProgress').classList.remove('hidden')
        $('progressFill').style.width = '0%'
        $('progressText').textContent = '0%'
        $('updateBanner').classList.remove('hidden')
        $('updateDismissBtn').classList.add('hidden')
      }
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
let _autotuneAutoDetectDone = false  // D3: auto-run Detect once per session on first tab open

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
    <div class="hw-compact">\
      <span class="hw-chip"><span class="hw-chip-label">GPU</span>' + escHtml(hw.gpu_name) + '</span>\
      <span class="hw-chip"><span class="hw-chip-label">VRAM</span>' + hw.gpu_vram_gb + ' GB</span>\
      <span class="hw-chip"><span class="hw-chip-label">RAM</span>' + hw.ram_gb + ' GB</span>\
      <span class="hw-chip"><span class="hw-chip-label">CUDA</span>' + (hw.cuda_version || '—') + '</span>\
      <span class="hw-chip"><span class="hw-chip-label">Cap</span>' + (hw.gpu_capability || '—') + '</span>\
    </div>\
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">' + badges.join('') + '</div>'
}

/** Render recommendation as READ-ONLY info. Editing happens in the VRAM/RAM
 *  Adjuster below (the single editor for these keys); Detect just seeds it. */
function renderAutoTuneRecommendation(rec) {
  var el = $('autotuneRecommendInfo')
  if (!rec) {
    el.innerHTML = '<p class="token-hint" style="margin:0">Run detection first.</p>'
    return
  }

  var unavailable = /unavailable/i.test(rec._recommendation_label || '')
  var currentProf = rec.video_profile
  var isP3plus = currentProf === 3.5
  var isP4plus = currentProf === 4.5
  var profDisp = isP3plus ? 'P3+' : isP4plus ? 'P4+' : 'P' + currentProf

  el.innerHTML = [
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">',
    '<strong>' + escHtml(rec._recommendation_label || 'Recommended settings') + '</strong>',
    (unavailable ? '<span class="env-type-tag" style="background:#3A1E1E;color:#FCA5A5">unavailable on this hardware</span>' : '<span class="env-type-tag" style="background:#2D4A3E;color:#8AF8C5">estimated</span>'),
    '</div>',
    '<div class="spec-grid" style="margin-bottom:8px">',
    '<div class="spec-row"><span class="spec-label">Video Profile</span><span class="spec-value">' + (rec.video_profile != null ? rec.video_profile : '—') + '</span></div>',
    '<div class="spec-row"><span class="spec-label">Image Profile</span><span class="spec-value">' + (rec.image_profile != null ? rec.image_profile : '—') + '</span></div>',
    '<div class="spec-row"><span class="spec-label">Audio Profile</span><span class="spec-value">' + (rec.audio_profile != null ? rec.audio_profile : '—') + '</span></div>',
    '<div class="spec-row"><span class="spec-label">Quantization</span><span class="spec-value">' + (rec.transformer_quantization != null ? rec.transformer_quantization : '—') + '</span></div>',
    '<div class="spec-row"><span class="spec-label">VAE Config</span><span class="spec-value">' + (rec.vae_config != null ? (rec.vae_config + (rec.vae_config === 0 ? ' (AUTO)' : '')) : '—') + '</span></div>',
    '<div class="spec-row"><span class="spec-label">VRAM Safety Coeff</span><span class="spec-value">' + (rec.vram_safety_coefficient != null ? rec.vram_safety_coefficient : '—') + '</span></div>',
    '</div>',
    '<p class="token-hint" style="margin:4px 0 0;color:var(--text-secondary)">' + escHtml(rec._recommendation_reason || '') + '</p>',
    '<table class="profile-matrix" style="margin-top:6px">',
    '<tr><th>VRAM \\ RAM</th><th style="text-align:center">high<br><span class="tier-range">≥64GB</span></th><th style="text-align:center">low<br><span class="tier-range">≥32GB</span></th><th style="text-align:center">very low<br><span class="tier-range"><32GB</span></th></tr>',
    '<tr><td>high<br><span class="tier-range">≥24GB</span></td><td style="text-align:center;color:#6ee7b7">P1</td><td style="text-align:center">P3</td><td style="text-align:center;color:#67e8f9">P3+</td></tr>',
    '<tr><td>low<br><span class="tier-range">12–23GB</span></td><td style="text-align:center">P2</td><td style="text-align:center">P4</td><td style="text-align:center;color:#f87171">P5</td></tr>',
    '<tr><td>tight<br><span class="tier-range"><12GB</span></td><td style="text-align:center">P4</td><td style="text-align:center;color:#67e8f9">P4+</td><td style="text-align:center;color:#f87171">P5</td></tr>',
    '</table>',
    '<p class="token-hint" style="margin:4px 0 0;color:var(--text-tertiary);font-size:0.65rem">These values are loaded into the <strong>VRAM / RAM Adjuster</strong> below — adjust there if you want, then press <strong>Apply Overrides</strong>. Changes take effect after Wan2GP is restarted.</p>'
  ].join('\n')
}

// escHtml now comes from services/escape.js (loaded before app.js) so the
// module's escaping logic is shared with the node --test suite.

// ── Auto-Tune: Detect ──
$('autotuneDetectBtn').addEventListener('click', async () => {
  const btn = $('autotuneDetectBtn')
  const status = $('autotuneStatus')
  btn.disabled = true
  btn.textContent = '\u27b3 Scanning\u2026'
  status.classList.add('hidden')

  try {
    // Detect + recommend only — nothing is written until Apply is clicked.
    const hw = await window.w2gp.autoTuneDetect()
    _autotuneHardware = hw
    const rec = await window.w2gp.autoTuneRecommend(hw, { failsafe: $('autotuneFailsafeChk').checked })
    _autotuneRecommendation = rec
    // Feed the manual VRAM/RAM Adjuster so the user can review/edit before Apply.
    memProfileFromRecommendation(rec)

    renderAutoTuneHardware(_autotuneHardware)
    renderAutoTuneRecommendation(_autotuneRecommendation)

    status.className = ''
    status.style.background = 'var(--bg-tertiary)'
    status.innerHTML = '\u2139\ufe0f Detection complete. Review the recommendation below, then <strong>Apply</strong> to write settings (Wan2GP must be restarted for them to take effect).'
  } catch (e) {
    status.className = ''
    status.style.background = '#3A1E1E'
    status.innerHTML = '\u274c Detection failed: ' + escHtml(e.message)
  } finally {
    btn.disabled = false
    btn.textContent = '\u27b3 Detect'
  }
})

// ── VRAM / RAM Adjuster (manual memory-profile overrides) ──
function memProfileCollect() {
  // Only include fields the user actually set (non-empty) — unset = leave existing config.
  const s = {}
  const vp = $('memVideoProfile').value
  const ip = $('memImageProfile').value
  const ap = $('memAudioProfile').value
  const co = $('memCoeff').value
  const ve = $('memVae').value
  const q = $('memQuant').value
  if (vp) s.video_profile = Number(vp)
  if (ip) s.image_profile = Number(ip)
  if (ap) s.audio_profile = Number(ap)
  if (co) {
    const n = Number(co)
    if (!(n > 0 && n <= 1)) { setMemStatus('VRAM Safety Coeff must be between 0.1 and 1', true); return null }
    s.vram_safety_coefficient = n
  }
  if (ve !== '') s.vae_config = Number(ve)
  if (q) s.transformer_quantization = q
  return s
}

function setMemStatus(msg, isError) {
  const el = $('memProfileStatus')
  if (!el) return
  el.textContent = msg || ''
  el.style.color = isError ? 'var(--signal-red)' : 'var(--text-secondary)'
}

function memProfilePopulate(settings) {
  if (!settings) return
  $('memVideoProfile').value = settings.video_profile != null ? String(settings.video_profile) : ''
  $('memImageProfile').value = settings.image_profile != null ? String(settings.image_profile) : ''
  $('memAudioProfile').value = settings.audio_profile != null ? String(settings.audio_profile) : ''
  $('memCoeff').value = settings.vram_safety_coefficient != null ? String(settings.vram_safety_coefficient) : ''
  // VAE defaults to AUTO (0) per preference — runtime picks tiling from actual VRAM.
  $('memVae').value = (settings.vae_config != null && settings.vae_config !== '') ? String(settings.vae_config) : '0'
  $('memQuant').value = settings.transformer_quantization != null ? String(settings.transformer_quantization) : ''
}

// Feed the manual Adjuster from an Auto-Tune detection result so Detect →
// review/edit in the Adjuster → Apply is one coherent flow.
function memProfileFromRecommendation(rec) {
  if (!rec) return
  memProfilePopulate({
    video_profile: rec.video_profile,
    image_profile: rec.image_profile,
    audio_profile: rec.audio_profile,
    vram_safety_coefficient: rec.vram_safety_coefficient,
    vae_config: rec.vae_config != null ? rec.vae_config : 0, // AUTO unless Detect set a fixed value
    transformer_quantization: rec.transformer_quantization
  })
}

async function memProfileLoad() {
  try {
    const res = await window.w2gp.memoryProfileRead()
    if (res && res.ok) memProfilePopulate(res.settings)
    else setMemStatus((res && res.error) || 'Failed to read memory settings', true)
  } catch (e) { setMemStatus(e.message, true) }
}

$('memProfileApplyBtn')?.addEventListener('click', async () => {
  const btn = $('memProfileApplyBtn')
  const s = memProfileCollect()
  if (!s) return
  if (Object.keys(s).length === 0) { setMemStatus('Set at least one field before applying.', true); return }
  btn.disabled = true; btn.textContent = 'Applying…'; setMemStatus('')
  try {
    const res = await window.w2gp.memoryProfileApply(s)
    if (res && res.ok) setMemStatus('✓ Applied: ' + res.applied.join(', ') + ' — restart Wan2GP to take effect.', false)
    else setMemStatus('✗ ' + ((res && res.error) || 'apply failed'), true)
  } catch (e) { setMemStatus('✗ ' + e.message, true) }
  finally { btn.disabled = false; btn.textContent = 'Apply Overrides' }
})

// Load current memory settings whenever the Auto-Tune tab is opened.
const _origSettingsSwitch = window.__settingsSwitch
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.getAttribute('data-tab') === 'autotune') setTimeout(memProfileLoad, 120)
  })
})

  // ── Auto-Tune: failsafe toggle → re-render recommendation live ──
  $('autotuneFailsafeChk').addEventListener('change', async () => {
  const status = $('autotuneStatus')
  if (!_autotuneHardware) {
    // Nothing detected yet — tell the user Detect will honor it.
    status.className = ''
    status.style.background = 'var(--bg-tertiary)'
    status.innerHTML = $('autotuneFailsafeChk').checked
      ? '⚠️ Failsafe enabled — run <strong>Detect</strong> to see the P5 recommendation.'
      : 'Failsafe off — run <strong>Detect</strong> when ready.'
    return
  }
  try {
    const rec = await window.w2gp.autoTuneRecommend(_autotuneHardware, { failsafe: $('autotuneFailsafeChk').checked })
    _autotuneRecommendation = rec
    renderAutoTuneRecommendation(rec)
    // Re-seed the editable Adjuster fields with the (P5) recommendation.
    memProfileFromRecommendation(rec)
    status.className = ''
    status.style.background = 'var(--bg-tertiary)'
    status.innerHTML = $('autotuneFailsafeChk').checked
      ? '⚠️ Failsafe mode active — P5 (maximum compatibility) selected. Apply to write it.'
      : 'ℹ️ Failsafe mode off — standard matrix recommendation restored.'
  } catch (e) {
    status.className = ''
    status.style.background = '#3A1E1E'
    status.innerHTML = '❌ Failsafe toggle failed: ' + escHtml(e.message)
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

// ── Silent settings auto-scan (D1) — runs once at dashboard load ──
async function silentSettingsRepair() {
  try {
    const r = await window.w2gp.repairSettings()
    if (!r || !r.success) {
      if (r && r.error) appendLog('[i] Settings auto-scan skipped: ' + r.error)
      return
    }
    const modelFixed = r.modelPaths && r.modelPaths.fixed && r.modelPaths.replacements.length
    if (r.fixed > 0 || modelFixed) {
      if (r.fixed > 0) {
        appendLog(`[✓] Auto-repaired ${r.fixed} out-of-range setting value(s) (${r.scanned} file(s) scanned).`)
        showToast('✓ Auto-repaired ' + r.fixed + ' setting value(s)')
      }
      if (modelFixed) {
        appendLog(`[✓] Fixed ${r.modelPaths.replacements.length} nested model path(s) in wgp_config.json (issue #18 class).`)
        r.modelPaths.replacements.forEach(x => appendLog('[✓]   ' + x.key + ': ' + x.from + ' → ' + x.to))
        if (r.fixed === 0) showToast('✓ Fixed nested model paths')
      }
    }
    // Quiet when nothing was wrong — auto-scan must never nag.
  } catch {}
}

// ── Repair Settings (Manage → General) — fixes "Value: N is not in the list of choices" ──
$('repairSettingsBtn')?.addEventListener('click', async function() {
  this.disabled = true
  this.textContent = 'Scanning...'
  appendLog('[*] Scanning settings files for out-of-range values...')
  try {
    const r = await window.w2gp.repairSettings()
    if (r && r.success) {
      if (r.fixed > 0) {
        appendLog(`[✓] Repaired ${r.fixed} out-of-range value(s) across ${r.scanned} settings file(s).`)
        r.results.filter(x => x.fixed).forEach(x => appendLog('[✓]   ' + x.file + ' — ' + x.fixed + ' fixed (backup: ' + x.backup + ')'))
        showToast('✓ Settings repaired (' + r.fixed + ' values)')
      } else {
        appendLog(`[i] No problems found — scanned ${r.scanned} settings file(s).`)
        showToast('✓ Settings OK — nothing to repair')
      }
      if (r.problems && r.problems.length) {
        appendLog('[!] Could not read some files (skipped):')
        r.problems.forEach(p => appendLog('[!]   ' + p.file + ' — ' + p.error))
      }
      if (r.modelPaths && r.modelPaths.fixed && r.modelPaths.replacements.length) {
        appendLog(`[✓] Fixed ${r.modelPaths.replacements.length} nested model path(s) in wgp_config.json:`)
        r.modelPaths.replacements.forEach(x => appendLog('[✓]   ' + x.key + ': ' + x.from + ' → ' + x.to))
        showToast('✓ Model paths repaired')
      }
    } else {
      appendLog('[!] ' + ((r && r.error) || 'Repair failed'))
      showToast('✗ ' + ((r && r.error) || 'Repair failed'))
    }
  } catch (e) {
    appendLog('[!] Repair error: ' + e.message)
    showToast('✗ ' + e.message)
  } finally {
    this.disabled = false
    this.textContent = 'Scan & Repair Settings'
  }
})

// ── Report an issue (Manage → About) — bundles diagnostics + prefills GitHub issue ──
$('reportIssueBtn')?.addEventListener('click', async function() {
  this.disabled = true
  this.textContent = 'Bundling diagnostics...'
  appendLog('[*] Gathering diagnostics...')
  try {
    const r = await window.w2gp.reportIssue()
    if (r && r.success) {
      appendLog('[✓] Diagnostic bundle created (' + r.logLines + ' log lines' + (r.hadErrorQueue ? ', crash diagnostics included' : '') + ').')
      appendLog('[✓] Bundle: ' + (r.zipPath || r.bundleDir))
      appendLog('[i] A GitHub issue has been opened pre-filled with your system info — attach the bundle zip to it.')
      showToast('✓ Diagnostics bundled — issue opened')
    } else {
      appendLog('[!] ' + ((r && r.error) || 'Failed to create diagnostics'))
      showToast('✗ ' + ((r && r.error) || 'Failed to create diagnostics'))
    }
  } catch (e) {
    appendLog('[!] Report-issue error: ' + e.message)
    showToast('✗ ' + e.message)
  } finally {
    this.disabled = false
    this.textContent = '🐞 Report an issue…'
  }
})

// ── Uninstall Wan2GP (Manage → General → danger section) ──
$('uninstallBtn')?.addEventListener('click', async function() {
  this.disabled = true
  this.textContent = 'Uninstalling...'
  appendLog('[*] Uninstalling Wan2GP...')
  try {
    const r = await window.w2gp.uninstall()
    if (r && r.cancelled) {
      appendLog('[*] Uninstall cancelled.')
    } else if (r && r.success) {
      appendLog('[✓] Wan2GP uninstalled.')
      if (r.keptFiles && r.keptPaths && r.keptPaths.length) {
        appendLog('[i] Kept your files (checkpoints, LoRAs, output):')
        r.keptPaths.forEach(p => appendLog('[i]   ' + p))
        appendLog('[i] Reinstalling will reuse them automatically.')
      }
      if (r.leftoverFolder) {
        appendLog('[i] The empty folder could not be deleted (locked by a process open in it):')
        appendLog('[i]   ' + r.leftoverFolder)
        appendLog('[i] Close any terminal/Explorer window open in it and delete it manually.')
      }
      showToast('✓ Wan2GP uninstalled' + (r.keptFiles ? ' (files kept)' : '') + (r.leftoverFolder ? ' (empty folder left)' : ''))
      setLaunchButtonsInstalled(false)
      show('dashboard'); refreshDashboard()
    } else {
      appendLog('[!] Uninstall failed: ' + ((r && r.error) || 'unknown'))
      showToast('✗ ' + ((r && r.error) || 'Uninstall failed'))
    }
  } catch (e) {
    appendLog('[!] Uninstall error: ' + e.message)
    showToast('✗ ' + e.message)
  } finally {
    this.disabled = false
    this.textContent = 'Uninstall Wan2GP…'
  }
})
