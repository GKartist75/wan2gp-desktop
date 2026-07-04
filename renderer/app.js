// ── Global Log Buffer ──
const logBuffer = []
const MAX_LOG = 5000
let lastLine = ''
function appendLog(text) {
  if (!text) return
  // Handle carriage returns (\r) for progress bars (tqdm, hf_hub)
  const parts = text.split(/(\r|\n)/)
  for (const part of parts) {
    if (part === '\r') {
      // Carriage return: replace last line in buffer
      if (lastLine && logBuffer.length > 0) {
        logBuffer[logBuffer.length - 1] = lastLine
      }
      lastLine = ''
    } else if (part === '\n') {
      // Newline: commit lastLine
      if (lastLine.trim()) logBuffer.push(lastLine.trim())
      lastLine = ''
    } else {
      lastLine += part
    }
  }
  while (logBuffer.length > MAX_LOG) logBuffer.shift()
  renderTerminals()
}

const termFollow = { termBody: true, installTermBody: true, viewerTermBody: true }
const termAutoScroll = {}

function renderTerminals() {
  const text = logBuffer.join('\n')
  ;['termBody','installTermBody','viewerTermBody'].forEach(id => {
    const el = document.getElementById(id)
    if (!el) return
    el.textContent = text
    if (termFollow[id]) setTimeout(() => { el.scrollTop = el.scrollHeight }, 10)
  })
}

// ── Webview crash handler ──
function setupWebviewCrashHandler() {
  const wv = $('wangpView')
  if (!wv) return
  wv.removeEventListener('crashed', onWebviewCrash)
  wv.addEventListener('crashed', onWebviewCrash)
}

let wvCrashRetry = 0
const WV_CRASH_MAX = 3

function onWebviewCrash(e) {
  wvCrashRetry++
  if (wvCrashRetry > WV_CRASH_MAX) {
    appendLog(`[!] Webview crashed ${WV_CRASH_MAX} times — showing restart overlay`)
    showRestartOverlay(-1)
    return
  }
  appendLog(`[!] Webview ${e.type} crashed (${wvCrashRetry}/${WV_CRASH_MAX}) — reloading...`)
  setTimeout(() => {
    const wv = $('wangpView')
    if (wv && currentUrl) wv.src = currentUrl
  }, 2000)
}

function setupScrollUnfollow(bodyId, btnId) {
  const body = document.getElementById(bodyId)
  const btn = document.getElementById(btnId)
  if (!body || !btn) return
  body.addEventListener('scroll', () => {
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 30
    if (!atBottom && termFollow[bodyId]) { termFollow[bodyId] = false; btn.classList.remove('active'); const ft=btn.querySelector('.follow-text'); if(ft) ft.textContent='Follow' }
    else if (atBottom && !termFollow[bodyId]) { termFollow[bodyId] = true; btn.classList.add('active'); const ft=btn.querySelector('.follow-text'); if(ft) ft.textContent='Follow' }
  })
}

const $ = id => document.getElementById(id)
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); $(id).classList.add('active') }
function openSettings() { $('settingsPanel').classList.add('open'); $('settingsOverlay').classList.add('visible') }
function closeSettings() { $('settingsPanel').classList.remove('open'); $('settingsOverlay').classList.remove('visible') }
function log(el, msg) { if (!el) return; el.textContent += msg + '\n'; el.scrollTop = el.scrollHeight }

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

let currentUrl = null
let prevPhaseId = null

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  const installed = await window.w2gp.checkInstalled()
  setupScrollUnfollow('termBody','termFollowBtn')
  setupScrollUnfollow('installTermBody',null)
  setupScrollUnfollow('viewerTermBody','viewerFollowBtn')

  window.w2gp.onSetupOutput(t => appendLog(t))
  window.w2gp.onLaunchLog(t => appendLog(t))
  window.w2gp.onSetupOutput(t => { const c=t.replace(/[\x00-\x1f]/g,'').trim(); if(c){ log($('installLog'),c); log($('settingsLog'),c) } })
  window.w2gp.onLaunchLog(t => { const c=t.replace(/\x1b[[0-9;]*m/g,''); if(c.trim()) log($('launchLog'),c) })
  window.w2gp.onSetupPhase(p => {
    if (p.done) {
      if (prevPhaseId && prevPhaseId !== p.id) taskComplete(prevPhaseId)
      taskComplete(p.id)
      prevPhaseId = null
    } else {
      if (prevPhaseId && prevPhaseId !== p.id) taskComplete(prevPhaseId)
      taskStart(p.id)
      prevPhaseId = p.id
    }
  })
  window.w2gp.onSetupProfile(p => { $('installProfile').textContent=p; $('installProfileRow').style.display='flex' })
  window.w2gp.onWangpExit(c => {
    if($('viewer').classList.contains('active')){
      appendLog(`[!] Wan2GP process exited (code ${c})`)
      // Show restart overlay instead of immediately navigating to dashboard
      showRestartOverlay(c)
    }
  })

  window.w2gp.onWangpRestarting((attempt) => {
    $('restartTitle').textContent = `Restarting Wan2GP (attempt ${attempt}/3)...`
    $('restartMessage').textContent = 'Please wait...'
    $('restartNowBtn').classList.add('hidden')
    $('restartDashboardBtn').classList.add('hidden')
  })

  window.w2gp.onWangpRestarted((url) => {
    appendLog('[*] Wan2GP restarted, webview stays — Gradio reconnects via WebSocket')
    $('serverRestartOverlay').classList.add('hidden')
    currentUrl = url
  })

  window.w2gp.onWangpRestartFailed((err) => {
    appendLog(`[!] Auto-restart failed: ${err}`)
    $('restartTitle').textContent = 'Failed to restart'
    $('restartMessage').textContent = `Could not restart Wan2GP: ${err}`
    $('restartNowBtn').classList.remove('hidden')
    $('restartNowBtn').textContent = 'Try Again'
    $('restartDashboardBtn').classList.remove('hidden')
  })

  // Load theme
  const cfg = await window.w2gp.configLoad()
  if (cfg.theme === 'dark') applyTheme('dark')

  loadHardware()

  if (installed.repo && installed.env) {
    show('dashboard')
    refreshDashboard()

  } else {
    $('splashStatus').textContent = 'First-time setup...'
    const hw = await window.w2gp.detectHardware()
    $('installCpu').textContent=hw.cpu||'—'; $('installRam').textContent=hw.ram||'—'
    $('installGpu').textContent=hw.gpu||'—'; $('installVram').textContent=hw.vram||'—'
    loadPaths()
    // Show installer with env selector, wait for user to press Install
    show('installer')
    $('installSubtitle').textContent = 'Select environment type, then click Install'
    $('installStartBtn').classList.remove('hidden')
    $('envTypeSelect').classList.remove('disabled')
    document.querySelectorAll('.env-type-btn').forEach(b => b.disabled = false)
  }
})

// ── Hardware ──
async function loadHardware() {
  const s = await window.w2gp.detectHardware()
  $('specCpu').textContent=s.cpu||'—'; $('specRam').textContent=s.ram||'—'
  $('specGpu').textContent=s.gpu||'—'; $('specVram').textContent=s.vram||'—'
}

// ── Task List ──
const taskMap = {}; document.querySelectorAll('.task').forEach(t => { taskMap[t.dataset.id]=t })
function taskStart(id){ const t=taskMap[id];if(!t)return; t.className='task active'; t.querySelector('.task-icon').textContent='◌'; t.querySelector('.task-status').textContent='running' }
function taskComplete(id,failed){ const t=taskMap[id];if(!t)return; t.className=failed?'task fail':'task done'; t.querySelector('.task-icon').textContent=failed?'✕':'✓'; t.querySelector('.task-status').textContent=failed?'failed':'done' }
function resetTasks(){ Object.values(taskMap).forEach(t=>{ t.className='task pending'; t.querySelector('.task-icon').textContent='○'; t.querySelector('.task-status').textContent='pending' }) }

// ── Installer ──
let selectedEnvType = 'venv'

// Env type selector
document.querySelectorAll('.env-type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.env-type-btn').forEach(b => b.classList.remove('selected'))
    btn.classList.add('selected')
    selectedEnvType = btn.dataset.env
  })
})

$('installStartBtn').addEventListener('click', startInstall)

// ── Browse repo path ──
$('browseAppDataPath')?.addEventListener('click', async () => {
  const folder = await window.w2gp.selectFolder()
  if (!folder) return
  await window.w2gp.setDataDir(folder)
  loadPaths()
})

// ── Model folder browsers ──
let _modelCkpts = '', _modelLoras = ''

function setModelPath(type, folder) {
  const el = type === 'ckpts' ? $('installCkptsPath') : $('installLorasPath')
  const clearBtn = type === 'ckpts' ? $('clearCkptsPath') : $('clearLorasPath')
  if (!el) return
  if (folder) {
    el.textContent = folder
    el.style.color = ''
    if (clearBtn) clearBtn.style.display = ''
    if (type === 'ckpts') _modelCkpts = folder
    else _modelLoras = folder
  } else {
    el.textContent = '(default)'
    el.style.color = 'var(--text-tertiary)'
    if (clearBtn) clearBtn.style.display = 'none'
    if (type === 'ckpts') _modelCkpts = ''
    else _modelLoras = ''
  }
}

async function browseModelFolder(type) {
  const folder = await window.w2gp.selectFolder()
  if (!folder) return
  setModelPath(type, folder)
  // Persist to desktop config
  const cfg = await window.w2gp.configLoad()
  if (type === 'ckpts') cfg.modelCkptsPath = folder
  else cfg.modelLorasPath = folder
  await window.w2gp.configSave(cfg)
}

$('browseCkptsPath')?.addEventListener('click', () => browseModelFolder('ckpts'))
$('browseLorasPath')?.addEventListener('click', () => browseModelFolder('loras'))
$('clearCkptsPath')?.addEventListener('click', async () => {
  setModelPath('ckpts', '')
  const cfg = await window.w2gp.configLoad()
  delete cfg.modelCkptsPath
  await window.w2gp.configSave(cfg)
})
$('clearLorasPath')?.addEventListener('click', async () => {
  setModelPath('loras', '')
  const cfg = await window.w2gp.configLoad()
  delete cfg.modelLorasPath
  await window.w2gp.configSave(cfg)
})

async function startInstall(){
  show('installer'); $('installLog').textContent=''; resetTasks()
  // Disable env selector + hide install button during install
  $('envTypeSelect').classList.add('disabled')
  document.querySelectorAll('.env-type-btn').forEach(b => b.disabled = true)
  $('installStartBtn').classList.add('hidden')
  $('installSubtitle').textContent='Setting up Wan2GP...'
  const installed = await window.w2gp.checkInstalled()
  if(installed.repo) {
    if(!confirm('Wan2GP is already installed. Reinstall? This will remove everything and start fresh.')) {
      $('installSubtitle').textContent='Update instead of fresh install...'
      installed.repo = false
    } else {
      $('installSubtitle').textContent='Removing existing installation...'
      await window.w2gp.reinstall()
    }
  }
  if(installed.repo) { taskComplete('clone'); prevPhaseId = 'clone' } else { taskStart('clone'); prevPhaseId = 'clone' }
  try {
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
    // Write model config after install — enables display_stats + sets model paths
    try {
      const modelCfg = {}
      if (_modelCkpts) modelCfg.checkpointsPaths = [_modelCkpts, '.']
      if (_modelLoras) modelCfg.lorasRoot = _modelLoras
      await window.w2gp.writeWgpConfig(modelCfg)
      appendLog(`[*] wgp_config.json updated: ckpts=${_modelCkpts || '(default)'}, loras=${_modelLoras || '(default)'}, display_stats=1`)
    } catch (e) {
      appendLog(`[!] Failed to write model config: ${e.message}`)
    }
    taskComplete('done'); $('installSubtitle').textContent='Wan2GP is ready!'
    setTimeout(()=>{ show('dashboard'); refreshDashboard() }, 1200)
  } catch(e){ taskComplete('done',true); $('installSubtitle').textContent='Installation failed'; appendLog(`[ERROR] ${e.message}`) }
}

// ── Settings overlay click ──
$('settingsOverlay').addEventListener('click', closeSettings)

// ── Dashboard ──
async function refreshDashboard(){
  const status = await window.w2gp.getStatus()
  if(status.error||!status.env){
    $('envName').textContent='No active environment'
    ;['specPython','specTorch','specCuda','specTriton','specSage','specFlash','specDiffusers','specTransformers','specGradio','specAccelerate','specOnnx','specOpencv','specPeft','specHfhub'].forEach(id=>{ const el=$(id); if(el) el.textContent='—' })
    ;['dotPython','dotTorch','dotCuda','dotTriton','dotSage','dotFlash','dotDiffusers','dotTransformers','dotGradio','dotAccelerate','dotOnnx','dotOpencv','dotPeft','dotHfhub'].forEach(id=>{ const el=$(id); if(el) el.classList.remove('installed') })
  } else {
    $('envName').textContent=status.env.name; $('envType').textContent=status.env.type

    function setSpec(specId, dotId, val) {
      const el=$(specId); if(el) el.textContent=val||'—'
      const dot=$(dotId); if(dot){ if(val) dot.classList.add('installed'); else dot.classList.remove('installed') }
    }
    setSpec('specPython','dotPython', status.versions?.python)
    setSpec('specTorch','dotTorch', status.versions?.torch)
    const m=(status.versions?.torch||'').match(/cu(\d+)/)
    setSpec('specCuda','dotCuda', m ? `CUDA ${m[1]}` : null)
    setSpec('specTriton','dotTriton', status.versions?.triton)
    setSpec('specSage','dotSage', status.versions?.sageattention||status.versions?.spas_sage_attn)
    setSpec('specFlash','dotFlash', status.versions?.flash_attn)
    setSpec('specDiffusers','dotDiffusers', status.versions?.diffusers)
    setSpec('specTransformers','dotTransformers', status.versions?.transformers)
    setSpec('specGradio','dotGradio', status.versions?.gradio)
    setSpec('specAccelerate','dotAccelerate', status.versions?.accelerate)
    setSpec('specOnnx','dotOnnx', status.versions?.onnxruntime)
    setSpec('specOpencv','dotOpencv', status.versions?.opencv)
    setSpec('specPeft','dotPeft', status.versions?.peft)
    setSpec('specHfhub','dotHfhub', status.versions?.huggingface_hub)
  }
  const envs = await window.w2gp.manageList()
  const list=$('envList'); list.innerHTML=''
  envs.forEach(e=>{
    const div=document.createElement('div')
    div.className='env-list-item'+(e.active?' active':'')
    div.innerHTML=`<span class="env-dot"></span><span class="env-list-name">${e.name}</span><span style="font-size:0.65rem;color:#666;flex-shrink:0">${e.type}</span><button class="env-list-del" data-name="${e.name}">✕</button>`
    if(!e.active) div.addEventListener('click',async()=>{ await window.w2gp.manageSetActive(e.name); refreshDashboard() })
    div.querySelector('.env-list-del').addEventListener('click',async(ev)=>{ ev.stopPropagation(); if(confirm(`Delete "${e.name}"?`)){ await window.w2gp.manageDelete(e.name); refreshDashboard() } })
    list.appendChild(div)
  })
  loadWangpChangelog()
  loadPaths()
}

async function loadPaths() {
  const p = await window.w2gp.getInstallPaths()
  if (!p) return
  const set = (id, val) => { const e = $(id); if (e) e.textContent = val || '—' }
  set('pathAppData', p.appData)
  set('installAppDataPath', p.appData)
  // Restore model paths from desktop config
  const cfg = await window.w2gp.configLoad()
  if (cfg.modelCkptsPath) setModelPath('ckpts', cfg.modelCkptsPath)
  if (cfg.modelLorasPath) setModelPath('loras', cfg.modelLorasPath)
}

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

// ── Changelog link ──
document.addEventListener('DOMContentLoaded', () => {
  $('changelogLink')?.addEventListener('click', (e) => {
    e.preventDefault()
    window.w2gp.openExternal('https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/CHANGELOG.md')
  })
})

// ── Launch (desktop) ──
let launchCancelled = false
let launchStartTime = 0
let launchTimerInterval = null

function startLaunchTimer() {
  launchStartTime = Date.now()
  clearInterval(launchTimerInterval)
  launchTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - launchStartTime) / 1000)
    const el = $('launchTimer')
    if (el) {
      const min = Math.floor(elapsed / 60)
      const sec = elapsed % 60
      el.textContent = min > 0 ? `${min}m ${sec}s` : `${sec}s`
    }
  }, 1000)
}

function stopLaunchTimer() {
  clearInterval(launchTimerInterval)
}

// Patterns in Python output that indicate progress during startup
const LAUNCH_PATTERNS = [
  { re: /WanGP v/i,                    label: 'Initializing Wan2GP engine...',          pct: 10 },
  { re: /Loading.*model|loading model/i, label: 'Loading AI models...',                 pct: 30 },
  { re: /Running on local|Uvicorn running|gradio.*start|server.*start|started on/i, label: 'Starting Gradio web server...', pct: 70 },
  { re: /Wan2GP is ready|gradio.*ready/i, label: 'Wan2GP is ready!',                   pct: 100 },
]

function updateLaunchProgress(text) {
  for (const p of LAUNCH_PATTERNS) {
    if (p.re.test(text)) {
      $('launchStatusText').textContent = p.label
      $('launchStepLabel').textContent = p.label
      const fill = $('launchStatusFill')
      if (fill && fill.style.width !== '100%') {
        fill.style.width = Math.max(parseInt(fill.style.width) || 0, p.pct) + '%'
      }
      // Hide first-run notice once we're past model loading
      if (p.pct >= 70) {
        const notice = $('launchFirstRunNotice')
        if (notice) notice.style.display = 'none'
      }
      return true
    }
  }
  return false
}

async function doLaunch(){
  launchCancelled = false; show('launching')
  $('launchLog').textContent=''
  $('launchStatusText').textContent = 'Starting Python process...'
  $('launchStepLabel').textContent = 'Starting...'
  $('launchStatusFill').style.width = '0%'
  $('launchFirstRunNotice').style.display = 'flex'
  startLaunchTimer()

  // Parse incoming launch logs for progress
  const launchLogHandler = (text) => {
    if (text) updateLaunchProgress(text)
  }
  let unsubLaunchLog = window.w2gp.onLaunchLog(launchLogHandler)

  try {
    const result = await window.w2gp.launch()
    if(launchCancelled){ await window.w2gp.stop(); show('dashboard'); stopLaunchTimer(); return }
    $('launchStatusText').textContent = 'Wan2GP is ready!'
    $('launchStepLabel').textContent = 'Ready'
    $('launchStatusFill').style.width = '100%'
    stopLaunchTimer()
    currentUrl=result.url; show('viewer'); var wv=$('wangpView'); wv.src=result.url; setupWebviewCrashHandler()
    wv.addEventListener('did-navigate', e => appendLog(`[nav] ${e.url}`))
    wv.addEventListener('did-navigate-in-page', e => appendLog(`[nav-inpage] ${e.url}`))
    wv.addEventListener('did-start-loading', () => appendLog('[load] START'))
    wv.addEventListener('did-stop-loading', () => appendLog('[load] STOP'))
    // ponytail: one reload after load completes to force clean WebSocket handshake
    wv.addEventListener('did-finish-load', () => {
      setTimeout(() => {
        if (wv.getURL() !== 'about:blank') wv.reloadIgnoringCache()
      }, 2000)
    }, { once: true })
    window.w2gp.setViewerActive(true)
    toggleTerm('viewerTermPanel','viewerFollowBtn')
  } catch(e){
    stopLaunchTimer()
    if(!launchCancelled){
      $('launchStatusText').textContent = 'Launch failed'
      $('launchStatusFill').style.width = '0%'
      log($('launchLog'),`\n[!] ${e.message}`); appendLog(`[LAUNCH ERROR] ${e.message}`)
      setTimeout(()=>show('dashboard'),3000)
    }
  } finally {
    unsubLaunchLog()
  }
}

// ── Launch in Browser (with picker) ──
$('browserBtn').addEventListener('click', async () => {
  // If Wan2GP already running, can open in any browser
  if (currentUrl) {
    openBrowserPicker(currentUrl)
    return
  }
  // Start Wan2GP first, then pick browser
  $('browserBtn').disabled = true; $('browserBtn').textContent = 'Starting...'
  try {
    const result = await window.w2gp.launch()
    currentUrl = result.url
    openBrowserPicker(currentUrl)
  } catch (e) { alert('Browser launch failed: ' + e.message) }
  $('browserBtn').disabled = false; $('browserBtn').textContent = '↗ Launch in Browser'
})

async function openBrowserPicker(url) {
  const browsers = await window.w2gp.detectBrowsers()
  // Add system default option
  browsers.unshift({ name: '(System default)', path: null })
  const cfg = await window.w2gp.configLoad()
  let selectedPath = cfg.defaultBrowser || null

  const list = $('browserList')
  list.innerHTML = ''
  browsers.forEach(b => {
    const item = document.createElement('div')
    const isSelected = b.path === selectedPath || (!selectedPath && !b.path)
    item.className = 'browser-list-item' + (isSelected ? ' selected' : '')
    item.innerHTML = `<span class="b-icon">${b.path ? '<svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>' : '<svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'}</span><span class="b-name">${b.name}</span>`
    item.addEventListener('click', () => {
      list.querySelectorAll('.browser-list-item').forEach(el => el.classList.remove('selected'))
      item.classList.add('selected')
      selectedPath = b.path
      $('browserLaunchBtn').disabled = false
    })
    if (isSelected) $('browserLaunchBtn').disabled = false
    list.appendChild(item)
  })

  $('browserDefaultCheck').checked = !!cfg.defaultBrowser
  $('browserPicker').classList.remove('hidden')

  // Launch action
  $('browserLaunchBtn').onclick = () => {
    if (selectedPath === undefined) return
    const save = $('browserDefaultCheck').checked
    if (save) {
      cfg.defaultBrowser = selectedPath
      window.w2gp.configSave(cfg)
    }
    window.w2gp.openInBrowser(url, selectedPath)
    $('browserPicker').classList.add('hidden')
  }
  $('browserCancelBtn').onclick = () => $('browserPicker').classList.add('hidden')
}

// ── Terminal Toggle ──
function toggleTerm(panelId, followBtnId){
  const panel=$(panelId)
  if(!panel) return
  const isOpen = panel.classList.contains('open')
  document.querySelectorAll('.terminal-panel').forEach(p => p.classList.remove('open'))
  if(!isOpen){
    panel.classList.add('open')
    if(!panel.style.height||panel.style.height==='auto') panel.style.height='180px'
    renderTerminals()
    if(followBtnId){
      const btn=$(followBtnId)
      if(btn){ termFollow[panel.querySelector('.term-body')?.id]=true; btn.classList.add('active'); const ft=btn.querySelector('.follow-text'); if(ft) ft.textContent='Follow' }
    }
    const body = panel.querySelector('.term-body')
    if(body) setTimeout(()=>body.scrollTop=body.scrollHeight, 50)
  }
}

// ── Terminal Resize ──
function setupTermResize(handleId, panelId){
  const h=$(handleId); const p=$(panelId)
  if(!h||!p) return
  let drag=false, sy=0, sh=0
  h.addEventListener('mousedown',e=>{ drag=true; sy=e.clientY; sh=p.offsetHeight; h.classList.add('dragging'); document.body.style.cursor='ns-resize'; document.body.style.userSelect='none' })
  document.addEventListener('mousemove',e=>{ if(!drag)return; const nh=Math.max(80,Math.min(window.innerHeight*0.7,sh+sy-e.clientY)); p.style.height=nh+'px' })
  document.addEventListener('mouseup',()=>{ if(!drag)return; drag=false; h.classList.remove('dragging'); document.body.style.cursor=''; document.body.style.userSelect='' })
}

document.addEventListener('DOMContentLoaded',()=>{ setupTermResize('termResize','termPanel'); setupTermResize('viewerTermResize','viewerTermPanel') })

// ── Event Wiring: Dashboard ──
$('launchBtn').addEventListener('click', doLaunch)
$('cancelLaunchBtn').addEventListener('click',()=>{ launchCancelled=true; window.w2gp.stop(); show('dashboard') })
$('updateBtn').addEventListener('click',async()=>{
  $('updateBtn').disabled=true; $('updateBtn').textContent='Working...'
  try{ await window.w2gp.update(); appendLog('[*] Wan2GP update complete'); refreshDashboard() }catch(e){ appendLog('[!] Update failed: '+e.message); alert('Update: '+e.message) }
  $('updateBtn').disabled=false; $('updateBtn').textContent='↻ Update Wan2GP'
})
document.querySelectorAll('.theme-toggle').forEach(btn => btn.addEventListener('click', toggleTheme))
$('upgradeBtn').addEventListener('click',async()=>{
  openSettings(); $('settingsLog').textContent='Upgrade running (check Terminal for output)...\n'
  try{ await window.w2gp.upgrade(); appendLog('[*] Wan2GP upgrade complete'); log($('settingsLog'),'\n[*] Done'); refreshDashboard() }catch(e){ appendLog('[!] Upgrade failed: '+e.message); log($('settingsLog'),'\n[!] '+e.message) }
})
$('refreshBtn').addEventListener('click',()=>{ refreshDashboard(); loadHardware() })
$('refreshBtn2').addEventListener('click',()=>{ refreshDashboard(); loadHardware() })
$('settingsBtn').addEventListener('click',()=>{ openSettings(); $('settingsLog').textContent='' })

$('dashTermBtn').addEventListener('click',()=>toggleTerm('termPanel','termFollowBtn'))
$('viewTermBtn').addEventListener('click',()=>toggleTerm('viewerTermPanel','viewerFollowBtn'))

$('termFollowBtn').addEventListener('click',()=>{
  termFollow.termBody=!termFollow.termBody
  const b=$('termFollowBtn'); b.classList.toggle('active')
  const ft=b.querySelector('.follow-text')
  if(ft) ft.textContent=termFollow.termBody?'Follow':'Paused'
  if(termFollow.termBody){ const e=$('termBody'); if(e) setTimeout(()=>e.scrollTop=e.scrollHeight,10) }
})
$('viewerFollowBtn').addEventListener('click',()=>{
  termFollow.viewerTermBody=!termFollow.viewerTermBody
  const b=$('viewerFollowBtn'); b.classList.toggle('active')
  const ft=b.querySelector('.follow-text')
  if(ft) ft.textContent=termFollow.viewerTermBody?'Follow':'Paused'
  if(termFollow.viewerTermBody){ const e=$('viewerTermBody'); if(e) setTimeout(()=>e.scrollTop=e.scrollHeight,10) }
})

$('viewerTermCloseBtn').addEventListener('click',(e)=>{ e.stopPropagation(); const p=$('viewerTermPanel'); if(p) p.classList.remove('open') })

// ── Installer tabs ──
$('installTasksTab').addEventListener('click',()=>{ $('installTasks').classList.remove('hidden'); $('installTerm').classList.add('hidden'); $('installTasksTab').classList.add('active'); $('installTermTab').classList.remove('active') })
$('installTermTab').addEventListener('click',()=>{ $('installTasks').classList.add('hidden'); $('installTerm').classList.remove('hidden'); $('installTasksTab').classList.remove('active'); $('installTermTab').classList.add('active'); renderTerminals() })

// ── Viewer ──
$('viewBackBtn').addEventListener('click',async()=>{ await window.w2gp.stop(); window.w2gp.setViewerActive(false); show('dashboard'); refreshDashboard() })
$('viewBrowserBtn').addEventListener('click',()=>{ if(currentUrl) openBrowserPicker(currentUrl) })

// ── Server restart overlay ──
function showRestartOverlay(exitCode) {
  const ov = $('serverRestartOverlay')
  if (!ov) return
  $('restartTitle').textContent = 'Wan2GP server stopped'
  $('restartMessage').textContent = `Process exited (code ${exitCode}). Click "Try Again" to restart.`
  $('restartNowBtn').classList.remove('hidden')
  $('restartNowBtn').disabled = false
  $('restartDashboardBtn').classList.remove('hidden')
  ov.classList.remove('hidden')
}

$('restartNowBtn').addEventListener('click', async () => {
  $('restartTitle').textContent = 'Starting...'
  $('restartMessage').textContent = 'Please wait...'
  $('restartNowBtn').disabled = true
  try {
    const result = await window.w2gp.launch()
    currentUrl = result.url
    $('serverRestartOverlay').classList.add('hidden')
    var wv = $('wangpView')
    wv.src = result.url
  } catch(e) {
    $('restartTitle').textContent = 'Restart failed'
    $('restartMessage').textContent = e.message
    $('restartNowBtn').disabled = false
  }
})

$('restartDashboardBtn').addEventListener('click', async () => {
  await window.w2gp.stop()
  window.w2gp.setViewerActive(false)
  show('dashboard')
  refreshDashboard()
})

// ── Settings ──
$('settingsBackBtn').addEventListener('click',closeSettings)
$('settingsUpdateBtn').addEventListener('click',async()=>{ $('settingsLog').textContent='Updating...\n'; try{ await window.w2gp.update(); log($('settingsLog'),'\n[*] Done'); refreshDashboard() }catch(e){ log($('settingsLog'),'\n[!] '+e.message) } })
$('settingsUpgradeBtn').addEventListener('click',async()=>{ $('settingsLog').textContent='Upgrading...\n'; try{ await window.w2gp.upgrade(); log($('settingsLog'),'\n[*] Done'); refreshDashboard() }catch(e){ log($('settingsLog'),'\n[!] '+e.message) } })
$('settingsReinstallBtn').addEventListener('click',async()=>{ if(!confirm('Re-run the full installer?'))return; $('settingsLog').textContent='Reinstalling...\n'; try{ await window.w2gp.install(selectedEnvType); log($('settingsLog'),'\n[*] Done'); refreshDashboard() }catch(e){ log($('settingsLog'),'\n[!] '+e.message) } })

// ── GitHub token config in settings ──
$('tokenSaveBtn')?.addEventListener('click', async () => {
  const token = $('githubTokenInput')?.value
  if (!token) return
  const cfg = await window.w2gp.configLoad()
  cfg.githubToken = token
  await window.w2gp.configSave(cfg)
  log($('settingsLog'), 'GitHub token saved — app will now check for updates')
})
$('tokenClearBtn')?.addEventListener('click', async () => {
  const cfg = await window.w2gp.configLoad()
  cfg.githubToken = null
  await window.w2gp.configSave(cfg)
  if ($('githubTokenInput')) $('githubTokenInput').value = ''
  log($('settingsLog'), 'GitHub token cleared')
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
      $('updateText').textContent = `v${status.version} available`
      $('updateDownloadBtn').classList.remove('hidden')
      $('updateInstallBtn').classList.add('hidden')
      $('updateActions').classList.remove('hidden')
      $('updateProgress').classList.add('hidden')
      $('updateBanner').classList.remove('hidden')
      $('updateDismissBtn').classList.remove('hidden')
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
      // Auth/rate-limit error. Suggest token.
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

$('updateCheckBtn').addEventListener('click', () => {
  $('updateCheckBtn').disabled = true; $('updateCheckBtn').textContent = 'Checking...'
  window.w2gp.checkUpdate()
  setTimeout(() => { $('updateCheckBtn').disabled = false; $('updateCheckBtn').textContent = '⬆ Check Updates' }, 10000)
})

$('updateDownloadBtn').addEventListener('click', () => window.w2gp.downloadUpdate())
$('updateInstallBtn').addEventListener('click', () => window.w2gp.installUpdate())
$('updateDismissBtn').addEventListener('click', () => $('updateBanner').classList.add('hidden'))
