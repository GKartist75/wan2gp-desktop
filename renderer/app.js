// ── Global Log Buffer ──
const logBuffer = []
const MAX_LOG = 5000
function appendLog(text) {
  if (!text) return
  text.split('\n').forEach(line => { if (line.trim()) logBuffer.push(line.trim()) })
  while (logBuffer.length > MAX_LOG) logBuffer.shift()
  renderTerminals()
}

// Per-terminal follow state
const termFollow = { termBody: true, installTermBody: true, viewerTermBody: true }
const termAutoScroll = {}

function renderTerminals() {
  const text = logBuffer.join('\n')
  ;['termBody','installTermBody','viewerTermBody'].forEach(id => {
    const el = document.getElementById(id)
    if (!el) return
    el.textContent = text
    // Auto-scroll if follow enabled
    if (termFollow[id] && !termAutoScroll[id]) {
      setTimeout(() => { el.scrollTop = el.scrollHeight }, 10)
    }
  })
}

function clearLogBuffer() {
  logBuffer.length = 0
  renderTerminals()
}

// Handle manual scroll → unfollow
function setupScrollUnfollow(termBodyId, followBtnId) {
  const body = document.getElementById(termBodyId)
  const btn = document.getElementById(followBtnId)
  if (!body || !btn) return
  body.addEventListener('scroll', () => {
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 30
    if (!atBottom && termFollow[termBodyId]) {
      termFollow[termBodyId] = false
      btn.classList.remove('active')
      btn.textContent = '▼ Follow'
    } else if (atBottom && !termFollow[termBodyId]) {
      termFollow[termBodyId] = true
      btn.classList.add('active')
      btn.textContent = '▼ Follow'
    }
  })
}

// ── Screen Router ──
const $ = id => document.getElementById(id)
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  $(id).classList.add('active')
}
function log(el, msg) {
  if (!el) return
  el.textContent += msg + '\n'
  el.scrollTop = el.scrollHeight
}

let currentUrl = null

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  const installed = await window.w2gp.checkInstalled()

  // Setup scroll-unfollow for all terminals
  setupScrollUnfollow('termBody', 'termFollowBtn')
  setupScrollUnfollow('installTermBody', null) // no follow btn for install term
  setupScrollUnfollow('viewerTermBody', 'viewerFollowBtn')

  // All output → global buffer
  window.w2gp.onSetupOutput((text) => appendLog(text))
  window.w2gp.onLaunchLog((text) => appendLog(text))

  // Setup output → small logs
  window.w2gp.onSetupOutput((text) => {
    const c = text.replace(/[\x00-\x1f]/g,'').trim()
    if (c) { log($('installLog'),c); log($('settingsLog'),c) }
  })
  // Launch log → launch screen
  window.w2gp.onLaunchLog((text) => {
    const c = text.replace(/[\x00-\x1f]/g,'').trim()
    if (c) log($('launchLog'),c)
  })

  // Phase events → task list
  window.w2gp.onSetupPhase((phase) => taskComplete(phase.id))

  // Process exit → auto-return from viewer
  window.w2gp.onWangpExit((code) => {
    if ($('viewer').classList.contains('active')) { show('dashboard'); refreshDashboard() }
  })

  // Load system hardware
  loadHardware()

  if (installed.repo && installed.env) {
    show('dashboard')
    refreshDashboard()
  } else {
    $('splashStatus').textContent = 'First-time setup...'
    setTimeout(startInstall, 500)
  }
})

// ── Hardware detection ──
async function loadHardware() {
  const specs = await window.w2gp.detectHardware()
  $('specCpu').textContent = specs.cpu || '—'
  $('specRam').textContent = specs.ram || '—'
  $('specGpu').textContent = specs.gpu || '—'
  $('specVram').textContent = specs.vram || '—'
}

// ── Task List ──
const taskMap = {}
document.querySelectorAll('.task').forEach(t => { taskMap[t.dataset.id] = t })
function taskStart(id) {
  const t = taskMap[id]; if (!t) return
  t.className = 'task active'; t.querySelector('.task-icon').textContent = '◌'; t.querySelector('.task-status').textContent = 'running'
}
function taskComplete(id, failed) {
  const t = taskMap[id]; if (!t) return
  t.className = failed ? 'task fail' : 'task done'
  t.querySelector('.task-icon').textContent = failed ? '✕' : '✓'
  t.querySelector('.task-status').textContent = failed ? 'failed' : 'done'
}
function resetTasks() {
  Object.values(taskMap).forEach(t => { t.className = 'task pending'; t.querySelector('.task-icon').textContent = '○'; t.querySelector('.task-status').textContent = 'pending' })
}

// ── Installer ──
async function startInstall() {
  show('installer')
  $('installLog').textContent = ''
  resetTasks()
  $('installSubtitle').textContent = 'Setting up Wan2GP...'
  const installed = await window.w2gp.checkInstalled()
  if (installed.repo) taskComplete('clone'); else taskStart('clone')
  try {
    await window.w2gp.install()
    taskComplete('done')
    $('installSubtitle').textContent = 'Wan2GP is ready!'
    setTimeout(() => { show('dashboard'); refreshDashboard() }, 1200)
  } catch (e) {
    taskComplete('done', true); $('installSubtitle').textContent = 'Installation failed'
    appendLog(`[ERROR] ${e.message}`)
  }
}

// ── Dashboard ──
async function refreshDashboard() {
  const status = await window.w2gp.getStatus()
  if (status.error || !status.env) {
    $('envName').textContent = 'No active environment'
    ;['specPython','specTorch','specCuda','specTriton','specSage','specFlash'].forEach(id => $(id).textContent = '—')
  } else {
    $('envName').textContent = status.env.name
    $('envType').textContent = status.env.type
    $('specPython').textContent = status.versions?.python || '—'
    $('specTorch').textContent = status.versions?.torch || '—'
    const m = (status.versions?.torch || '').match(/cu(\d+)/)
    $('specCuda').textContent = m ? `CUDA ${m[1]}` : '—'
    $('specTriton').textContent = status.versions?.triton || '—'
    $('specSage').textContent = status.versions?.sageattention || '—'
    $('specFlash').textContent = status.versions?.flash_attn || '—'
  }
  // Env list
  const envs = await window.w2gp.manageList()
  const list = $('envList'); list.innerHTML = ''
  envs.forEach(e => {
    const div = document.createElement('div')
    div.className = 'env-list-item' + (e.active ? ' active' : '')
    div.innerHTML = `<span class="env-list-dot"></span><span class="env-list-name">${e.name}</span><span style="font-size:0.65rem;color:#666;flex-shrink:0">${e.type}</span><button class="env-list-del" data-name="${e.name}">✕</button>`
    if (!e.active) div.addEventListener('click', async () => { await window.w2gp.manageSetActive(e.name); refreshDashboard() })
    div.querySelector('.env-list-del').addEventListener('click', async (ev) => { ev.stopPropagation(); if (confirm(`Delete "${e.name}"?`)) { await window.w2gp.manageDelete(e.name); refreshDashboard() } })
    list.appendChild(div)
  })
}

// ── Launch (desktop) ──
let launchCancelled = false
async function doLaunch() {
  launchCancelled = false
  show('launching')
  $('launchLog').textContent = ''
  const s1 = $('launchStep1'), s2 = $('launchStep2'), s3 = $('launchStep3')
  ;[s1,s2,s3].forEach(s => { s.className = 'launch-step'; s.querySelector('.step-icon').textContent = '○' })
  s1.className = 'launch-step active'; s1.querySelector('.step-icon').textContent = '◌'
  try {
    const result = await window.w2gp.launch()
    if (launchCancelled) { await window.w2gp.stop(); show('dashboard'); return }
    s1.className = 'launch-step done'; s1.querySelector('.step-icon').textContent = '✓'
    s2.className = 'launch-step done'; s2.querySelector('.step-icon').textContent = '✓'
    s3.className = 'launch-step active'; s3.querySelector('.step-icon').textContent = '◌'
    currentUrl = result.url
    show('viewer'); $('wangpView').src = result.url
    s3.className = 'launch-step done'; s3.querySelector('.step-icon').textContent = '✓'
  } catch (e) {
    if (!launchCancelled) {
      s1.className = 'launch-step done'; s1.querySelector('.step-icon').textContent = '✕'
      log($('launchLog'), `\n[!] ${e.message}`); appendLog(`[LAUNCH ERROR] ${e.message}`)
      setTimeout(() => show('dashboard'), 3000)
    }
  }
}

// ── Terminal Toggle ──
function toggleTerm(panelId, followBtnId) {
  const panel = $(panelId)
  if (!panel) return
  const isOpen = panel.classList.contains('open')
  document.querySelectorAll('.terminal-panel').forEach(p => p.classList.remove('open'))
  if (!isOpen) {
    panel.classList.add('open')
    // Set default height if not set
    const h = panel.style.height
    if (!h || h === 'auto') panel.style.height = '180px'
    renderTerminals()
    // Ensure follow is on when opening
    if (followBtnId) {
      const btn = $(followBtnId)
      if (btn) { termFollow[panel.querySelector('.term-body')?.id] = true; btn.classList.add('active'); btn.textContent = '▼ Follow' }
    }
    const body = panel.querySelector('.term-body')
    if (body) setTimeout(() => body.scrollTop = body.scrollHeight, 50)
  }
}

// ── Terminal Resize ──
function setupTermResize(handleId, panelId) {
  const handle = $(handleId); const panel = $(panelId)
  if (!handle || !panel) return
  let dragging = false, startY = 0, startH = 0

  handle.addEventListener('mousedown', (e) => {
    dragging = true; startY = e.clientY; startH = panel.offsetHeight
    handle.classList.add('dragging')
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  })

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return
    const dh = startY - e.clientY
    const newH = Math.max(80, Math.min(window.innerHeight * 0.7, startH + dh))
    panel.style.height = newH + 'px'
    const body = panel.querySelector('.term-body')
    if (body && termFollow[body.id]) setTimeout(() => body.scrollTop = body.scrollHeight, 10)
  })

  document.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false; handle.classList.remove('dragging')
    document.body.style.cursor = ''; document.body.style.userSelect = ''
  })
}

// ── Event Wiring ──
document.addEventListener('DOMContentLoaded', () => {
  // Terminal resize
  setupTermResize('termResize', 'termPanel')
  setupTermResize('viewerTermResize', 'viewerTermPanel')
})

// Dashboard buttons
$('launchBtn').addEventListener('click', doLaunch)
$('browserBtn').addEventListener('click', async () => {
  if (currentUrl) { window.w2gp.openExternal(currentUrl); return }
  $('browserBtn').disabled = true; $('browserBtn').textContent = 'Starting...'
  try { const r = await window.w2gp.launch(); currentUrl = r.url; window.w2gp.openExternal(r.url) }
  catch (e) { alert('Browser launch failed: ' + e.message) }
  $('browserBtn').disabled = false; $('browserBtn').textContent = '↗ Launch in Browser'
})
$('cancelLaunchBtn').addEventListener('click', () => { launchCancelled = true; window.w2gp.stop(); show('dashboard') })
$('updateBtn').addEventListener('click', async () => {
  $('updateBtn').disabled = true; $('updateBtn').textContent = 'Working...'
  try { await window.w2gp.update(); refreshDashboard() } catch (e) { alert('Update: ' + e.message) }
  $('updateBtn').disabled = false; $('updateBtn').textContent = '↻ Update Wan2GP'
})
$('upgradeBtn').addEventListener('click', async () => {
  show('settings'); $('settingsLog').textContent = 'Upgrade running (check Terminal for output)...\n'
  try { await window.w2gp.upgrade(); log($('settingsLog'), '\n[*] Done'); refreshDashboard() } catch (e) { log($('settingsLog'), '\n[!] ' + e.message) }
})
$('refreshBtn').addEventListener('click', () => { refreshDashboard(); loadHardware() })
$('settingsBtn').addEventListener('click', () => { show('settings'); $('settingsLog').textContent = '' })

// Terminal toggle
$('dashTermBtn').addEventListener('click', () => toggleTerm('termPanel', 'termFollowBtn'))
$('viewTermBtn').addEventListener('click', () => toggleTerm('viewerTermPanel', 'viewerFollowBtn'))

// Follow button toggles
$('termFollowBtn').addEventListener('click', () => {
  termFollow.termBody = !termFollow.termBody
  const btn = $('termFollowBtn')
  btn.classList.toggle('active')
  btn.textContent = termFollow.termBody ? '▼ Follow' : '◼ Paused'
  if (termFollow.termBody) { const el = $('termBody'); if (el) setTimeout(() => el.scrollTop = el.scrollHeight, 10) }
})
$('viewerFollowBtn').addEventListener('click', () => {
  termFollow.viewerTermBody = !termFollow.viewerTermBody
  const btn = $('viewerFollowBtn')
  btn.classList.toggle('active')
  btn.textContent = termFollow.viewerTermBody ? '▼ Follow' : '◼ Paused'
  if (termFollow.viewerTermBody) { const el = $('viewerTermBody'); if (el) setTimeout(() => el.scrollTop = el.scrollHeight, 10) }
})

// Clear
$('termClearBtn').addEventListener('click', clearLogBuffer)
$('viewerTermClearBtn').addEventListener('click', clearLogBuffer)
$('viewerTermCloseBtn').addEventListener('click', () => $('viewerTermPanel').classList.remove('open'))

// Installer tabs
$('installTasksTab').addEventListener('click', () => {
  $('installTasks').classList.remove('hidden'); $('installTerm').classList.add('hidden')
  $('installTasksTab').classList.add('active'); $('installTermTab').classList.remove('active')
})
$('installTermTab').addEventListener('click', () => {
  $('installTasks').classList.add('hidden'); $('installTerm').classList.remove('hidden')
  $('installTasksTab').classList.remove('active'); $('installTermTab').classList.add('active')
  renderTerminals()
})

// Viewer
$('viewBackBtn').addEventListener('click', async () => { await window.w2gp.stop(); show('dashboard'); refreshDashboard() })
$('viewBrowserBtn').addEventListener('click', () => { if (currentUrl) window.w2gp.openExternal(currentUrl) })

// Settings
$('settingsBackBtn').addEventListener('click', () => show('dashboard'))
$('settingsUpdateBtn').addEventListener('click', async () => {
  $('settingsLog').textContent = 'Updating...\n'
  try { await window.w2gp.update(); log($('settingsLog'), '\n[*] Done'); refreshDashboard() } catch (e) { log($('settingsLog'), '\n[!] ' + e.message) }
})
$('settingsUpgradeBtn').addEventListener('click', async () => {
  $('settingsLog').textContent = 'Upgrading...\n'
  try { await window.w2gp.upgrade(); log($('settingsLog'), '\n[*] Done'); refreshDashboard() } catch (e) { log($('settingsLog'), '\n[!] ' + e.message) }
})
$('settingsReinstallBtn').addEventListener('click', async () => {
  if (!confirm('Re-run the full installer?')) return
  $('settingsLog').textContent = 'Reinstalling...\n'
  try { await window.w2gp.install(); log($('settingsLog'), '\n[*] Done'); refreshDashboard() } catch (e) { log($('settingsLog'), '\n[!] ' + e.message) }
})
