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
  if (logBuffer.length > MAX_LOG) logBuffer.splice(0, logBuffer.length - MAX_LOG)
  scheduleTerminalRender()
}

const termFollow = { termBody: true, ftTermBody: true, installTermBody: true }
const termAutoScroll = {}
const termDirty = {}

const termText = {}
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
    // Dirty-check: skip the textContent write when the text hasn't changed.
    if (termText[id] !== text) { termText[id] = text; el.textContent = text }
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
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); $(id).classList.add('active')
  // Flush console output buffered while the terminal was offscreen (e.g. the
  // post-install show('dashboard') would otherwise leave the Console card
  // empty until the next log line arrives).
  if (Object.values(termDirty).some(Boolean)) renderTerminals()
}
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
    showToast(el.checked ? 'Update check on launch enabled' : 'Update check on launch disabled — updates only via "Check for updates"')
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
    if ($('claudeApiKeyInput')) $('claudeApiKeyInput').value = cfg.claudeApiKey || ''
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
    // GGUF CUDA kernel controls
    const g = cfg.ggufEnv || { enabled: true, matmulMode: 'auto', streamK: true, bf16Fp16: false }
    if ($('ggufEnabled')) $('ggufEnabled').checked = g.enabled !== false
    if ($('ggufMatmulMode')) $('ggufMatmulMode').value = g.matmulMode || 'auto'
    if ($('ggufStreamK')) $('ggufStreamK').checked = g.streamK !== false
    if ($('ggufBf16Fp16')) $('ggufBf16Fp16').checked = g.bf16Fp16 === true
    // GPU device picker: fill the dropdown from the main process, keep current choice
    loadGpuDeviceOptions(cfg.gpuDevice || 'auto')
    // Bind Address picker: reflect saved choice (default localhost)
    const sn = $('serverNameSelect')
    if (sn) sn.value = (cfg.serverName === '127.0.0.1') ? '127.0.0.1' : 'localhost'
  })
  loadBrowserList()
  // Check hf_xet install status
  updateXetStatus()
  // Show current uv wheel cache size
  refreshUvCacheInfo()
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
  // Start with a clean Desktop-Updates indicator — it's only set when a check
  // reports an available update, so clear any stale dot from a prior render.
  setDesktopUpdateIndicator(false)
  const installed = await window.w2gp.checkInstalled()

  // If the launcher renderer just crashed and was auto-reloaded, restore the
  // UI state (embedded Wan2GP view / browser mode) instead of the bare dashboard.
  await checkCrashRecovery()

  window.w2gp.getDesktopVersion().then(function(v) {
    if (!v) return
    document.title = 'Wan2GP Desktop Launcher v' + v
    var verEl = $('settingsVersionNum')
    if (verEl) verEl.textContent = v
    var appVerEl = $('appVersionTag')
    if (appVerEl) appVerEl.textContent = 'v' + v
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

  // Embedded-Wan2GP view crashed and was auto-reloaded by the main process.
  window.w2gp.onBvCrashRecovered(() => showToast('Wan2GP view reloaded after a crash'))

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
      if (!hp) return
      var list = $('installPkgsList')
      var header = $('installPkgsProfile')
      if (list && hp.packages && hp.packages.length) {
        if (header) header.textContent = '(' + hp.profile.replace(/_/g,' ') + ')'
        list.innerHTML = hp.packages.map(function(p) { return '<span class="ipkg-item">' + escHtml(p) + '</span>' }).join('')
        $('installPkgs').style.display = ''
      }
      // Distinct kernel-wheels group (so the wheels are clearly visible pre-install)
      var klist = $('installKernelsList')
      var kheader = $('installKernelsProfile')
      if (klist && hp.kernels && hp.kernels.length) {
        if (kheader) kheader.textContent = '(' + hp.profile.replace(/_/g,' ') + ')'
        klist.innerHTML = hp.kernels.map(function(k) {
          return '<div class="ikernel-item"><span class="ikernel-label">' + escHtml(k.label) + '</span><span class="ikernel-dist">' + escHtml(k.dist) + '</span></div>'
        }).join('')
        $('installKernels').style.display = ''
      }
      // GPU Profile Overview — installer only (different screen; the dashboard
      // consolidates detected versions + kernel wheels into the env_uv card).
      renderProfileOverview(hp.detail, {
        box: 'installProfileOverview', profile: 'ipoProfile',
        python: 'ipoPython', torch: 'ipoTorch', triton: 'ipoTriton',
        sage: 'ipoSage', sparge: 'ipoSparge', flash: 'ipoFlash', kernels: 'ipoKernels'
      })
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
    if ($('valRam')) $('valRam').textContent = m.ramUsed != null ? m.ramUsed + '/' + m.ramTotal : '—'
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
  // Pause the 2s nvidia-smi sampling while the window is hidden/minimized;
  // resume with an immediate tick on visibility.
  if (!window.__metricsVisBound) {
    window.__metricsVisBound = () => {
      if (document.hidden) {
        if (window.__metricsTimer) { clearInterval(window.__metricsTimer); window.__metricsTimer = null }
      } else if (!window.__metricsTimer) {
        startMetricsPolling()
      }
    }
    document.addEventListener('visibilitychange', window.__metricsVisBound)
  }
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
  poll()  // immediate tick on (re)start
  window.__wangpPollTimer = setInterval(poll, WANGP_POLL_MS)
  // Same visibility pause/resume as startMetricsPolling.
  if (!window.__wangpVisBound) {
    window.__wangpVisBound = () => {
      if (document.hidden) {
        if (window.__wangpPollTimer) { clearInterval(window.__wangpPollTimer); window.__wangpPollTimer = null }
      } else if (!window.__wangpPollTimer) {
        startWangpPolling()
      }
    }
    document.addEventListener('visibilitychange', window.__wangpVisBound)
  }
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

// When the user picks a bare drive root (e.g. D:), we DON'T apply it (installing
// on a root fails). Instead we show a cross + message on the Install button.
// Cleared as soon as a valid folder is chosen.
let _pendingRoot = null

function reflectRootBlock(rootPath) {
  const set = (id, val) => { const e = $(id); if (e) { e.textContent = breakPath(val) || '—'; e.title = val || '' } }
  set('installAppDataPath', rootPath)
  const startBtn = $('installStartBtn')
  const rootWarn = $('installRootWarn')
  if (startBtn) { startBtn.disabled = true; startBtn.title = 'Choose a folder, not a drive root.' }
  if (rootWarn) {
    rootWarn.textContent = '⚠ Install location is a drive root (' + rootPath + '). Pick a folder using Browse.'
    rootWarn.classList.remove('hidden')
  }
}

$('browseAppDataPath')?.addEventListener('click', async () => {
  const folder = await window.w2gp.selectFolder()
  if (!folder) return
  // Bare drive root: can't install on it, but offer to use <root>\Wan2GP so the
  // user doesn't have to re-browse. Accept -> apply; Cancel -> keep the block.
  if (isDriveRoot(folder)) {
    const suggested = pathJoin(folder, 'Wan2GP')
    if (window.confirm('You selected a drive root (' + folder + '). Installing directly on a drive root is not allowed.\n\nInstall into ' + suggested + ' instead?')) {
      const res = await window.w2gp.setDataDir(suggested)
      if (res && res.ok === false && res.error === 'drive-root') { _pendingRoot = suggested; reflectRootBlock(suggested); return }
      _pendingRoot = null
      loadPaths()
    } else {
      _pendingRoot = folder
      reflectRootBlock(folder)
    }
    return
  }
  _pendingRoot = null
  const res = await window.w2gp.setDataDir(folder)
  if (res && res.ok === false && res.error === 'drive-root') {
    _pendingRoot = folder
    reflectRootBlock(folder)
    return
  }
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
  // Persist BOTH: the user-facing choice (desktop-config.json, for the UI) AND
  // the file Wan2GP actually reads (wgp_config.json). Previously only the former
  // was written, so the Settings slider was cosmetic and downloads ignored it
  // (issue #74, "Model folders" always reverted to C:\Wan2GP-Models on refresh).
  if (type === 'ckpts') await window.w2gp.writeWgpConfig({ checkpointsPaths: [folder, '.'] })
  else if (type === 'loras') await window.w2gp.writeWgpConfig({ lorasRoot: folder })
  else await window.w2gp.writeWgpConfig({ savePath: folder })
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
  const def = (p?.modelsDefault ? pathJoin(p.modelsDefault, 'ckpts') : '(default)')
  setModelPath('ckpts', '')
  const el = $('installCkptsPath')
  if (el) { el.textContent = def; el.style.color = 'var(--text-tertiary)' }
  // Reset the real config too, so the UI and Wan2GP stay in sync (issue #74).
  await window.w2gp.writeWgpConfig({ checkpointsPaths: [def, '.'] })
  const cfg = await window.w2gp.configLoad()
  delete cfg.modelCkptsPath
  await window.w2gp.configSave(cfg)
})
$('clearLorasPath')?.addEventListener('click', async () => {
  const p = await window.w2gp.getInstallPaths()
  const def = (p?.modelsDefault ? pathJoin(p.modelsDefault, 'loras') : '(default)')
  setModelPath('loras', '')
  const el = $('installLorasPath')
  if (el) { el.textContent = def; el.style.color = 'var(--text-tertiary)' }
  await window.w2gp.writeWgpConfig({ lorasRoot: def })
  const cfg = await window.w2gp.configLoad()
  delete cfg.modelLorasPath
  await window.w2gp.configSave(cfg)
})
$('browseOutputPath')?.addEventListener('click', () => browseModelFolder('output'))
$('clearOutputPath')?.addEventListener('click', async () => {
  const p = await window.w2gp.getInstallPaths()
  const def = (p?.modelsDefault ? pathJoin(p.modelsDefault, 'outputs') : '(default)')
  setModelPath('output', '')
  const el = $('installOutputPath')
  if (el) { el.textContent = def; el.style.color = 'var(--text-tertiary)' }
  await window.w2gp.writeWgpConfig({ savePath: def })
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
  } else if (mode === 'update') {
    $('installSubtitle').textContent='Update instead of fresh install...'
    skipClone = true
  } else {
    // Fresh install (startInstall passes no mode): clone the repo normally —
    // previously this branch treated fresh installs as updates, showing
    // "Update instead of fresh install..." and marking the clone task done
    // before it had even run.
    skipClone = false
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
  // Show a visible error note if the status call failed (so the panel is never
  // silently blank — this is exactly the blank-dashboard bug we hit before).
  const errNote = $('envDetailError')
  if (errNote) errNote.style.display = (status.error) ? '' : 'none'
  if(status.error||!status.env){
    if (errNote) errNote.textContent = 'Could not read environment status: ' + (status.error || 'no active environment')
    $('envName').textContent='No active environment'
    $('envNameHint')?.classList.remove('hidden')
    document.querySelectorAll('.pkg-install-btn, .spec-latest, .spec-update-btn').forEach(function(el) { el.remove() })
    ;['specPython','specTorch','specCuda','specTriton','specSage','specFlash','specDiffusers','specTransformers','specGradio','specAccelerate','specOnnx','specOpencv','specPeft','specHfhub','specBits','specNumpy','specTokenizers','specSparge'].forEach(id=>{ const el=$(id); if(el) el.textContent='—' })
    ;['dotPython','dotTorch','dotCuda','dotTriton','dotSage','dotFlash','dotDiffusers','dotTransformers','dotGradio','dotAccelerate','dotOnnx','dotOpencv','dotPeft','dotHfhub','dotBits','dotNumpy','dotTokenizers'].forEach(id=>{ const el=$(id); if(el) el.classList.remove('installed') })
    // Kernel wheels section is independent — keep it rendered from whatever we got.
    renderKernelWheels(status.kernelWheels, status.kernelProfile, status.osKey)
    const spargeEl = $('specSparge'); if (spargeEl) spargeEl.textContent = '—'
  } else {
    $('envName').textContent=status.env.name; $('envType').textContent=status.env.type
    $('envNameHint')?.classList.add('hidden')
    // Clear old update/install buttons before re-creating
    document.querySelectorAll('.spec-latest, .spec-update-btn, .pkg-install-btn').forEach(function(el) { el.remove() })

    function setSpec(specId, dotId, val, pkgName) {
      const el=$(specId); if(el) el.textContent=val||'—'
      const dot=$(dotId); if(dot){ if(val) { dot.classList.remove('has-update','error','installing'); dot.classList.add('installed') } else dot.classList.remove('installed') }
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
    // If the version query itself failed, show the reason in the note but keep
    // the wheels/paths sections alive (they're independent of the version scan).
    if (status.versions && status.versions.error) {
      const errNote = $('envDetailError')
      if (errNote) { errNote.style.display = ''; errNote.textContent = 'Package scan failed: ' + status.versions.error }
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

    // ── GPU Kernel Wheels (profile-driven) ──
    renderKernelWheels(status.kernelWheels, status.kernelProfile, status.osKey)
    // Sparge Attn comes from the expected GPU profile (not a detected version),
    // so it's surfaced here to avoid a separate duplicate "GPU Profile Overview".
    const spargeEl = $('specSparge')
    if (spargeEl) spargeEl.textContent = (status.profile && status.profile.sparge) ? status.profile.sparge : '—'
  }
  const list=$('envList'); list.innerHTML=''
  envs.forEach(e=>{
    const div=document.createElement('div')
    div.className='env-list-item'+(e.active?' active':'')
    div.innerHTML=`<span class="env-dot"></span><span class="env-list-name">${escHtml(e.name)}</span><span style="font-size:0.65rem;color:#666;flex-shrink:0">${escHtml(e.type)}</span>`
    if(!e.active) {
      div.setAttribute('role','button')
      div.tabIndex = 0
      const activate = async()=>{ await window.w2gp.manageSetActive(e.name); refreshDashboard() }
      div.addEventListener('click', activate)
      div.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); activate() }
      })
    }
    list.appendChild(div)
  })
  loadWangpChangelog()
  loadPaths()
  loadModelPaths()
  document.querySelectorAll('.env-detail .spec-row').forEach(function(r) { r.classList.remove('has-update','up-to-date') })
  $('checkPkgUpdatesBtn').textContent = '↻ Check Updates'
  $('checkPkgUpdatesBtn').disabled = false
  refreshEnvUnlink()
  // Warn if model checkpoints/LoRAs still live in a roaming AppData profile.
  checkModelsPathWarning()
  // Warn RTX 40/50 users still on the broken fp8 SageAttention wheel to sync.
  checkSageSyncBanner(status)
  // Refresh the guided LLM engine cards (Deepy Prime setup).
  refreshLLMEngines().catch(() => {})
  // Refresh the Deepy Prime activation panel.
  refreshDeepy().catch(() => {})
  // Enable/disable no-GPU button based on Chrome availability
  ;(async () => {
    const available = await window.w2gp.chromeAvailable()
    const btn = $('browserNoGpuBtn')
    const hint = $('noGpuHint')
    if (btn) btn.disabled = !available
    if (hint) hint.style.display = available ? 'none' : 'block'
  })()
}

// ── Model-path warning ──
// Shows a dashboard banner when the configured checkpoints/LoRAs/output paths
// resolve under the roaming AppData profile (a bad place for huge model files).
async function checkModelsPathWarning() {
  const banner = $('modelsWarnBanner')
  if (!banner) return
  if (banner.dataset.dismissed === '1') { banner.classList.add('hidden'); return }
  try {
    const [paths, ip] = await Promise.all([window.w2gp.getModelPaths(), window.w2gp.getInstallPaths()])
    if (!paths || !ip) { banner.classList.add('hidden'); return }
    const appDataRoot = (ip.appDataRoot || '').toLowerCase().replace(/\\/g, '/')
    const bad = appDataRoot && [paths.checkpoints, paths.loras, paths.output]
      .filter(Boolean)
      .some(p => (p || '').toLowerCase().replace(/\\/g, '/').startsWith(appDataRoot))
    banner.classList.toggle('hidden', !bad)
    // Top warning banner: show its "Migrate to new location" button when a legacy
    // roaming data dir exists — this is the in-launcher entry point the user wants.
    const migrateBtn = $('modelsWarnMigrateBtn')
    if (migrateBtn) migrateBtn.classList.toggle('hidden', !ip.legacyRoamingFound)
  } catch { banner.classList.add('hidden') }
}
$('modelsWarnMigrateBtn')?.addEventListener('click', () => openMigrationModal())
$('modelsWarnDismissBtn')?.addEventListener('click', () => {
  const b = $('modelsWarnBanner')
  if (b) { b.classList.add('hidden'); b.dataset.dismissed = '1' }
})

// ── SageAttention broken-wheel banner ──
// RTX 40/50 users who updated the launcher but haven't yet run Kernel sync are
// still on the upstream `cu130torch2.9.0andhigher` SageAttention wheel, whose fp8
// PV kernel corrupts the CUDA context under torch 2.10 (false OOM / stalling).
// The launcher's setSageAttentionSafe() swaps it for the stable cu128 build on
// install / update / Kernel sync. Until they sync, show a top banner telling
// them to click Sync Kernels. Only RTX 40/50 are affected (RTX 30 routes to the
// safe Triton fp16 kernel, RTX 20/older use Sage v1 — neither needs this).
const SAGE_BROKEN = /cu130torch2\.9\.0andhigher/
function checkSageSyncBanner(status) {
  const banner = $('sageSyncBanner')
  if (!banner) return
  if (banner.dataset.dismissed === '1') { banner.classList.add('hidden'); return }
  try {
    const profile = status?.kernelProfile
    const sage = status?.versions?.sageattention || status?.versions?.spas_sage_attn || ''
    const affected = (profile === 'RTX_40' || profile === 'RTX_50')
    const brokenWheel = SAGE_BROKEN.test(sage)
    const show = !!(affected && brokenWheel)
    banner.classList.toggle('hidden', !show)
  } catch { banner.classList.add('hidden') }
}
$('sageSyncBtn')?.addEventListener('click', async () => {
  const banner = $('sageSyncBanner')
  const btn = $('sageSyncBtn')
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…' }
  try {
    const r = await window.w2gp.syncKernels()
    if (r && r.success) {
      if (banner) { banner.classList.add('hidden'); banner.dataset.dismissed = '1' }
      refreshDashboard()
    } else {
      if (btn) { btn.disabled = false; btn.textContent = 'Sync Kernels' }
    }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Sync Kernels' }
    alert('Kernel sync failed: ' + (e?.message || e))
  }
})
$('sageSyncDismissBtn')?.addEventListener('click', () => {
  const b = $('sageSyncBanner')
  if (b) { b.classList.add('hidden'); b.dataset.dismissed = '1' }
})

// ── GPU Kernel Wheels (profile-driven, subsection of Active Environment) ──
// Renders the wheels resolved from setup_config.json for the active GPU:
// each row shows ✓ (current) / ⚠ (installed, mismatch) / ✗ (not installed).
// Shows the EXACT configured version (e.g. nunchaku 0.3.1) and an "update
// available" hint when the installed wheel is older than the profile declares.
// GTX 10/16, AMD, Apple profiles carry no kernels → the subsection hides.
function renderKernelWheels(wheels, kernelProfile, osKey) {
  const card = $('kernelWheelsSubsection')
  const box = $('kernelWheels')
  const tag = $('kernelProfileTag')
  if (!card || !box) return
  const list = Array.isArray(wheels) ? wheels : []
  if (!list.length) {
    // Distinguish "no GPU profile" (genuinely nothing to show) from a data
    // error so the user isn't left staring at a blank section.
    if (kernelProfile === null || kernelProfile === undefined || kernelProfile === 'unknown') {
      box.innerHTML = '<div class="kw-empty">No GPU kernel profile detected — wheels are managed automatically for this GPU.</div>'
    } else {
      box.innerHTML = '<div class="kw-empty">This GPU profile has no dedicated kernel wheels.</div>'
    }
    card.style.display = ''   // keep the card; show the friendly note
    if (tag) tag.textContent = kernelProfile || '—'
    return
  }
  card.style.display = ''
  if (tag && kernelProfile) tag.textContent = kernelProfile
  box.innerHTML = ''
  list.forEach(w => {
    const row = document.createElement('div')
    row.className = 'spec-row'
    const dot = document.createElement('span')
    dot.className = 'spec-dot'
    const state = w.state || (w.installed ? (w.installed === w.configured ? 'ok' : 'mismatch') : 'missing')
    dot.classList.add(state === 'ok' ? 'installed' : (state === 'mismatch' ? 'error' : ''))
    const label = document.createElement('span')
    label.className = 'spec-label'
    label.textContent = w.label
    const val = document.createElement('span')
    val.className = 'spec-value'
    if (state === 'ok') {
      val.textContent = w.installed
    } else if (state === 'mismatch') {
      val.textContent = w.installed
      // "update available": installed wheel is older than the profile declares.
      const badge = document.createElement('span')
      badge.className = 'kw-update'
      badge.textContent = ` ↑ ${w.configured}`
      val.appendChild(badge)
    } else {
      val.textContent = `not installed (want ${w.configured || '?'})`
    }
    row.appendChild(label); row.appendChild(dot); row.appendChild(val)
    box.appendChild(row)
  })
}

// ── GPU Profile Overview (mirrors setup_config.json gpu_profiles) ──
// Renders the resolved profile's python/torch/attention-kernel matrix in BOTH
// the installer and the dashboard from a single `detail` object, so the two
// views can never disagree. `ids` maps each field to a DOM element id.
function renderProfileOverview(detail, ids) {
  const box = $(ids.box)
  if (!box) return
  if (!detail) { box.style.display = 'none'; return }
  box.style.display = ''
  if (ids.profile) { const t = $(ids.profile); if (t) t.textContent = (detail.profile || '').replace(/_/g, ' ') }
  const set = (id, val) => { const el = $(id); if (el) el.textContent = val || '—' }
  set(ids.python, detail.python)
  set(ids.torch, detail.torch)
  set(ids.triton, detail.triton)
  set(ids.sage, detail.sage)
  set(ids.sparge, detail.sparge)
  set(ids.flash, detail.flash)
  set(ids.kernels, (detail.kernels && detail.kernels.length) ? detail.kernels.join(', ') : '—')
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

const _labelToKey = {'Python':'python','Torch':'torch','CUDA':'cuda','Triton':'triton','Sage Attn':'sageattention','Flash Attn':'flash_attn','Diffusers':'diffusers','Transformers':'transformers','Gradio':'gradio','Accelerate':'accelerate','onnxruntime':'onnxruntime','OpenCV':'opencv','PEFT':'peft','hf_hub':'huggingface_hub','NumPy':'numpy','Tokenizers':'tokenizers'}

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
      // Clear stale dot state (e.g. 'error' from a failed upgrade) when the
      // check now reports the package is installed & current.
      const dot = row.querySelector('.spec-dot')
      if (dot) { dot.classList.remove('installing','has-update','error'); dot.classList.add('installed') }
    }
  })
  showToast(updateCount > 0 ? updateCount + ' updates available' : 'All packages up to date')
})

// ── GPU Kernel Wheels: Sync button ──
// Reinstalls every kernel wheel the active GPU's profile declares. Streams to
// the Console; refreshes the dashboard when done so versions update live.
$('syncKernelsBtn')?.addEventListener('click', async function() {
  if (this.disabled) return
  this.disabled = true
  this.textContent = 'Syncing...'
  try {
    const r = await window.w2gp.syncKernels()
    if (r && r.success) showToast('✓ Kernel wheels synced')
    else showToast('✗ Sync failed: ' + (r && r.error ? r.error : 'unknown'))
  } catch (e) {
    showToast('✗ Sync failed: ' + e.message)
  } finally {
    this.disabled = false
    this.textContent = '↻ Sync'
    setTimeout(refreshDashboard, 1500)
  }
})

async function loadModelPaths() {
  const paths = await window.w2gp.getModelPaths()
  $('dashCkptPath').textContent = breakPath(paths?.checkpoints) || '(default)'; $('dashCkptPath').title = paths?.checkpoints || ''
  $('dashLoraPath').textContent = breakPath(paths?.loras) || '(default)'; $('dashLoraPath').title = paths?.loras || ''
  $('dashOutputPath').textContent = breakPath(paths?.output) || '(default)'; $('dashOutputPath').title = paths?.output || ''
}

// When changing a model folder via the pencil, ask whether to physically MOVE
// the existing files (so nothing is re-downloaded) or just point Wan2GP at the
// new (empty) location. Then write wgp_config.json accordingly.
async function changeModelFolder(type, key, cfgKey, singular) {
  const dir = await window.w2gp.selectFolder()
  if (!dir) return
  const cur = await window.w2gp.getModelPaths().then(p => ({ ckpts: p?.checkpoints, loras: p?.loras, output: p?.output })[type])
  if (cur && cur.toLowerCase() === dir.toLowerCase()) { window.w2gp.openFolder(dir); return }
  const choice = await window.w2gp.confirmDialog({
    title: 'Move ' + singular + '?',
    message: 'Change ' + singular + ' folder to:\n  ' + dir,
    detail: cur
      ? 'Do you want to MOVE the existing files from the old location into the new folder, or just point Wan2GP at the new (empty) folder?\n\nOld: ' + cur
      : 'Point Wan2GP at the new folder?',
    buttons: cur ? ['Move existing files', 'Just point (no move)', 'Cancel'] : ['OK', 'Cancel'],
    defaultId: cur ? 0 : 0,
    cancelId: cur ? 2 : 1
  })
  if (choice === 'cancel') { window.w2gp.openFolder(dir); return }
  if (choice === 'move' && cur) {
    const r = await window.w2gp.moveFolder(cur, dir)
    if (!r || !r.ok) { alert('Could not move files:\n' + (r && r.error || 'unknown')) }
  }
  // Write the real config (what Wan2GP reads) so the change takes effect next launch.
  const patch = {}
  patch[key] = (type === 'ckpts') ? [dir, '.'] : dir
  await window.w2gp.writeWgpConfig(patch)
  const cfg = await window.w2gp.configLoad()
  if (type === 'ckpts') cfg.modelCkptsPath = dir
  else if (type === 'loras') cfg.modelLorasPath = dir
  else cfg.modelOutputPath = dir
  await window.w2gp.configSave(cfg)
  await loadModelPaths()
  showToast('✓ ' + singular + ' folder updated — restart Wan2GP to apply')
}

$('dashBrowseCkpt').addEventListener('click', () => changeModelFolder('ckpts', 'checkpointsPaths', 'checkpoints', 'Checkpoints'))
$('dashBrowseLora').addEventListener('click', () => changeModelFolder('loras', 'lorasRoot', 'loras', 'LoRAs'))
$('dashBrowseOutput').addEventListener('click', () => changeModelFolder('output', 'savePath', 'output', 'Output'))

$('desktopRepoLink').addEventListener('click', (e) => {
  e.preventDefault()
  window.w2gp.openExternal('https://github.com/GKartist75/wan2gp-desktop')
})
$('discussionsLink').addEventListener('click', (e) => {
  e.preventDefault()
  window.w2gp.openExternal('https://github.com/GKartist75/wan2gp-desktop/discussions')
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
  set('installAppDataPath', p.appData)
  // Guard: if the chosen install location is a bare drive root (e.g. D:\),
  // the install is invalid — disable the Install button and warn the user.
  const rootBad = isDriveRoot(p.appData)
  const startBtn = $('installStartBtn')
  const rootWarn = $('installRootWarn')
  if (rootBad) {
    if (startBtn) { startBtn.disabled = true; startBtn.title = 'Choose a folder, not a drive root.' }
    if (rootWarn) { rootWarn.textContent = '⚠ Install location is a drive root (' + p.appData + '). Pick a folder using Browse.'; rootWarn.classList.remove('hidden') }
  } else {
    if (startBtn) { startBtn.disabled = false; startBtn.title = '' }
    if (rootWarn) rootWarn.classList.add('hidden')
  }
  // The top warning banner already owns the in-launcher "Migrate to new location"
  // button (shown when legacyRoamingFound), so keep this dashboard card button
  // hidden in that case to avoid two migration buttons. It only appears as a
  // manual re-trigger when there is no legacy roaming dir to migrate.
  const wrap = $('moveToPreferredWrap')
  if (wrap) {
    if (!p.legacyRoamingFound) {
      wrap.classList.remove('hidden')
      const cp = $('currentDataDirPath')
      if (cp) cp.textContent = p.appData
    } else {
      wrap.classList.add('hidden')
    }
  }
  window.w2gp.getDiskSpace().then(function(d) {
    if (!d) return;
    var freeGb = (d.free / 1073741824).toFixed(1);
    $('pathFreeSpace').textContent = freeGb + ' GB free';
  });
  if (!skipModelPaths) {
    // Show the model folders the user actually chose. Precedence: a previously
    // saved custom choice (desktop-config.json modelCkptsPath/…) wins; otherwise
    // the dedicated default (C:\\Wan2GP-Models). We used to ALWAYS overwrite with
    // the default here, which is why any custom path silently reverted to
    // C:\\Wan2GP-Models on every refresh (issue #74).
    const md = p.modelsDefault || p.appData
    let saved = {}
    try { saved = (await window.w2gp.configLoad()) || {} } catch {}
    const savedCkpts = saved.modelCkptsPath
    const savedLoras = saved.modelLorasPath
    const savedOutput = saved.modelOutputPath
    if (_modelCkpts || savedCkpts) setModelPath('ckpts', _modelCkpts || savedCkpts)
    else setModelPath('ckpts', pathJoin(md, 'ckpts'))
    if (_modelLoras || savedLoras) setModelPath('loras', _modelLoras || savedLoras)
    else setModelPath('loras', pathJoin(md, 'loras'))
    if (_modelOutput || savedOutput) setModelPath('output', _modelOutput || savedOutput)
    else setModelPath('output', pathJoin(md, 'outputs'))
  }
}
// Tiny path join that tolerates both separators in the renderer (no node path).
function pathJoin(a, b) { return (a || '').replace(/[\\/]+$/, '') + '\\' + b }
// True when the path is a bare drive root, e.g. "D:" or "D:\" (but not "D:\Wan2GP").
function isDriveRoot(p) {
  if (!p) return false
  const norm = (p || '').replace(/[\\/]+$/, '')
  return /^[A-Za-z]:$/.test(norm)
}

$('openAppDataBtn')?.addEventListener('click', () => {
  window.w2gp.getInstallPaths().then(function(p) { if (p) window.w2gp.openFolder(p.repo) })
})
// Move the entire Wan2GP install (no reinstall) — reuse the migration modal
// pre-filled with the current location as the source.
$('changeAppDataBtn')?.addEventListener('click', () => openMigrationModal())

// Per-folder "open" buttons (folder icon) for the three model paths.
$('openCkptBtn')?.addEventListener('click', () => window.w2gp.getModelPaths().then(p => p?.checkpoints && window.w2gp.openFolder(p.checkpoints)))
$('openLoraBtn')?.addEventListener('click', () => window.w2gp.getModelPaths().then(p => p?.loras && window.w2gp.openFolder(p.loras)))
$('openOutputBtn')?.addEventListener('click', () => window.w2gp.getModelPaths().then(p => p?.output && window.w2gp.openFolder(p.output)))

$('moveToPreferredBtn')?.addEventListener('click', () => openMigrationModal())

// ── Migration folder-chooser modal ──
// Opens a dialog pre-filled with our recommended targets (data dir + checkpoints
// + LoRAs + output). The user can override any of them, then "Move & restart"
// calls migrate-to-preferred with the chosen paths. After the move, main rewrites
// wgp_config.json model paths and relaunches.
let _migBusy = false
async function openMigrationModal() {
  if (_migBusy) return
  let prefs
  try { prefs = await window.w2gp.migrateChoose() } catch { prefs = null }
  if (!prefs) { alert('Could not determine migration targets.'); return }
  $('migDataDir').value = prefs.dataDir || ''
  $('migCkpts').value = prefs.ckpts || ''
  $('migLoras').value = prefs.loras || ''
  $('migOutput').value = prefs.output || ''
  // Context-aware copy: the modal is reused both for the first migration out of
  // a roaming AppData profile AND for later re-location of an already-migrated
  // install (e.g. C:\Wan2GP → D:\Wan2GP). Don't claim "AppData" when it isn't.
  const roaming = !!prefs.fromRoaming
  const cur = prefs.legacy || ''
  const title = $('migrationTitle')
  const sub = $('migrationSub')
  if (title) title.textContent = roaming
    ? 'Move Wan2GP out of AppData'
    : 'Move Wan2GP to a new location'
  if (sub) {
    sub.textContent = roaming
      ? 'Your Wan2GP data currently lives in your roaming AppData profile. Move it to a dedicated, fast drive — AppData is meant for small settings, not multi-GB model checkpoints (it can slow logins, trigger antivirus locks, and bloat your profile). Our recommended locations are pre-filled — change any of them if you like.'
      : 'Your Wan2GP is currently at ' + cur + '. Move it to a different drive or folder — your repo, venv, settings, and model folders travel with it. The recommended location is pre-filled — change it if you like.'
  }
  // Reset to idle state (in case a previous attempt left the progress UI showing).
  _migBusy = false
  const btn = $('migrationMoveBtn')
  if (btn) { btn.disabled = false; btn.textContent = 'Move & restart' }
  const prog = $('migrationProgress')
  if (prog) { prog.classList.add('hidden'); const f = $('migrationProgressFill'); if (f) f.style.width = '0%' }
  $('migrationModal').classList.remove('hidden')
}
$('migrationCloseBtn')?.addEventListener('click', () => $('migrationModal').classList.add('hidden'))
$('migrationCancelBtn')?.addEventListener('click', () => $('migrationModal').classList.add('hidden'))
// Browse buttons inside the modal pick a folder for the matching field.
document.querySelectorAll('#migrationModal [data-browse]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const key = btn.getAttribute('data-browse')
    const field = { dataDir: 'migDataDir', ckpts: 'migCkpts', loras: 'migLoras', output: 'migOutput' }[key]
    try {
      const picked = await window.w2gp.selectFolder()
      if (picked) $(field).value = picked
    } catch {}
  })
})
$('migrationMoveBtn')?.addEventListener('click', async () => {
  if (_migBusy) return
  _migBusy = true
  const btn = $('migrationMoveBtn')
  btn.disabled = true
  btn.textContent = 'Moving…'
  // Show the progress bar (hidden again on success/error below).
  const prog = $('migrationProgress')
  if (prog) { prog.classList.remove('hidden'); setMigrationProgress(0) }
  const choices = {
    dataDir: $('migDataDir').value,
    ckpts: $('migCkpts').value,
    loras: $('migLoras').value,
    output: $('migOutput').value
  }
  if (!choices.dataDir) { alert('Choose a Wan2GP data folder.'); resetMigrationUI(); return }
  // Don't allow a bare drive root (e.g. D:\) — the main process rejects it too,
  // but catch it here for an immediate, friendly message.
  if (isDriveRoot(choices.dataDir)) {
    alert('Install/move into a folder, not a drive root.\n\nPick a folder such as D:\\Wan2GP (use Browse if unsure), then Move & restart.')
    resetMigrationUI(); return
  }
  try {
    const r = await window.w2gp.migrateToPreferred(choices)
    if (r && r.ok) {
      btn.textContent = 'Restarting…'
    } else {
      alert('Could not move the data folder:\n' + ((r && r.error) || 'unknown error') +
            '\n\nClose any Wan2GP windows/terminals pointing at the old folder and try again.')
      resetMigrationUI()
    }
  } catch (e) {
    alert('Migration failed: ' + e.message)
    resetMigrationUI()
  }
})
// Show live copy progress (only the slow cross-volume/copy-fallback path emits
// this — the common instant rename path finishes before any paint).
function setMigrationProgress(pct) {
  const fill = $('migrationProgressFill'); if (fill) fill.style.width = pct + '%'
  const txt = $('migrationProgressText'); if (txt) txt.textContent = 'Moving… ' + pct + '%'
}
window.w2gp.onMigrationProgress?.(setMigrationProgress)
// Restore the modal to its idle state (re-enable button, hide progress).
function resetMigrationUI() {
  _migBusy = false
  const btn = $('migrationMoveBtn')
  if (btn) { btn.disabled = false; btn.textContent = 'Move & restart' }
  const prog = $('migrationProgress')
  if (prog) { prog.classList.add('hidden'); setMigrationProgress(0) }
}
// Startup prompt (main process) asks the renderer to open this modal.
window.w2gp.onOpenMigration?.(() => openMigrationModal());

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
    if (local && localEl) localEl.textContent = local.hash ? local.hash.substring(0, 7) : ''

    window.w2gp.getWangpVersion().then(v => { if (v && verEl) verEl.textContent = v })

    const upstream = await window.w2gp.getWangpUpstreamInfo()
    if (!upstream || !upstream.commits) {
      // A transient upstream failure on the silent periodic poll must not
      // clobber a previously rendered changelog — show the error only on an
      // explicit user check.
      if (showLoading) listEl.innerHTML = '<div class="changelog-error">Could not fetch updates</div>'
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
    window.w2gp.uiModeSet('browser')   // crash recovery: remember browser mode
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
  // Already running → re-open with the SAME no-GPU path (previously this
  // fell back to launchBrowser, silently re-enabling GPU acceleration).
  if (browserRunning && currentUrl) { await window.w2gp.launchBrowserNoGpu(currentUrl); return }
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
    window.w2gp.uiModeSet('browser')   // crash recovery: remember browser mode
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
    window.w2gp.uiModeSet('browser')   // crash recovery: remember browser mode
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
let appRunning = false     // desktop-mode (BrowserView) server currently up (button acts as "Back to…")

// ── Launch in App (BrowserView — renders Gradio reliably on Electron 40; intercepts
//     /manifest.json to dodge gradio#11553 blank-page bug) ──
$('appBtn').addEventListener('click', async () => {
  $('appBtn').disabled = true; $('appBtn').textContent = 'Starting...'
  $('launchInfo').classList.remove('hidden')

  try {
    const result = await window.w2gp.launchWebview()
    currentUrl = result.url
    const created = await window.w2gp.createBrowserView(result.url, { reload: !!result.fresh })
    if (!created || created.error) throw new Error(created && created.error ? created.error : 'failed to create embed')
    $('dashBody').style.display = 'none'
    $('webviewContainer').classList.remove('hidden')
    $('launchInfo').classList.add('hidden')
    showWebviewUI()
    updateLed('running')
    updateFtStatus('running')
    serverMode = 'app'
    appRunning = true
    setAppLaunchLabel()
    window.w2gp.uiModeSet('app')   // crash recovery: remember we are in Desktop mode
    if (browserRunning) resetBrowserLaunchUI()
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
    $('appBtn').disabled = false; setAppLaunchLabel()
  }
})

// Reflect whether the Wan2GP desktop (BrowserView) server is still up behind the
// dashboard: while it is, the launch button reads "Back to Wan2GP in Desktop".
function setAppLaunchLabel() {
  $('appBtn').textContent = appRunning ? 'Back to Wan2GP in Desktop' : 'Launch Wan2GP in Desktop'
}

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
  serverMode = null   // webview UI is gone; a later server exit must not re-close it
  window.w2gp.uiModeSet(null)
  // Server is still running behind the dashboard → the launch button becomes "Back to…"
  setAppLaunchLabel()
  appendLog('[*] Webview closed. Server still running.')
}

$('backToDashboardBtn').addEventListener('click', closeWebview)

// ── Crash recovery: put the UI back where it was after a renderer crash ──
// The main process auto-reloads the launcher renderer when it dies (usually a
// GPU/display-driver hiccup during generation). On this fresh load we ask what
// happened: if a crash just occurred and the Wan2GP server is still running,
// re-open the embedded view (Desktop mode) or re-arm the browser-mode UI
// instead of stranding the user on the bare dashboard.
async function checkCrashRecovery() {
  let info = null
  try { info = await window.w2gp.getCrashRecoveryInfo() } catch { return }
  if (!info || !info.pending) return
  appendLog(info.serverRunning
    ? `[i] Launcher UI recovered after a crash (${info.gpuProcessDied ? 'GPU/display-driver hiccup' : 'renderer crash'}). The Wan2GP server is still running.`
    : '[i] Launcher UI recovered after a crash. The Wan2GP server is not running.')
  if (info.serverRunning && info.mode === 'app' && info.url) {
    try {
      // Force a reload: after a renderer crash the embedded Gradio page may be in a
      // bad state, so re-open from a fresh load rather than re-attaching a live session.
      const created = await window.w2gp.createBrowserView(info.url, { reload: true })
      if (!created || created.error) throw new Error(created && created.error ? created.error : 'failed to re-create embed')
      $('dashBody').style.display = 'none'
      $('webviewContainer').classList.remove('hidden')
      showWebviewUI()
      updateLed('running')
      updateFtStatus('running')
      serverMode = 'app'
      appRunning = true
      setAppLaunchLabel()
      window.w2gp.uiModeSet('app')
      // Restore the floating console per the saved default dock, exactly like
      // the normal Desktop launch does.
      const cfg = await window.w2gp.configLoad()
      const dock = cfg.termDockDefault || 'bottom'
      if (dock === 'minimised') {
        if (!$('floatingTerminal').classList.contains('hidden')) closeFloatingTerm()
      } else {
        if ($('floatingTerminal').classList.contains('hidden')) toggleFloatingTerm()
        setFtDock(dock)
      }
      showToast('Launcher UI recovered — Wan2GP re-opened')
    } catch (e) {
      appendLog('[!] Could not re-open the embedded view after the crash: ' + e.message)
      $('dashBody').style.display = ''
      $('webviewContainer').classList.add('hidden')
      hideWebviewUI()
      serverMode = null
      try { await window.w2gp.destroyBrowserView() } catch {}
    }
  } else if (info.serverRunning && info.mode === 'browser') {
    browserRunning = true
    serverMode = 'browser'
    showBrowserRunningUI()
    $('browserBtn').textContent = 'Open Wan2GP in Browser'
    appendLog('[i] Browser-mode launch restored — server running.')
  } else {
    // Dashboard (or no server): detach any leftover BrowserView so it can't
    // composite above the dashboard after the crash.
    try { await window.w2gp.destroyBrowserView() } catch {}
  }
}

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
let _zoomDebounce = null
$('zoomSlider').addEventListener('input', () => {
  const pct = parseInt($('zoomSlider').value)
  $('zoomLabel').textContent = pct + '%'
  clearTimeout(_zoomDebounce)
  _zoomDebounce = setTimeout(() => window.w2gp.bvSetZoom(pct / 100), 120)
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
  window.w2gp.uiModeSet(null)
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
  appendLog(`${c === 0 ? '[*]' : '[!]'} Wan2GP process exited (code ${c})`)
  if (serverMode === 'app') {
    if (!$('webviewContainer').classList.contains('hidden')) closeWebview()
  } else if (serverMode === 'browser') {
    hideBrowserRunningUI()
    resetBrowserLaunchUI()
  }
  appRunning = false
  setAppLaunchLabel()
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
// Accept either a bare spec (claude-agent-sdk==0.1.40) or a full command
// (pip install claude-agent-sdk==0.1.40) pasted by the user — strip any leading
// pip invocation so both the preview and the real install behave identically.
// (Renderer is a plain browser script — no require — so this is inlined; the
// Node-side mirror lives in services/normalize-pip-spec.js for unit tests.)
function normalizePipSpec(raw) {
  let s = (raw || '').trim()
  const m = s.match(/^(?:py(?:thon)?\s+-m\s+)?pip\s+install\s+/i)
  if (m) s = s.slice(m[0].length).trim()
  return s
}
$('pipInstallBtn').addEventListener('click', async () => {
  const input = $('pipInput')
  const pkg = normalizePipSpec(input?.value)
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

// Live, copyable preview of the exact command the Advanced box will run.
// Mirrors the launcher's guard: a valid spec shows `pip install <spec>`; an
// invalid one shows the reason it would be blocked (no misleading command).
function updatePipCmdPreview() {
  const input = $('pipInput'); const preview = $('pipCmdPreview'); const text = $('pipCmdText')
  if (!input || !preview || !text) return
  const spec = normalizePipSpec(input.value)
  if (!spec) { preview.style.display = 'none'; return }
  // Reuse the same validation the launcher applies (kept in sync with main.js).
  const name = spec.split(/[<>=!~]/)[0].replace(/\s/g, '')
  const okName = /^[A-Za-z0-9._-]+$/.test(name) && /^[A-Za-z]/.test(name)
  const hasInjection = /[;&|<>$`(){}'"]/.test(spec) || /\s-{1,2}[a-zA-Z]/.test(spec)
  if (!okName) { preview.style.display = 'flex'; preview.classList.add('pip-cmd-bad'); text.textContent = '✗ Invalid package name' }
  else if (hasInjection) { preview.style.display = 'flex'; preview.classList.add('pip-cmd-bad'); text.textContent = '✗ Flags/shell characters are blocked for safety' }
  else { preview.style.display = 'flex'; preview.classList.remove('pip-cmd-bad'); text.textContent = 'pip install ' + spec + '   (runs in the active env)' }
}
$('pipInput').addEventListener('input', updatePipCmdPreview)
$('pipCmdCopy')?.addEventListener('click', async () => {
  const t = $('pipCmdText')?.textContent || ''
  if (!t.startsWith('pip install')) return
  try { await navigator.clipboard.writeText(t.split('   (')[0]); $('pipCmdCopy').textContent = 'copied!'; setTimeout(() => { $('pipCmdCopy').textContent = 'copy' }, 1200) } catch {}
})
// Clear the preview after a successful install so it doesn't linger.
const _pipInstallOrig = $('pipInstallBtn')
if (_pipInstallOrig) {
  _pipInstallOrig.addEventListener('click', () => { setTimeout(updatePipCmdPreview, 50) })
}

// ── Guided LLM engine setup (Deepy Prime) ──
// Renders ONE generic card per catalog engine (services/llm-engines.js). The
// card shows live ✓/✗ status for the CLI and/or pip bridge, plus a one-click
// installer (pip for Claude Code, npm for Codex/OpenCode) and, for engines with
// a server (OpenCode), a Start/Stop server toggle. New engines = one data line
// in services/llm-engines.js — no UI branch.
function dot(on) { return on ? '<span class="spec-dot dot-ok"></span>' : '<span class="spec-dot dot-bad"></span>' }

async function refreshLLMEngines() {
  const list = $('llmEnginesList')
  if (!list) return
  let data
  try { data = await window.w2gp.llmEnginesList() } catch (e) { data = { engines: [] } }
  const engines = (data && data.engines) || []
  if (!engines.length) {
    list.innerHTML = '<div class="spec-row"><span class="spec-value">No LLM engines available — reload the Dashboard or check the logs.</span></div>'
    return
  }
  list.innerHTML = engines.map(e => {
    const cliRow = e.cli
      ? `<div class="spec-row"><span class="spec-label">${e.cli} CLI</span>${dot(e.cliOnPath)}<span class="spec-value">${e.cliOnPath ? 'on PATH' : 'not found'}</span></div>`
      : ''
    const pipRow = e.pipPackage
      ? `<div class="spec-row"><span class="spec-label">${e.pipPackage}</span>${dot(e.pipInstalled)}<span class="spec-value">${e.pipInstalled ? 'installed' : 'missing'}</span></div>`
      : ''
    let action = ''
    if (e.install && e.install.mode === 'pip') {
      const done = e.pipInstalled
      action = `<button class="pip-install-btn llm-install-btn" data-engine="${e.id}" ${done ? 'disabled' : ''}>${done ? '✓ installed' : 'Install ' + e.install.spec}</button>`
    } else if (e.install && e.install.mode === 'npm') {
      const done = e.cliOnPath
      action = `<button class="pip-install-btn llm-install-btn" data-engine="${e.id}" ${done ? 'disabled' : ''}>${done ? '✓ on PATH' : 'Install via npm (@openai/codex)'}</button>`
    } else if (e.external) {
      action = `<span class="spec-value llm-external-hint">External — install via terminal, then it auto-detects.</span>`
    }
    let serveBtn = ''
    if (e.serve) {
      serveBtn = `<button class="pip-install-btn llm-serve-btn" data-engine="${e.id}">Start server</button>`
    }
    let authBtn = ''
    if (e.auth) {
      // Open the official Claude Code authentication guide (the user asked for a
      // how-to page, not a silent terminal launch that blocks on Max/Pro).
      authBtn = `<button class="pip-install-btn llm-auth-btn" data-engine="${e.id}" data-auth-docs="${e.auth.docsUrl || ''}">How to sign in</button>`
    }
    const serverRow = e.serverUrl
      ? `<div class="spec-row"><span class="spec-label">Server</span><span class="spec-value">${e.serverUrl}</span></div>`
      : ''
    const notes = e.notes ? `<div class="pip-advanced-hint">${e.notes}</div>` : ''
    const auth = e.auth
      ? `<div class="pip-advanced-hint">${e.auth.help}</div>`
      : ''
    const keyNote = e.claudeApiKeySet
      ? `<div class="pip-advanced-hint" style="color:#4ADE80">✓ Anthropic API key active — Claude Code will use it instead of a Max/Pro login (needs API credits in the Console; billed per use).</div>`
      : ''
    return `<div class="llm-engine-card">
      <div class="llm-engine-head"><span class="llm-engine-title">${e.label}</span>${action}</div>
      <div class="env-specs">${cliRow}${pipRow}${serverRow}</div>
      ${serveBtn ? `<div class="llm-serve-row">${serveBtn}</div>` : ''}
      ${authBtn ? `<div class="llm-serve-row">${authBtn}</div>` : ''}
      <div class="pip-advanced-hint">${e.desc}</div>${auth}${keyNote}${notes}
    </div>`
  }).join('')
  list.querySelectorAll('.llm-install-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.engine
      btn.disabled = true; btn.textContent = 'installing...'
      const r = await window.w2gp.llmEngineInstall(id)
      btn.textContent = (r && r.success) ? '✓ installed' : 'failed'
      if (r && r.success) { showToast('✓ engine installed'); refreshLLMEngines() }
      else showToast('✗ ' + (r && r.error ? r.error : 'install failed'))
    })
  })
  list.querySelectorAll('.llm-serve-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.engine
      const starting = btn.textContent.trim().startsWith('Start')
      btn.disabled = true
      const r = await window.w2gp.llmEngineServe(id, starting ? 'start' : 'stop')
      btn.disabled = false
      if (r && r.success) {
        btn.textContent = starting ? 'Stop server' : 'Start server'
        showToast(starting ? '✓ ' + id + ' server started' : '✓ server stopped')
      } else {
        showToast('✗ ' + (r && r.error ? r.error : 'server action failed'))
      }
    })
  })
  list.querySelectorAll('.llm-auth-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.authDocs
      if (url) {
        await window.w2gp.openExternal(url)
        showToast('Opened Claude Code authentication guide')
      } else {
        showToast('No sign-in guide configured for this engine')
      }
    })
  })
}

// Deepy Prime activation panel: pick a ready engine, write it into
// wgp_config.json so the next Wan2GP launch boots with Deepy Prime enabled.
const DEEPY_PANEL_ENGINES = [
  { id: 'opencode', label: 'OpenCode', paid: false },
  { id: 'claude-code', label: 'Claude Code', paid: true },
  { id: 'codex', label: 'OpenAI Codex', paid: true }
]

// Local-model (Prompt Enhancer) choices shown in the Deepy panel when Deepy is
// Disabled or Zero. Mirrors services/deepy-config.js DEEPY_ENHANCER_OPTIONS.
// modes: which Deepy modes the option is valid for. All options are rendered in
// the UI (the non-applicable ones are shown disabled with an annotation), so
// the user sees the full set of possible local models.
const DEEPY_PANEL_ENHANCERS = [
  { id: 1, label: 'Florence 2 + Llama 3.2 3B (local)', modes: ['disabled'] },
  { id: 2, label: 'Florence 2 + Llama Joy 8B (local)', modes: ['disabled'] },
  { id: 3, label: 'Qwen3.5 VL Abliterated 4B (local, recommended)', modes: ['zero'] },
  { id: 4, label: 'Qwen3.5 VL Abliterated 9B (local)', modes: ['zero'] },
  { id: 5, label: 'Qwen3.8 VL Uncensored 27B (local)', modes: ['zero'] }
]

async function refreshDeepy() {
  const opts = $('deepyEngineOptions')
  const statusMsg = $('deepyStatusMsg')
  const applyBtn = $('deepyApplyBtn')
  const docsLink = $('deepyDocsLink')
  const primeOnly = $('deepyPrimeOnly')
  const enhancerWrap = $('deepyEnhancerWrap')
  const enhancerOpts = $('deepyEnhancerOptions')
  const enhancerHint = $('deepyEnhancerHint')
  const modeRadios = document.querySelectorAll('input[name=deepyMode]')
  if (!applyBtn) return

  let status = { available: false }
  let engines = []
  try {
    const s = await window.w2gp.deepyStatus()
    if (s && s.ok) status = s
  } catch (_) {}
  try {
    const d = await window.w2gp.llmEnginesList()
    engines = (d && d.engines) || []
  } catch (_) {}

  const ready = id => {
    const e = engines.find(x => x.id === id)
    if (!e) return false
    if (id === 'claude-code') return !!(e.cliOnPath || e.claudeApiKeySet)
    return !!e.cliOnPath
  }

  const currentProfile = status.currentEngine
  const profileToUi = { opencode: 'opencode', claude: 'claude-code', codex: 'codex' }
  const currentUi = profileToUi[currentProfile] || null
  const currentMode = status.mode || 'disabled'
  const currentEnhancer = (typeof status.enhancerEnabled === 'number') ? status.enhancerEnabled : null
  // Default engine for Prime is OpenCode (universal providers / external, free).
  // Preserve an already-configured engine; otherwise fall back to OpenCode.
  let selectedEngine = currentUi || 'opencode'

  // Pre-select the current Deepy mode (Disabled / Zero / Prime).
  modeRadios.forEach(r => { r.checked = (r.value === currentMode) })
  primeOnly.style.display = (currentMode === 'prime') ? 'block' : 'none'

  // Local-model (Prompt Enhancer) selector: shown for Disabled/Zero only.
  // Rendered from the SELECTED mode (not just persisted), so switching modes
  // immediately re-renders the local-model choices. Selection is transient —
  // only persisted when Apply is pressed.
  const renderEnhancer = (mode, preselectId) => {
    const visible = (mode === 'disabled' || mode === 'zero')
    enhancerWrap.style.display = visible ? 'block' : 'none'
    if (!visible) return
    const forThisMode = o => o.modes.includes(mode)
    // Pre-select: caller-supplied id if valid, else persisted id, else first
    // valid option for this mode.
    const validForMode = DEEPY_PANEL_ENHANCERS.filter(forThisMode)
    const chosen = validForMode.find(o => o.id === preselectId)
      || validForMode.find(o => o.id === currentEnhancer)
      || validForMode[0]
    const sub = (mode === 'zero')
      ? 'Deepy Zero runs locally — pick the Qwen model Wan2GP will use.'
      : 'Florence 2 + Llama 3.2 3B is the default local model when Deepy is off.'
    if (enhancerHint) enhancerHint.textContent = sub
    enhancerOpts.innerHTML = DEEPY_PANEL_ENHANCERS.map(o => {
      const enabled = forThisMode(o)
      const checked = (o.id === chosen.id) ? 'checked' : ''
      const disabled = enabled ? '' : 'disabled'
      const note = enabled ? '' : `<span class="deepy-enhancer-note"> — only for ${o.modes[0] === 'zero' ? 'Deepy Zero' : 'Disabled'}</span>`
      const cls = enabled ? 'deepy-enhancer-opt' : 'deepy-enhancer-opt deepy-enhancer-opt-disabled'
      return `<label class="${cls}">\n` +
        `  <input type="radio" name="deepyEnhancer" value="${o.id}" ${checked} ${disabled}>\n` +
        `  <span class="deepy-enhancer-label">${o.label}</span>${note}\n` +
        `</label>`
    }).join('')
  }
  renderEnhancer(currentMode, currentEnhancer)

  opts.innerHTML = DEEPY_PANEL_ENGINES.map(en => {
    const isReady = ready(en.id)
    const dotCls = isReady ? 'dot-ok' : 'dot-bad'
    const dotChar = isReady ? '●' : '○'
    const cost = en.paid ? '<span class="deepy-cost-paid">paid</span>' : '<span class="deepy-cost-free">free</span>'
    return `<label class="deepy-engine-opt">
      <input type="radio" name="deepyEngine" value="${en.id}" ${en.id === selectedEngine ? 'checked' : ''}>
      <span class="${dotCls}">${dotChar}</span>
      <span class="deepy-engine-label">${en.label}</span>
      <span class="deepy-engine-cost">${cost}</span>
    </label>`
  }).join('')

  if (status.available) {
    const label = { disabled: 'Disabled', zero: 'Deepy Zero (local model)', prime: 'Deepy Prime' }[currentMode] || currentMode
    statusMsg.innerHTML = 'Currently: <strong>' + label + '</strong>'
      + (currentMode === 'prime' && currentProfile ? ' — engine: ' + currentProfile : '')
  } else {
    statusMsg.innerHTML = '<span style="color:#FBBF24">' + (status.reason || 'Wan2GP config not found — install Wan2GP first.') + '</span>'
  }

  const syncApply = () => {
    const mode = (document.querySelector('input[name=deepyMode]:checked') || {}).value || 'disabled'
    primeOnly.style.display = (mode === 'prime') ? 'block' : 'none'
    enhancerWrap.style.display = (mode === 'disabled' || mode === 'zero') ? 'block' : 'none'
    let ok = true
    let title = ''
    if (mode === 'prime') {
      const eng = (opts.querySelector('input[name=deepyEngine]:checked') || {}).value
      if (!eng) { ok = false; title = 'Pick an engine for Deepy Prime' }
      else if (!ready(eng)) { ok = false; title = 'Install / enable this engine first (see LLM Engines above)' }
    } else if (mode === 'disabled' || mode === 'zero') {
      const enh = (enhancerOpts.querySelector('input[name=deepyEnhancer]:checked') || {}).value
      if (!enh) { ok = false; title = 'Pick a local model (Prompt Enhancer)' }
    }
    applyBtn.disabled = !ok
    applyBtn.title = title || ('Set Deepy to ' + mode)
  }
  modeRadios.forEach(r => r.addEventListener('change', () => {
    // Switching the mode immediately re-renders the local-model selector for
    // the newly-selected mode (transient — not persisted until Apply).
    const m = (document.querySelector('input[name=deepyMode]:checked') || {}).value || 'disabled'
    renderEnhancer(m)
    syncApply()
  }))
  opts.querySelectorAll('input[name=deepyEngine]').forEach(r => r.addEventListener('change', syncApply))
  enhancerOpts.querySelectorAll('input[name=deepyEnhancer]').forEach(r => r.addEventListener('change', syncApply))
  syncApply()

  applyBtn.onclick = async () => {
    const mode = (document.querySelector('input[name=deepyMode]:checked') || {}).value || 'disabled'
    const eng = (opts.querySelector('input[name=deepyEngine]:checked') || {}).value
    const enh = (enhancerOpts.querySelector('input[name=deepyEnhancer]:checked') || {}).value
    applyBtn.disabled = true; applyBtn.textContent = 'applying...'
    const r = await window.w2gp.deepySet(mode, eng, enh ? parseInt(enh, 10) : null)
    applyBtn.textContent = 'Apply'
    if (r && r.ok) {
      statusMsg.innerHTML = '<span style="color:#4ADE80">✓ ' + (r.message || 'Deepy updated') + '</span>'
      showToast('✓ ' + (r.message || 'Deepy updated'))
      refreshDeepy()
    } else {
      statusMsg.innerHTML = '<span style="color:#F87171">✗ ' + (r && r.error ? r.error : 'update failed') + '</span>'
      showToast('✗ ' + (r && r.error ? r.error : 'update failed'))
      applyBtn.disabled = false
    }
  }
  if (docsLink) docsLink.onclick = async (ev) => {
    ev.preventDefault()
    await window.w2gp.openExternal('https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/DEEPY.md')
  }
}

$('llmEnginesRefresh')?.addEventListener('click', refreshLLMEngines)

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
// NOTE: the real shortcut lives in the Keyboard-shortcuts handler below
// (Ctrl+` / Escape / Ctrl+W). This duplicate copy fired on the SAME keypress,
// calling toggleFloatingTerm() twice — open then instantly close — so the
// shortcut looked dead in webview mode. Removed to avoid the double toggle.

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
  URL.revokeObjectURL(a.href)
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
  // Escape closes the Manage panel first — it can be open in webview mode too,
  // where the webview Escape branch below would otherwise fire instead.
  if (e.key === 'Escape' && $('settingsPanel').classList.contains('open')) { closeSettings(); return }
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
  t.setAttribute('role', 'status')
  t.setAttribute('aria-live', 'polite')
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
  // Keep the persistent button indicator — the user dismissed the banner, not
  // the fact that an update is still available. It clears on Download/Install.
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
$('claudeApiKeySaveBtn')?.addEventListener('click', async () => {
  const token = $('claudeApiKeyInput')?.value
  if (!token) return
  const cfg = await window.w2gp.configLoad()
  cfg.claudeApiKey = token
  await window.w2gp.configSave(cfg)
  showToast('Claude API key saved — it will be used for Claude Code on next launch')
  if (typeof refreshLLMEngines === 'function') refreshLLMEngines()
})
$('claudeApiKeyClearBtn')?.addEventListener('click', async () => {
  const cfg = await window.w2gp.configLoad()
  cfg.claudeApiKey = null
  await window.w2gp.configSave(cfg)
  if ($('claudeApiKeyInput')) $('claudeApiKeyInput').value = ''
  showToast('Claude API key cleared')
  if (typeof refreshLLMEngines === 'function') refreshLLMEngines()
})
$('launchArgsSaveBtn')?.addEventListener('click', async () => {
  const args = $('launchArgsInput')?.value || ''
  const cfg = await window.w2gp.configLoad()
  cfg.launchArgs = args.trim()
  await window.w2gp.configSave(cfg)
  showToast('Extra launch args saved')
})
$('ggufSaveBtn')?.addEventListener('click', async () => {
  const cfg = await window.w2gp.configLoad()
  cfg.ggufEnv = {
    enabled: $('ggufEnabled')?.checked !== false,
    matmulMode: $('ggufMatmulMode')?.value || 'auto',
    streamK: $('ggufStreamK')?.checked !== false,
    bf16Fp16: $('ggufBf16Fp16')?.checked === true,
  }
  await window.w2gp.configSave(cfg)
  showToast('GGUF CUDA kernel settings saved — applies on next launch')
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
// Bind Address picker — mirror of gpuDevice picker
$('serverNameSaveBtn')?.addEventListener('click', async () => {
  const val = $('serverNameSelect')?.value || 'localhost'
  const cfg = await window.w2gp.configLoad()
  cfg.serverName = val
  await window.w2gp.configSave(cfg)
  showToast('Bind address set to ' + val + ' (applies on next launch)')
})
$('cliDocsLink')?.addEventListener('click', (e) => {
  e.preventDefault()
  window.w2gp.openExternal('https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/CLI.md')
})

// ── Auto-Update ──
let updateState = null

// Reflect Desktop-Launcher update availability on the dashboard "Check Desktop
// Updates" action button itself (persistent dot + green border), so users who
// turned off launch-time checking still see there is an update available — not
// only in the transient top banner.
function setDesktopUpdateIndicator(on) {
  const btn = $('updateCheckBtn')
  if (!btn) return
  if (on) {
    btn.classList.add('has-update')
    if (!btn.querySelector('.update-dot')) {
      const dot = document.createElement('span')
      dot.className = 'update-dot'
      btn.appendChild(dot)
    }
  } else {
    btn.classList.remove('has-update')
    btn.querySelector('.update-dot')?.remove()
  }
}

window.w2gp.onUpdateStatus((status) => {
  // Mirror to Manage → Updates tab if present
  const mS=$('manageUpdateDesktopStatus'); const mBtn=$('manageUpdateDesktopBtn');
  if (mS && mBtn) {
    if (status.status==='checking') mS.textContent='Checking...';
    else if (status.status==='available') mS.textContent='v'+status.version+' available — click Download on Dashboard banner';
    else if (status.status==='downloading') mS.textContent='Downloading '+ (status.percent||0)+'%';
    else if (status.status==='downloaded') mS.textContent='v'+status.version+' downloaded — Install & Restart on Dashboard banner';
    else if (status.status==='up-to-date') mS.textContent='Up to date ✓';
    else if (status.status==='error') mS.textContent='Error: '+(status.message||'');
  }
  switch (status.status) {
    case 'checking':
      setDesktopUpdateIndicator(false)
      $('updateText').textContent = 'Checking for updates...'
      $('updateBanner').classList.remove('hidden')
      $('updateDownloadBtn').classList.add('hidden')
      $('updateInstallBtn').classList.add('hidden')
      $('updateActions').classList.remove('hidden')
      $('updateProgress').classList.add('hidden')
      $('updateDismissBtn').classList.add('hidden')
      break
    case 'available':
      setDesktopUpdateIndicator(true)
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
      setDesktopUpdateIndicator(false)
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
      setDesktopUpdateIndicator(false)
      $('updateText').textContent = `v${status.version} downloaded — ready to install`
      $('updateDownloadBtn').classList.add('hidden')
      $('updateInstallBtn').classList.remove('hidden')
      $('updateActions').classList.remove('hidden')
      $('updateProgress').classList.add('hidden')
      $('updateBanner').classList.remove('hidden')
      $('updateDismissBtn').classList.remove('hidden')
      break
    case 'error':
      setDesktopUpdateIndicator(false)
      $('updateText').textContent = (status.message || '').includes('401') || (status.message || '').includes('403') || (status.message || '').includes('authentication')
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

// ── Performance Settings (unified: Detect seeds dropdowns + rec tags; user overrides; saved tags from disk) ──
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

// Field metadata: maps the dropdown id to its rec/saved tag ids and a formatter.
const MEM_FIELDS = {
  video_profile: { sel: 'memVideoProfile', rec: 'recVideoProfile', saved: 'savedVideoProfile' },
  image_profile: { sel: 'memImageProfile', rec: 'recImageProfile', saved: 'savedImageProfile' },
  audio_profile: { sel: 'memAudioProfile', rec: 'recAudioProfile', saved: 'savedAudioProfile' },
  vram_safety_coefficient: { sel: 'memCoeff', rec: 'recCoeff', saved: 'savedCoeff' },
  vae_config: { sel: 'memVae', rec: 'recVae', saved: 'savedVae' },
  transformer_quantization: { sel: 'memQuant', rec: 'recQuant', saved: 'savedQuant' }
}
function fmtVal(key, v) {
  if (v == null || v === '') return '—'
  if (key === 'vae_config') return v + (Number(v) === 0 ? ' (AUTO)' : '')
  return String(v)
}

function memProfilePopulate(settings, opts = {}) {
  if (!settings) return
  // opts.mode: 'recommend' fills the dropdown + rec tags; 'saved' fills rec tags from detect AND saved tags from disk.
  for (const key of Object.keys(MEM_FIELDS)) {
    const f = MEM_FIELDS[key]
    const v = settings[key]
    if (opts.mode === 'recommend') {
      // Seed the dropdown with the recommended value (user can override).
      const sel = $(f.sel)
      if (sel) sel.value = (v != null && v !== '') ? String(v) : (key === 'vae_config' ? '0' : '')
      const rec = $(f.rec); if (rec) rec.textContent = 'rec: ' + fmtVal(key, v)
    } else if (opts.mode === 'saved') {
      // Show what's currently written to disk (preferred/saved).
      const saved = $(f.saved); if (saved) saved.textContent = 'saved: ' + fmtVal(key, v)
    }
  }
}

// Feed the manual Adjuster from an Auto-Tune detection result: set the dropdown
// defaults to the recommended values AND show the rec tags. The user can then
// override any dropdown before pressing Apply.
function memProfileFromRecommendation(rec) {
  if (!rec) return
  memProfilePopulate({
    video_profile: rec.video_profile,
    image_profile: rec.image_profile,
    audio_profile: rec.audio_profile,
    vram_safety_coefficient: rec.vram_safety_coefficient,
    vae_config: rec.vae_config != null ? rec.vae_config : 0, // AUTO unless Detect set a fixed value
    transformer_quantization: rec.transformer_quantization
  }, { mode: 'recommend' })
}

async function memProfileLoad() {
  try {
    const res = await window.w2gp.memoryProfileRead()
    if (res && res.ok) {
      // Show the currently-saved (preferred) values from disk.
      memProfilePopulate(res.settings, { mode: 'saved' })
      // If a detection already populated the dropdowns, leave them; otherwise
      // seed the dropdowns from the saved config too so the panel isn't empty.
      const first = $('memVideoProfile')
      if (first && first.value === '') memProfilePopulate(res.settings, { mode: 'recommend' })
    } else setMemStatus((res && res.error) || 'Failed to read memory settings', true)
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

// ── uv Wheel Cache (Manage → General) ──
function fmtBytes(n) {
  if (!n && n !== 0) return '—'
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(n) / Math.log(1024))
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i]
}
// Cheap: only reports presence on Manage-panel open (no directory walk).
async function refreshUvCacheInfo() {
  const statusEl = $('uvCacheStatus')
  if (!statusEl) return
  try {
    const info = await window.w2gp.uvCacheInfo()
    if (info && info.exists) {
      statusEl.textContent = `Cache present at ${info.cacheDir} — size on demand.`
    } else {
      statusEl.textContent = 'No cache folder present (fresh install or already removed).'
    }
  } catch { statusEl.textContent = 'Could not read cache info.' }
}
// On-demand: computes the byte count only when the user asks.
async function showUvCacheSize() {
  const statusEl = $('uvCacheStatus')
  if (!statusEl) return
  statusEl.textContent = 'Calculating size…'
  try {
    const info = await window.w2gp.uvCacheSize()
    if (info && info.exists) {
      statusEl.textContent = `Cache size: ${fmtBytes(info.sizeBytes)} at ${info.cacheDir}`
    } else {
      statusEl.textContent = 'No cache folder present.'
    }
  } catch { statusEl.textContent = 'Could not read cache size.' }
}
$('uvCacheSizeBtn')?.addEventListener('click', showUvCacheSize)
$('uvCachePurgeBtn')?.addEventListener('click', async function() {
  this.disabled = true
  const resEl = $('uvCacheResult')
  if (resEl) resEl.textContent = 'Purging unused wheels…'
  try {
    const r = await window.w2gp.uvCacheClean('prune')
    if (resEl) resEl.textContent = (r && r.success) ? 'Purge done — see log for details.' : 'Purge skipped — ' + ((r && r.error) || 'unknown error')
  } catch (e) { if (resEl) resEl.textContent = 'Error: ' + e }
  this.disabled = false
  refreshUvCacheInfo()
})
$('uvCacheRemoveBtn')?.addEventListener('click', async function() {
  if (!confirm('Remove the entire uv wheel cache? Next Wan2GP update will re-download everything (one-time).')) return
  this.disabled = true
  const resEl = $('uvCacheResult')
  if (resEl) resEl.textContent = 'Removing cache…'
  try {
    const r = await window.w2gp.uvCacheClean('remove')
    if (resEl) resEl.textContent = (r && r.success) ? (r.removed ? 'Cache removed.' : 'No cache to remove.') : 'Remove failed — ' + ((r && r.error) || 'unknown error')
  } catch (e) { if (resEl) resEl.textContent = 'Error: ' + e }
  this.disabled = false
  refreshUvCacheInfo()
})

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

// ── Manage → Updates tab — proxies to same IPCs as Dashboard ──
$('manageUpdateWan2gpBtn')?.addEventListener('click', async function() {
  const s=$('manageUpdateWan2gpStatus'); this.disabled=true; this.textContent='Updating...'; if(s) s.textContent='Updating Wan2GP (this can take a few minutes)...';
  try { const r=await window.w2gp.update(); if(s) s.textContent=r ? '✓ Update finished — check Dashboard log' : '✗ Update failed'; } catch(e){ if(s) s.textContent='✗ '+(e.message||e); } finally{ this.disabled=false; this.textContent='↻ Update Wan2GP'; }
});
$('manageUpdateDesktopBtn')?.addEventListener('click', function() {
  const s=$('manageUpdateDesktopStatus'); if(s) s.textContent='Checking...';
  window.w2gp.checkUpdate();
  setTimeout(()=>{ if(s && !s.textContent.includes('✓')) s.textContent='Check sent — see banner on Dashboard'; }, 1500);
});

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
