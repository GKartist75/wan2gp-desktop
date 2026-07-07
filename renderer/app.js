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
    if (wv && currentUrl) { wv.src = currentUrl; setTimeout(injectWebviewDropHandler, 2000) }
  }, 2000)
}
function onWebviewLoaded() { wvCrashRetry = 0 }

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
// Insert zero-width spaces after path separators so paths wrap at directory boundaries
function breakPath(p) { return p ? String(p).replace(/[\\/]/g, '$&\u200B') : p }
function openSettings() {
  $('settingsPanel').classList.add('open'); $('settingsOverlay').classList.add('visible')
  // Load saved launch args and port
  window.w2gp.configLoad().then(function(cfg) {
    if ($('launchArgsInput')) $('launchArgsInput').value = cfg.launchArgs || ''
    if ($('portInput')) $('portInput').value = cfg.serverPort || 17861
  })
}
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

// Batch selection state
var _sidebarMulti = [] // paths of multi-selected files
var _sidebarSort = 'date' // 'date' or 'name'
var _sidebarSortAsc = false
var _sidebarZoom = 32 // ponytail: thumbnail zoom level (px)
var _metaCache = {} // ponytail: metadata cache keyed by file path, for filter

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  const installed = await window.w2gp.checkInstalled()
  setupScrollUnfollow('termBody','dashTermFollowBtn')
  setupScrollUnfollow('installTermBody','installFollowBtn')
  setupScrollUnfollow('viewerTermBody','viewerFollowBtn')

  // ponytail: strip ANSI so terminal shows clean text, not escape codes
  window.w2gp.onSetupOutput(t => appendLog(t.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,'')))
  window.w2gp.onLaunchLog(t => appendLog(t.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,'')))
  window.w2gp.onSetupOutput(t => { const c=t.replace(/[\x00-\x1f]/g,'').trim(); if(c) log($('settingsLog'),c) })
  window.w2gp.onLaunchLog(t => { const c=t.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,''); if(c.trim()) { log($('launchLog'),c); log($('viewerTermBody'),c) } })
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
    appendLog('[*] Wan2GP restarted, reloading...')
    $('serverRestartOverlay').classList.add('hidden')
    currentUrl = url
    var wv = $('wangpView')
    wv.src = url
    // Re-inject drop handler after Gradio loads
    setTimeout(() => injectWebviewDropHandler(), 2500)
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

  // ── API status indicator polling ──
  var apiStatusEl = $('apiStatus')
  var apiDot = $('apiDot')
  var apiLabel = $('apiLabel')
  async function checkApi() {
    try {
      var status = await window.w2gp.checkApiStatus()
      if (status === 'online') {
        apiDot.className = 'api-dot online'
        apiStatusEl.className = 'api-status online'
        apiLabel.textContent = 'Online'
      } else if (status === 'starting') {
        apiDot.className = 'api-dot checking'
        apiStatusEl.className = 'api-status'
        apiLabel.textContent = 'Starting...'
      } else {
        apiDot.className = 'api-dot offline'
        apiStatusEl.className = 'api-status offline'
        apiLabel.textContent = 'Offline'
      }
    } catch (e) {
      apiDot.className = 'api-dot offline'
      apiStatusEl.className = 'api-status offline'
      apiLabel.textContent = 'Offline'
    }
  }
  // Check immediately, then every 5s
  checkApi()
  setInterval(checkApi, 5000)

  if (installed.repo && installed.env) {
    show('dashboard')
    refreshDashboard()

  } else {
    $('splashStatus').textContent = 'First-time setup...'
    const hw = await window.w2gp.detectHardware()
    $('installCpu').textContent=hw.cpu||'—'; $('installRam').textContent=hw.ram||'—'
    $('installGpu').textContent=hw.gpu||'—'; $('installVram').textContent=hw.vram||'—'
    loadPaths()
    // Auto-detect model folders
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
$('reinstallFreshBtn').addEventListener('click', () => doInstall(null, 'reinstall'))
$('reinstallUpdateBtn').addEventListener('click', () => doInstall(null, 'update'))
$('reinstallSkipBtn').addEventListener('click', () => doInstall(null, 'skip'))

// ── Browse repo path ──
$('browseAppDataPath')?.addEventListener('click', async () => {
  const folder = await window.w2gp.selectFolder()
  if (!folder) return
  await window.w2gp.setDataDir(folder)
  loadPaths()
})

$('clearAppDataPath')?.addEventListener('click', async () => {
  await window.w2gp.resetDataDir()
  loadPaths(true) // don't reset model paths when clearing install location
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
  show('installer'); resetTasks()
  // Disable env selector + hide install button during install
  $('envTypeSelect').classList.add('disabled')
  document.querySelectorAll('.env-type-btn').forEach(b => b.disabled = true)
  $('installStartBtn').classList.add('hidden')
  $('installSubtitle').textContent='Setting up Wan2GP...'
  const installed = await window.w2gp.checkInstalled()
  if(installed.repo) {
    // Show reinstall choice UI
    $('reinstallChoice').classList.remove('hidden')
    $('installSubtitle').textContent='Wan2GP is already installed.'
    return // wait for user to pick a button
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
    await window.w2gp.reinstall()
  } else {
    $('installSubtitle').textContent='Update instead of fresh install...'
    skipClone = true
  }
  if(!skipClone) { taskStart('clone'); prevPhaseId = 'clone' } else { taskComplete('clone'); prevPhaseId = 'clone' }
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
  loadDesktopInfo()
  loadModelPaths()
}

async function loadModelPaths() {
  const paths = await window.w2gp.getModelPaths()
  $('dashCkptPath').textContent = breakPath(paths?.checkpoints) || '(default)'; $('dashCkptPath').title = paths?.checkpoints || ''
  $('dashLoraPath').textContent = breakPath(paths?.loras) || '(default)'; $('dashLoraPath').title = paths?.loras || ''
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
}

$('desktopRepoLink').addEventListener('click', (e) => {
  e.preventDefault()
  window.w2gp.openExternal('https://github.com/GKartist75/wan2gp-desktop')
})

async function loadPaths(skipModelPaths) {
  const p = await window.w2gp.getInstallPaths()
  if (!p) return
  const set = (id, val) => { const e = $(id); if (e) { e.textContent = breakPath(val) || '—'; e.title = val || '' } }
  set('pathAppData', p.appData)
  set('installAppDataPath', p.appData + '\\Wan2GP')
  // ponytail: show free disk space on install drive
  window.w2gp.getDiskSpace().then(function(d) {
    if (!d) return;
    var freeGb = (d.free / 1073741824).toFixed(1);
    $('pathFreeSpace').textContent = freeGb + ' GB free';
  });
  // ponytail: model paths default to subdirs of the chosen install folder
  // skipModelPaths=true when user clears the install location — don't trample custom ckpt/lora
  if (!skipModelPaths && p.appData) {
    setModelPath('ckpts', p.appData + '\\ckpt')
    setModelPath('loras', p.appData + '\\lora')
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
  // If process already running, just show viewer
  const running = await window.w2gp.isRunning()
  if (running && currentUrl) {
    show('viewer');
    var wv = $('wangpView');
    if (wv.src !== currentUrl) wv.src = currentUrl;
    window.w2gp.setViewerActive(true);
    setTimeout(refreshSidebar, 1500);
    setTimeout(injectWebviewDropHandler, 2000);
    updateLaunchProgress('');
    openFloatingTerminal();
    return
  }

  launchCancelled = false; show('launching')
  $('launchLog').textContent=''
  $('launchStatusText').textContent = 'Starting Python process...'
  $('launchStepLabel').textContent = 'Starting...'
  $('launchStatusFill').style.width = '0%'
  $('launchFirstRunNotice').style.display = 'flex'
  startLaunchTimer()

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
    currentUrl=result.url; show('viewer'); var wv=$('wangpView'); wv.src=result.url
    wv.removeEventListener('crashed',onWebviewCrash); wv.addEventListener('crashed',onWebviewCrash)
    wv.removeEventListener('did-finish-load',onWebviewLoaded); wv.addEventListener('did-finish-load',onWebviewLoaded)
    window.w2gp.setViewerActive(true)
    setTimeout(refreshSidebar, 1500)
    setTimeout(injectWebviewDropHandler, 2000)
    openFloatingTerminal()
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
    const cfg = await window.w2gp.configLoad()
    if (cfg.defaultBrowser) { window.w2gp.openInBrowser(currentUrl, cfg.defaultBrowser); return }
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
      // Auto-check remember when user picks a browser
      $('browserDefaultCheck').checked = true
    })
    if (isSelected) $('browserLaunchBtn').disabled = false
    list.appendChild(item)
  })

  $('browserDefaultCheck').checked = !!cfg.defaultBrowser && !!selectedPath
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
    panel.style.display = '' // clear any lingering inline style
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
  const endDrag = () => {
    if(!drag) return
    drag=false; h.classList.remove('dragging')
    document.body.style.cursor=''; document.body.style.userSelect=''
  }
  h.addEventListener('mousedown',e=>{ drag=true; sy=e.clientY; sh=p.offsetHeight; h.classList.add('dragging'); document.body.style.cursor='ns-resize'; document.body.style.userSelect='none' })
  window.addEventListener('mousemove',e=>{ if(!drag)return; const nh=Math.max(80,Math.min(window.innerHeight*0.7,sh+sy-e.clientY)); p.style.height=nh+'px' })
  window.addEventListener('mouseup', endDrag)
  window.addEventListener('mouseleave', endDrag)
}

document.addEventListener('DOMContentLoaded',()=>{ setupTermResize('viewerTermResize','viewerTermPanel') })

// ── Event Wiring: Dashboard ──
$('launchBtn').addEventListener('click', doLaunch)
$('cancelLaunchBtn').addEventListener('click',()=>{ launchCancelled=true; window.w2gp.stop(); show('dashboard') })
$('updateBtn').addEventListener('click',async()=>{
  $('updateBtn').disabled=true; $('updateBtn').textContent='Working...'
  try{ await window.w2gp.update(); appendLog('[*] Wan2GP update complete'); refreshDashboard() }catch(e){ appendLog('[!] Update failed: '+e.message); alert('Update: '+e.message) }
  $('updateBtn').disabled=false; $('updateBtn').textContent='↻ Update Wan2GP'
})
document.querySelectorAll('.theme-toggle').forEach(btn => btn.addEventListener('click', toggleTheme))

// Settings tab switching
document.querySelectorAll('.settings-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.settings-tab').forEach(function(t) { t.classList.remove('active') })
    document.querySelectorAll('.settings-tab-content').forEach(function(c) { c.classList.remove('active') })
    tab.classList.add('active')
    var tabContent = document.querySelector('.settings-tab-content[data-tab="' + tab.dataset.tab + '"]')
    if (tabContent) tabContent.classList.add('active')
    // Scroll the clicked tab into view within the tab bar
    tab.closest('.settings-tabs')?.querySelector('.settings-tabs-inner')?.scrollTo({ left: tab.offsetLeft - 80, behavior: 'smooth' })
  })
})
$('refreshBtn').addEventListener('click',()=>{ refreshDashboard(); loadHardware() })
$('settingsBtn').addEventListener('click',()=>{ openSettings(); $('settingsLog').textContent='' })
$('dashTermBtn').addEventListener('click', openFloatingTerminal)
$('taskMgrBtn').addEventListener('click',()=>{ window.w2gp.openTaskManager() })
// Viewer inline terminal toggle — closes floating terminal if open
$('viewTermBtn').addEventListener('click',function(){
  window.w2gp.closeTerminalWindow();
  toggleTerm('viewerTermPanel','viewerFollowBtn');
})
$('viewTaskMgrBtn').addEventListener('click',()=>{ window.w2gp.openTaskManager() })

$('dashTermFollowBtn').addEventListener('click',()=>{
  termFollow.termBody=!termFollow.termBody
  const b=$('dashTermFollowBtn'); b.classList.toggle('active')
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
$('installFollowBtn').addEventListener('click',()=>{
  termFollow.installTermBody=!termFollow.installTermBody
  const b=$('installFollowBtn'); b.classList.toggle('active')
  const ft=b.querySelector('.follow-text')
  if(ft) ft.textContent=termFollow.installTermBody?'Follow':'Paused'
  if(termFollow.installTermBody){ const e=$('installTermBody'); if(e) setTimeout(()=>e.scrollTop=e.scrollHeight,10) }
})

$('viewerTermCloseBtn').addEventListener('click',(e)=>{ e.stopPropagation(); const p=$('viewerTermPanel'); if(p) p.classList.remove('open') })

// ── Floating / Dockable Terminal ──
function openFloatingTerminal() {
  window.w2gp.openTerminalWindow()
  // Collapse viewer inline terminal (dashboard card stays visible)
  var tp = $('viewerTermPanel')
  if (tp) { tp.classList.remove('open') }
}

$('viewerTermFloatBtn')?.addEventListener('click', openFloatingTerminal)
$('dashTermFloatBtn')?.addEventListener('click', openFloatingTerminal)

// Apply dock position to viewer layout
function applyDockPosition(pos) {
  var vs = document.querySelector('.viewer-stack')
  if (!vs) return
  vs.classList.remove('dock-bottom', 'dock-top', 'dock-floating')
  var tp = $('viewerTermPanel')
  if (pos === 'floating') {
    vs.classList.add('dock-floating')
    openFloatingTerminal()
    if (tp) tp.style.display = 'none'
  } else { // top or bottom → show inline viewer terminal
    vs.classList.add(pos === 'top' ? 'dock-top' : 'dock-bottom')
    if (tp) { tp.style.display = ''; tp.classList.add('open'); tp.style.height = '100px' }
  }
}

// Listen for dock position changes (from floating window)
window.w2gp.onTerminalDocked(function(pos) {
  applyDockPosition(pos)
  window.w2gp.configLoad().then(function(cfg) {
    cfg.terminalDock = pos
    window.w2gp.configSave(cfg)
  })
})

// On load: dashboard terminal card is always visible. No auto-float.

// ── Installer tabs ──
// ── Viewer ──
$('viewBackBtn').addEventListener('click',async()=>{ window.w2gp.setViewerActive(false); window.w2gp.closeTerminalWindow(); show('dashboard'); refreshDashboard() })
// ── Output sidebar ──


let sidebarOpen = true
let sidebarDir = ''
let sidebarDateRange = 'all' // 'today','week','month','all'

// Thumbnail cache: path -> blob URL (LRU, max 20 entries to cap memory)
var thumbCache = new Map()
function getThumbSrc(filePath, ext, cb) {
  if (thumbCache.has(filePath)) {
    var url = thumbCache.get(filePath)
    thumbCache.delete(filePath); thumbCache.set(filePath, url) // LRU bump
    cb(url); return
  }
  window.w2gp.readLocalFile(filePath).then(function(r) {
    if (!r) { cb(''); return }
    var mime = r.mime
    if (mime === 'application/octet-stream') {
      var mm = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'}[ext]
      if (mm) mime = mm; else { cb(''); return }
    }
    var bin = atob(r.data), bytes = new Uint8Array(bin.length)
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    var blob = new Blob([bytes], { type: mime })
    var url = URL.createObjectURL(blob)
    // Evict oldest if over limit
    if (thumbCache.size >= 20) {
      var old = thumbCache.keys().next().value
      URL.revokeObjectURL(old)
      thumbCache.delete(old)
    }
    thumbCache.set(filePath, url)
    cb(url)
  }).catch(function() { cb('') })
}

function refreshSidebar() {
  thumbCache.clear() // ponytail: clear thumbnail cache on refresh
  window.w2gp.listOutputFiles(sidebarDir || undefined).then(function(r) {
    var dir = r.dir, files = r.files, folders = r.folders
    sidebarDir = dir
    var el = $('sidebarFiles')
    if (!files.length && !folders.length) {
      el.innerHTML = '<div class="sidebar-empty">No outputs yet</div>'
      return
    }
    // Preserve selection across re-render
    var oldSel = el.querySelector('.sidebar-file.selected')
    var selectedPath = oldSel ? oldSel.dataset.path : null

    // Apply filter chips (type)
    var activeType = $('sidebarFilterChips').querySelector('.fc-chip.active')
    var typeFilter = activeType ? activeType.dataset.type : 'all'
    if (typeFilter !== 'all') {
      files = files.filter(function(f) { return f.type === typeFilter })
    }

    // Apply date filter
    var dateRange = sidebarDateRange || 'all'
    if (dateRange !== 'all') {
      var now = new Date()
      var cutoff = new Date(now)
      if (dateRange === 'today') cutoff.setHours(0, 0, 0, 0)
      else if (dateRange === 'week') cutoff.setDate(now.getDate() - now.getDay())
      else if (dateRange === 'month') cutoff.setDate(1)
      files = files.filter(function(f) {
        return f.mtime >= cutoff.getTime()
      })
    }

    // Build HTML
    var items = ''
    if (_sidebarSort === 'name') {
      files.sort(function(a, b) { var r = a.name.localeCompare(b.name); return _sidebarSortAsc ? r : -r })
    } else {
      if (_sidebarSortAsc) files.reverse()
    }
    for (var i = 0; i < folders.length; i++) {
      var fo = folders[i]
      items += '<div class="sidebar-file sidebar-folder" data-path="' + fo.path.replace(/\"/g,'&quot;') + '" data-type="folder" data-name="' + fo.name.replace(/\"/g,'&quot;') + '">'
      items += '<span class="sidebar-file-thumb" style="text-align:center;font-size:18px;line-height:32px">📁</span>'
      items += '<span class="sidebar-file-name">' + fo.name + '</span>'
      items += '<span class="sidebar-file-type">dir</span></div>'
    }
    for (var i = 0; i < files.length; i++) {
      var f = files[i]
      var selCls = f.path === selectedPath ? ' selected' : ''
      // Check cache for prompt text
      var cachedMeta = _metaCache[f.path]
      var promptText = ''
      if (cachedMeta && cachedMeta.prompt) {
        promptText = cachedMeta.prompt.substring(0, 200) + (cachedMeta.prompt.length > 200 ? '…' : '')
      }
      // Format date
      var d = new Date(f.mtime)
      var now = new Date()
      var dateStr = d.toLocaleDateString([], {month:'short', day:'numeric'})
      if (d.toDateString() === now.toDateString()) {
        dateStr = d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
      } else if (d.getFullYear() !== now.getFullYear()) {
        dateStr = d.toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'})
      }
      items += '<div class="sidebar-file' + selCls + '" draggable="true" data-path="' + f.path.replace(/\\"/g,'&quot;') + '" data-type="' + f.type + '" data-name="' + f.name.replace(/\\"/g,'&quot;') + '" data-date="' + f.mtime + '">'
      items += '<img class="sidebar-file-thumb" src="' + (thumbCache.get(f.path) || '') + '" loading="lazy">'
      items += '<span class="sidebar-file-prompt" title="' + (cachedMeta && cachedMeta.prompt ? cachedMeta.prompt.replace(/\\"/g,'&quot;') : '') + '">' + promptText + '</span>'
      items += '<span class="col-divider" data-col="prompt-date"></span>'
      items += '<span class="sidebar-file-date">' + dateStr + '</span>'
      items += '<span class="col-divider" data-col="date-name"></span>'
      items += '<span class="sidebar-file-name">' + f.name + '</span>'
      items += '<span class="sidebar-file-type">' + (f.type === 'video' ? '🎬' : f.type === 'audio' ? '🎵' : '🖼') + '</span></div>'
    }
    el.innerHTML = items

    // ponytail: set metadata data attributes from cache for filter
    for (var fi = 0; fi < files.length; fi++) {
      var m = _metaCache[files[fi].path]
      if (!m) continue
      var sel = el.querySelector('.sidebar-file[data-path="' + files[fi].path.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]')
      if (!sel) continue
      if (m.prompt) sel.setAttribute('data-prompt', m.prompt.substring(0, 200))
      if (m.seed !== undefined && m.seed !== null) sel.setAttribute('data-seed', String(m.seed))
      if (m.model_type) sel.setAttribute('data-model', m.model_type)
    }

    // Load thumbnails async, 5 at a time to avoid IPC flood
    function loadThumbs(start) {
      var batch = Math.min(start + 5, files.length)
      for (var i = start; i < batch; i++) {
        (function(f) {
          var ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase()
          getThumbSrc(f.path, ext, function(url) {
            if (!url) return
            var cssPath = f.path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
            var imgs = el.querySelectorAll('.sidebar-file[data-path="' + cssPath + '"] .sidebar-file-thumb')
            for (var j = 0; j < imgs.length; j++) imgs[j].src = url
          })
        })(files[i])
      }
      if (batch < files.length) setTimeout(function() { loadThumbs(batch) }, 100)
    }
    loadThumbs(0)

    // Load metadata batch (5 at a time) — Node.js native reader fills _metaCache (brute-force JSON scan, all formats)
    var pendingMeta = []
    for (var pi = 0; pi < files.length; pi++) {
      if (!_metaCache[files[pi].path]) pendingMeta.push(files[pi].path)
    }
    function loadMetaBatch(start) {
      var batch = Math.min(start + 5, pendingMeta.length)
      for (var mi = start; mi < batch; mi++) {
        (function(metaPath) {
          window.w2gp.readFileMetadata(metaPath).then(function(meta) {
            if (meta && typeof meta === 'object' && Object.keys(meta).length) {
              _metaCache[metaPath] = meta
              // Update prompt text in-place
              var cssPath = metaPath.replace(/\\\\/g, '\\\\\\\\').replace(/\"/g, '\\\\\"')
              var fileEl = el.querySelector('.sidebar-file[data-path=\"' + cssPath + '\"]')
              if (fileEl) {
                var pp = fileEl.querySelector('.sidebar-file-prompt')
                if (pp && meta.prompt) {
                  var short = meta.prompt.substring(0, 50) + (meta.prompt.length > 50 ? '…' : '')
                  pp.textContent = short
                  pp.title = meta.prompt
                }
                if (meta.prompt) fileEl.setAttribute('data-prompt', meta.prompt.substring(0, 200))
                if (meta.seed !== undefined && meta.seed !== null) fileEl.setAttribute('data-seed', String(meta.seed))
                if (meta.model_type) fileEl.setAttribute('data-model', meta.model_type)
              }
              // If this was the selected file, show its metadata immediately from cache
              if (selectedPath === metaPath) {
                showMetaFromCache(metaPath)
              }
            }
          }).catch(function() {})
        })(pendingMeta[mi])
      }
      if (batch < pendingMeta.length) setTimeout(function() { loadMetaBatch(batch) }, 80)
    }
    loadMetaBatch(0)

    // Event delegation via a single capture-phase handler (no listener leak on re-render)
    if (!el._delegateHandler) {
      el._delegateHandler = function(e) {
        var item = e.target.closest('.sidebar-file')
        if (!item) return
        if (e.type === 'click') {
          if (item.dataset.type === 'folder') {
            sidebarDir = item.dataset.path
            refreshSidebar()
            return
          }
          if (!e.ctrlKey && !e.metaKey) {
            el.querySelectorAll('.sidebar-file').forEach(function(x) { x.classList.remove('selected') })
            _sidebarMulti = []
          }
          item.classList.add('selected')
          if (e.ctrlKey || e.metaKey) {
            var idx = _sidebarMulti.indexOf(item.dataset.path)
            if (idx > -1) { _sidebarMulti.splice(idx, 1); item.classList.remove('selected') }
            else { _sidebarMulti.push(item.dataset.path) }
          } else {
            _sidebarMulti = [item.dataset.path]
          }
          try { navigator.clipboard.writeText(item.dataset.path) } catch {}
          var actionBar = $('sidebarActions')
          if (actionBar) actionBar.style.display = 'flex'
          loadSidebarMeta(item.dataset.path)
        } else if (e.type === 'dblclick') {
          if (item.dataset.type === 'folder') return
          console.log('[DBL] double-click:', item.dataset.path)
          openPreview(item.dataset.path, item.dataset.name)
        } else if (e.type === 'dragstart') {
          e.dataTransfer.setData('text/plain', item.dataset.path)
          window.w2gp.setPendingDragPath(item.dataset.path)
          item.classList.add('dragging')
          // Use the thumbnail image as drag ghost (covers whole row drag)
          var thumb = item.querySelector('.sidebar-file-thumb')
          if (thumb && thumb.tagName === 'IMG' && thumb.src) {
            e.dataTransfer.setDragImage(thumb, 16, 16)
          }
        } else if (e.type === 'dragend') {
          item.classList.remove('dragging')
        }
      }
      el.addEventListener('click', el._delegateHandler)
      el.addEventListener('dblclick', el._delegateHandler)
      el.addEventListener('dragstart', el._delegateHandler)
      el.addEventListener('dragend', el._delegateHandler)
      el.addEventListener('contextmenu', function(ce) {
        var item = ce.target.closest('.sidebar-file')
        if (!item || item.dataset.type === 'folder') return
        ce.preventDefault()
        var path = item.dataset.path, name = item.dataset.name
        var existing = document.getElementById('ctxMenu')
        if (existing) existing.remove()
        var cm = document.createElement('div')
        cm.id = 'ctxMenu'
        cm.style.cssText = 'position:fixed;left:'+ce.clientX+'px;top:'+ce.clientY+'px;z-index:9999;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:4px;min-width:150px;box-shadow:0 4px 16px rgba(0,0,0,0.3)'
        var items = [
          { l:'Copy path', fn:function(){ navigator.clipboard.writeText(path); cm.remove() } },
          { l:'Open in Explorer', fn:function(){ window.w2gp.openExternal('file:///'+path.replace(/\\/g,'/')); cm.remove() } },
          { sep:true },
          { l:'Delete', fn:function(){ if(confirm('Delete '+name+'?')){ window.w2gp.deleteFiles([path]).then(function(){ refreshSidebar() }) } cm.remove() } }
        ]
        for (var mi = 0; mi < items.length; mi++) {
          if (items[mi].sep) { var hr = document.createElement('hr'); hr.style.cssText = 'border:none;border-top:1px solid var(--border);margin:3px 0'; cm.appendChild(hr) }
          else { (function(it){ var b = document.createElement('button'); b.textContent = it.l; b.style.cssText = 'display:block;width:100%;padding:5px 10px;border:none;background:transparent;color:var(--text-primary);cursor:pointer;text-align:left;border-radius:3px;font:500 0.6875rem Geist,sans-serif'; b.onmouseenter=function(){this.style.background='var(--surface-hover)'}; b.onmouseleave=function(){this.style.background='transparent'}; b.onclick=it.fn; cm.appendChild(b) })(items[mi]) }
        }
        document.body.appendChild(cm)
        document.addEventListener('click', function _c(){ cm.remove(); document.removeEventListener('click', _c) }, {once:true})
      })
    }
    // Hide meta/actions if no file selected
    if (!el.querySelector('.sidebar-file.selected') && !_sidebarMulti.length) {
      $('sidebarActions').style.display = 'none'
      $('sidebarMeta').style.display = 'none'
    }
  }).catch(function() {})
}

// ── Column divider drag resize ──
var _colDrag = null
$('sidebarFiles').addEventListener('mousedown', function(e) {
  var div = e.target.closest('.col-divider')
  if (!div) return
  e.preventDefault()
  var parent = $('sidebarFiles')
  var rect = parent.getBoundingClientRect()
  _colDrag = { div: div, startX: e.clientX, parentLeft: rect.left }
  div.classList.add('dragging')
})
window.addEventListener('mousemove', function(e) {
  if (!_colDrag) return
  var dx = e.clientX - _colDrag.startX
  var parent = $('sidebarFiles')
  // Adjust prompt width when dragging prompt-date divider
  if (_colDrag.div.dataset.col === 'prompt-date') {
    var current = parseFloat(localStorage.getItem('colPromptWidth')) || 120
    var newW = Math.max(40, current + dx)
    parent.style.setProperty('--col-prompt-width', newW + 'px')
  }
  // Adjust date width when dragging date-name divider
  if (_colDrag.div.dataset.col === 'date-name') {
    var current = parseFloat(localStorage.getItem('colDateWidth')) || 60
    var newW = Math.max(30, current + dx)
    parent.style.setProperty('--col-date-width', newW + 'px')
  }
})
window.addEventListener('mouseup', function() {
  if (!_colDrag) return
  _colDrag.div.classList.remove('dragging')
  // Save widths
  var parent = $('sidebarFiles')
  var pw = parent.style.getPropertyValue('--col-prompt-width')
  if (pw) localStorage.setItem('colPromptWidth', parseFloat(pw))
  var dw = parent.style.getPropertyValue('--col-date-width')
  if (dw) localStorage.setItem('colDateWidth', parseFloat(dw))
  _colDrag = null
})

// Restore saved column widths on load
try {
  var pw = localStorage.getItem('colPromptWidth')
  var dw = localStorage.getItem('colDateWidth')
  if (pw) $('sidebarFiles').style.setProperty('--col-prompt-width', pw + 'px')
  if (dw) $('sidebarFiles').style.setProperty('--col-date-width', dw + 'px')
} catch {}

// Sidebar action buttons
function getSelectedFilePath() {
  if (_sidebarMulti.length) return _sidebarMulti[0]
  var sel = $('sidebarFiles').querySelector('.sidebar-file.selected')
  return sel ? sel.dataset.path : null
}
function getSelectedMeta() {
  var p = getSelectedFilePath()
  return p && _metaCache[p] ? _metaCache[p] : null
}

$('sidebarDeleteBtn').addEventListener('click', async () => {
  var paths = _sidebarMulti.length > 0 ? _sidebarMulti : []
  if (!paths.length) {
    var sel = $('sidebarFiles').querySelector('.sidebar-file.selected')
    if (sel) paths = [sel.dataset.path]
  }
  if (!paths.length) return
  var name = paths.length === 1 ? paths[0].split('\\\\').pop().split('/').pop() : paths.length + ' files'
  if (!confirm('Delete ' + name + '?')) return
  var r = await window.w2gp.deleteFiles(paths)
  _sidebarMulti = []
  if (r && r.ok) { refreshSidebar() } else { alert('Delete failed' + (r && r.error ? ': ' + r.error : '')) }
})
$('sidebarSendBtn').addEventListener('click', function() {
  var p = getSelectedFilePath(); if (p) { flashBtn(this); loadSettingsViaApi(p) }
})
$('sidebarVariBtn').addEventListener('click', function() {
  var p = getSelectedFilePath()
  if (!p) return
  var wv = $('wangpView')
  if (!wv || !wv.src || wv.src === 'about:blank') return
  flashBtn(this)
  loadSettingsViaApi(p)
  setTimeout(function() { if (wv) injectRandomSeed(wv) }, 2000)
})
$('sidebarPNSBtn').addEventListener('click', function() {
  var p = getSelectedFilePath()
  if (!p) return
  var wv = $('wangpView')
  if (!wv || !wv.src || wv.src === 'about:blank') return
  flashBtn(this)
  loadSettingsViaApi(p)
  setTimeout(function() { if (wv) injectRandomSeed(wv) }, 2000)
})
$('sidebarCopyBtn').addEventListener('click', function() {
  var meta = getSelectedMeta()
  if (!meta) return
  var text = JSON.stringify(meta, null, 2)
  window.w2gp.clipboardWrite(text).then(function() {
    var btn = $('sidebarCopyBtn')
    var orig = btn.textContent
    btn.textContent = '✓'
    setTimeout(function() { btn.textContent = orig }, 1500)
  }).catch(function() {})
})
$('sidebarSavePromptBtn').addEventListener('click', function() {
  var meta = getSelectedMeta()
  if (!meta || !meta.prompt) return
  // Save to prompt library
  var p = getSelectedFilePath()
  var name = p ? p.split('\\\\').pop().split('/').pop() : ''
  window.w2gp.promptLibrarySave({ prompt: meta.prompt, name: name, model: meta.model_type || '' }).then(function() {
    refreshPromptLibrary()
    var btn = $('sidebarSavePromptBtn')
    var orig = btn.textContent
    btn.textContent = '✓ Saved'
    setTimeout(function() { btn.textContent = orig }, 1500)
  })
})

// ── Inject drag-drop handler into webview: upload to Wan2GP's settings_file ──
// ── Load selected file into WanGP settings via synthetic drop on Gradio file component ──
function showToast(msg) {
  var t = document.createElement('div')
  t.textContent = msg
  t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#333;color:#e8e6e1;padding:8px 16px;border-radius:6px;font-size:13px;z-index:9999;font-family:Geist Mono,monospace;transition:opacity 0.3s;max-width:90vw;text-align:center'
  document.body.appendChild(t)
  setTimeout(function() { t.style.opacity = '0'; setTimeout(function() { t.remove() }, 400) }, 2500)
}
function loadSettingsViaApi(uploadedFile) {
  var path = uploadedFile.path || uploadedFile.name || uploadedFile
  var wv = $('wangpView')
  if (!wv || !wv.src || wv.src === 'about:blank') {
    showToast('Launch Wan2GP first, then send files from the viewer')
    return
  }
  // Prefer cached metadata → inline JSON drop (instant, no disk read)
  var meta = _metaCache[path]
  if (meta && typeof meta === 'object' && Object.keys(meta).length) {
    wv.executeJavaScript('if(window.__loadFileIntoWan2GP) window.__loadFileIntoWan2GP(' + JSON.stringify('JSON:' + JSON.stringify(meta)) + ')').then(function() {
      showToast('✓ Sent to Wan2GP')
    }).catch(function(e) {
      console.log('[API] JSON inject error:', e)
      // Fallback: file path
      wv.executeJavaScript('if(window.__loadFileIntoWan2GP) window.__loadFileIntoWan2GP(' + JSON.stringify(path) + ')').then(function() {
        showToast('✓ Sent to Wan2GP')
      }).catch(function(e2) {
        console.log('[API] file path error:', e2)
        window.w2gp.sendToWangp(path).then(function(r) {
          if (r && r.error) { console.log('[API] error:', r.error); showToast('Send failed: ' + r.error); return }
          showToast('✓ Sent to Wan2GP')
        }).catch(function(e3) { console.log('[API] error:', e3); showToast('Send error: ' + e3.message) })
      })
    })
    return
  }
  // No cached metadata — send file path (reads via IPC in webview)
  wv.executeJavaScript('if(window.__loadFileIntoWan2GP) window.__loadFileIntoWan2GP(' + JSON.stringify(path) + ')').then(function() {
    showToast('✓ Sent to Wan2GP')
  }).catch(function(e) {
    console.log('[API] executeJS error:', e)
    window.w2gp.sendToWangp(path).then(function(r) {
      if (r && r.error) { console.log('[API] error:', r.error); showToast('Send failed: ' + r.error); return }
      showToast('✓ Sent to Wan2GP')
    }).catch(function(e) { console.log('[API] error:', e); showToast('Send error: ' + e.message) })
  })
}

function injectWebviewDropHandler() {
  const wv = $('wangpView')
  if (!wv || !wv.src || wv.src === 'about:blank') { console.log('[DD] no webview to inject'); return }
  // ponytail: debug logs stripped
  // Re-inject on every navigation
  if (!wv._ddNavSetup) {
    wv._ddNavSetup = true
    wv.addEventListener('did-finish-load', injectWebviewDropHandler)
    wv.addEventListener('did-navigate-in-page', function() { setTimeout(injectWebviewDropHandler, 1000) })
  }
  const js = `
(function() {
  if (window.__ddInjected) return;
  window.__ddInjected = true;

  function log(m) { console.log('[DD]', m); }

  // ── Discover the correct fn_index from Gradio config ──
  function discoverFnIndex() {
    return new Promise(function(resolve) {
      function tryGet() {
        var cfg = window.gradioConfig;
        if (cfg) return resolve(scanCfg(cfg));
        setTimeout(tryGet, 300);
      }
      tryGet();
    });
    function scanCfg(cfg) {
      log('config loaded, ' + (cfg.components||[]).length + ' components, ' + (cfg.dependencies||[]).length + ' deps');
      // Find the file component by elem_id or type+label
      var fileCompId = null;
      for (var i = 0; i < (cfg.components||[]).length; i++) {
        var c = cfg.components[i], p = c.props||{}, t = c.component||'';
        log('  cmp['+i+'] type='+t+' label="'+(p.label||'')+'" elem_id="'+(p.elem_id||'')+'" id='+c.id);
        if (p.elem_id === 'settings_file' || (t === 'File' && (p.label||'').includes('Settings'))) {
          fileCompId = c.id; log('  → file component id='+c.id);
        }
      }
      if (!fileCompId) { log('no file component found'); return -1; }
      // Find dependency with this component as input
      for (var j = 0; j < (cfg.dependencies||[]).length; j++) {
        var d = cfg.dependencies[j], ins = d.inputs||[];
        if (ins.indexOf(fileCompId) >= 0) {
          log('  dep['+j+'] fn_index='+(d.fn_index||d.id)+' api_name='+(d.api_name||'')+' matches');
          return d.fn_index ?? d.id ?? j;
        }
      }
      log('no matching dep for component ' + fileCompId);
      return -1;
    }
  }

  // ── Wait for Client API to be ready ──
  function withClient(cb) {
    var t = 0;
    (function poll() {
      try {
        var app = document.querySelector('gradio-app');
        var client = null;
        if (app) {
          // Try multiple strategies to find the Gradio Client
          if (typeof app.Client === 'function' && app.Client.submit) client = app.Client;
          else if (typeof app.client === 'object' && app.client.submit) client = app.client;
          else if (typeof app.api === 'object' && app.api.submit) client = app.api;
          else if (window.__gradio_client && window.__gradio_client.submit) client = window.__gradio_client;
          else {
            var sr = app.shadowRoot || app;
            var inner = sr.querySelector('gradio-app');
            if (inner) {
              if (inner.Client && inner.Client.submit) client = inner.Client;
              else if (inner.client && inner.client.submit) client = inner.client;
            }
          }
        }
        if (client && typeof client.submit === 'function') { cb(client); return; }
      } catch (e) { log('withClient error:', e); }
      if (++t > 30) { log('Client API not available after 15s'); cb(null); return; }
      setTimeout(poll, 500);
    })();
  }

  // ── IPC fallback: use main process to call Gradio API directly ──
  function sendViaMainProcess(fi) {
    if (!window.__sendToWangp) { log('no __sendToWangp bridge, cannot send'); return; }
    log('calling __sendToWangp IPC fallback');
    // fi is {path, name, size} — reconstruct original file path from uploaded file info
    window.__sendToWangp(fi.path).then(function(r) {
      if (r && r.error) { log('IPC fallback error: ' + r.error); return; }
      log('IPC fallback OK, fn_index=' + (r ? r.fn_index : '?'));
    }).catch(function(e) { log('IPC fallback exception: ' + e.message); });
  }

  // ── Send file path to main process (no upload needed, path already known) ──
  function sendPathToWangp(filePath) {
    if (!window.__sendToWangp) { log('no __sendToWangp bridge'); return; }
    log('sendPathToWangp:', filePath);
    window.__sendToWangp(filePath).then(function(r) {
      if (r && r.error) { log('sendPath error: ' + r.error); return; }
      log('sendPath OK, fn_index=' + (r ? r.fn_index : '?'));
    }).catch(function(e) { log('sendPath exception: ' + e.message); });
  }

  // ── Load settings into Wan2GP via Gradio HTTP API ──
  // Uploads a JSON settings file → triggers get_settings_from_file → ALL components updated
  function loadFile(filePath) {
    log('loadFile:', filePath);
    var metaObj = null, fileName = 'settings.json', mime = 'application/json';

    if (filePath.indexOf('JSON:') === 0) {
      // Inline JSON — create from cached metadata (no disk read)
      try { metaObj = JSON.parse(filePath.substring(5)); } catch(e) { log('JSON parse: ' + e.message); return; }
    } else {
      // File path — read via IPC
      if (!window.__readLocalFile) { log('no __readLocalFile bridge'); return; }
      window.__readLocalFile(filePath).then(function(r) {
        if (!r || !r.data) { log('read failed'); return; }
        var bin = atob(r.data), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        uploadAndPredict(new Blob([bytes], { type: r.mime || 'application/octet-stream' }), r.name || filePath.split(/[\\/]/).pop());
      }).catch(function(e) { log('loadFile error: ' + e.message); });
      return;
    }

    // JSON mode: upload string, then predict
    uploadAndPredict(new Blob([JSON.stringify(metaObj, null, 2)], { type: 'application/json' }), 'settings.json');

    function uploadAndPredict(blob, fname) {
      var fd = new FormData();
      fd.append('files', blob, fname);
      fetch('/upload', { method: 'POST', body: fd }).then(function(resp) {
        if (!resp.ok) { log('upload HTTP ' + resp.status); return; }
        resp.json().then(function(files) {
          if (!files || !files.length) { log('upload returned no files'); return; }
          var fi = files[0];
          log('uploaded: ' + fi.name);

          // Try Gradio's internal api.predict() — updates UI via WebSocket
          var app = document.querySelector('gradio-app');
          var api = app && (app.api || app.Client || app.client);
          if (api && typeof api.predict === 'function') {
            discoverFnIndex().then(function(fnIdx) {
              if (fnIdx < 0) fnIdx = 0;
              api.predict(fnIdx, [[{ path: fi.path, name: fi.name, size: fi.size }]]).then(function(r) {
                log('api.predict OK');
              }).catch(function(e) { log('api.predict error: ' + e.message + ', trying HTTP fallback'); httpPredict(fi, fnIdx); });
            });
          } else {
            discoverFnIndex().then(function(fnIdx) { httpPredict(fi, fnIdx); });
          }
        }).catch(function(e) { log('upload JSON err: ' + e.message); });
      }).catch(function(e) { log('upload fetch err: ' + e.message); });
    }

    function httpPredict(fi, fnIdx) {
      if (fnIdx < 0) fnIdx = 0;
      fetch('/api/predict/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fn_index: fnIdx, data: [[{ path: fi.path, name: fi.name, size: fi.size }]] })
      }).then(function(r) {
        if (r.ok) log('HTTP predict OK');
        else log('HTTP predict ' + r.status);
      }).catch(function(e) { log('HTTP predict err: ' + e.message); });
    }
  }

  window.__loadFileIntoWan2GP = loadFile;

  // ── Sidebar drop handler ──
  function onSidebarDrop(e) {
    var p = e.dataTransfer.getData('text/plain');
    if (!p || !p.match(/^[A-Z]:\\/)) {
      if (window.__getPendingDragPath) {
        window.__getPendingDragPath().then(function(pp) {
          if (pp && pp.match(/^[A-Z]:\\/)) { e.preventDefault(); e.stopPropagation(); loadFile(pp); }
        });
      }
      return;
    }
    e.preventDefault(); e.stopPropagation();
    loadFile(p);
  }

  function onDragOver(e) {
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    e.preventDefault();
  }

  document.addEventListener('drop', onSidebarDrop);
  document.addEventListener('dragover', onDragOver);
  // ponytail: also poll for Gradio component in case document-level events don't cross webview boundary
  (function pollComponent() {
    var app = document.querySelector('gradio-app');
    if (!app) return;
    var root = app.shadowRoot || app;
    var comp = root.querySelector('[elem_id=settings_file], gr-file, [data-testid=file-upload]');
    if (comp) {
      log('found component, attaching directly');
      comp.addEventListener('drop', onSidebarDrop);
      comp.addEventListener('dragover', onDragOver);
      return;
    }
    setTimeout(pollComponent, 1000);
  })();
})()
`
wv.executeJavaScript(js).catch(function() {
  // Webview not loaded yet — did-finish-load listener handles re-injection
})
}
// Keep the old handler name but it now maps to the new one via event listener dedup
// (the newer handler registered earlier takes priority — old one kept for safety)


$('sidebarReloadBtn').addEventListener('click', refreshSidebar)

$('sidebarSearch').addEventListener('input', function() {
  var q = this.value.toLowerCase()
  var items = $('sidebarFiles').querySelectorAll('.sidebar-file')
  for (var i = 0; i < items.length; i++) {
    var item = items[i]
    item.style.display = (!q || (item.dataset.name || '').toLowerCase().includes(q) || (item.dataset.prompt || '').toLowerCase().includes(q) || (item.dataset.model || '').toLowerCase().includes(q) || (item.dataset.seed || '').includes(q)) ? '' : 'none'
  }
})

var sortModes = ['date', 'name']; var sortIdx = 0
$('sidebarSortBtn').addEventListener('click', function() {
  sortIdx = (sortIdx + 1) % sortModes.length; _sidebarSort = sortModes[sortIdx]
  this.title = 'Sort: ' + _sidebarSort
  refreshSidebar()
})

// ponytail: thumbnail zoom
$('sidebarZoomInBtn').addEventListener('click', function() { setZoom(_sidebarZoom + 8) })
$('sidebarZoomOutBtn').addEventListener('click', function() { setZoom(_sidebarZoom - 8) })
function setZoom(v) {
  _sidebarZoom = Math.max(24, Math.min(80, v))
  $('sidebarFiles').style.setProperty('--thumb-size', _sidebarZoom + 'px')
}

// ── Sidebar resize drag handle ──
(function() {
  var handle = $('sidebarResizeHandle')
  var wrap = $('sidebarWrap')
  var sidebar = $('outputSidebar')
  var isResizing = false
  handle.addEventListener('mousedown', function(e) {
    isResizing = true
    wrap.classList.add('resizing')
    e.preventDefault()
  })
  window.addEventListener('mousemove', function(e) {
    if (!isResizing) return
    var w = e.clientX - wrap.getBoundingClientRect().left
    w = Math.max(120, Math.min(800, w))
    sidebar.style.width = w + 'px'
    sidebar.style.minWidth = w + 'px'
  })
  window.addEventListener('mouseup', function() {
    if (!isResizing) return
    isResizing = false
    wrap.classList.remove('resizing')
    // Persist width
    var w = parseInt(sidebar.style.width)
    if (w && w >= 120 && w <= 800) {
      try { localStorage.setItem('sidebarWidth', w) } catch {}
    }
  })
  // Restore saved width
  try {
    var saved = localStorage.getItem('sidebarWidth')
    if (saved) { var sw = parseInt(saved); if (sw >= 120 && sw <= 800) { sidebar.style.width = sw + 'px'; sidebar.style.minWidth = sw + 'px' } }
  } catch {}
})()

// ── Filter chips (image/video/audio/All toggle) ──
$('sidebarFilterChips').addEventListener('click', function(e) {
  var btn = e.target.closest('.fc-chip')
  if (!btn) return
  if (btn.dataset.type === 'all') {
    // Reset all chips: only 'All' stays active
    this.querySelectorAll('.fc-chip').forEach(function(c) { c.classList.toggle('active', c.dataset.type === 'all') })
  } else {
    // Deactivate 'All', toggle clicked chip
    this.querySelector('.fc-chip[data-type="all"]').classList.remove('active')
    btn.classList.toggle('active')
    // If no type chips active, reactivate 'All'
    if (!this.querySelector('.fc-chip:not([data-type="all"]).active')) {
      this.querySelector('.fc-chip[data-type="all"]').classList.add('active')
    }
  }
  refreshSidebar()
})

// ── Date filter toggle ──
$('sidebarDateFilterBtn').addEventListener('click', function() {
  var df = $('sidebarDateFilter')
  df.style.display = df.style.display === 'none' ? '' : 'none'
})
$('sidebarDateFilter').addEventListener('click', function(e) {
  var btn = e.target.closest('.df-btn')
  if (!btn) return
  this.querySelectorAll('.df-btn').forEach(function(b) { b.classList.remove('active') })
  btn.classList.add('active')
  sidebarDateRange = btn.dataset.range
  refreshSidebar()
})

// Sidebar search filter — handler attached via event delegation in refreshSidebar, no second registration needed
// Sidebar sort toggle — handled by refreshSidebar() re-render, sortModes/sortIdx declared above refreshSidebar

// ── Show metadata from cache (instant, no Python spawn) ──
function showMetaFromCache(filePath) {
  var meta = _metaCache[filePath]
  if (!meta || typeof meta !== 'object' || !Object.keys(meta).length) return false
  var metaEl = $('sidebarMeta')
  var contentEl = $('sidebarMetaContent')
  if (metaEl) metaEl.style.display = ''
  if (contentEl) contentEl.innerHTML = formatMetaHtml(meta, filePath.split(/[\\/]/).pop())
  setSelectedTitle(meta.prompt || '')
  return true
}

// ── Load and show metadata for a selected sidebar file ──
function loadSidebarMeta(filePath) {
  var metaEl = $('sidebarMeta')
  var contentEl = $('sidebarMetaContent')
  if (!filePath) {
    metaEl.style.display = 'none'
    return
  }
  metaEl.style.display = ''
  // Check cache first — instant if batch loader already got it
  if (showMetaFromCache(filePath)) return
  contentEl.textContent = 'Loading...'
  var fileName = filePath.split(/[\\/]/).pop()
  // Primary: Node.js native reader (brute-force binary JSON scan, handles ALL formats, zero deps)
  window.w2gp.readFileMetadata(filePath).then(function(meta) {
    if (meta && typeof meta === 'object' && Object.keys(meta).length) {
      _metaCache[filePath] = meta
      contentEl.innerHTML = formatMetaHtml(meta, fileName)
      setSelectedTitle(meta.prompt || '')
    } else {
      // Fallback: Python/Wan2GP reader (PIL Exif, ffprobe for videos, Wan2GP env)
      window.w2gp.readFileMetadataPython(filePath).then(function(pyMeta) {
        if (pyMeta && typeof pyMeta === 'object' && Object.keys(pyMeta).length) {
          _metaCache[filePath] = pyMeta
          contentEl.innerHTML = formatMetaHtml(pyMeta, fileName)
          setSelectedTitle(pyMeta.prompt || '')
        } else {
          contentEl.textContent = '── No metadata found ──\n\nNode.js reader returned nothing. Check terminal for [meta] error logs.'
        }
      }).catch(function(e) {
        console.log('[meta] Python reader failed:', e)
        contentEl.textContent = 'Metadata read failed: ' + (e.message || e)
      })
    }
  }).catch(function(e) {
    console.log('[meta] JS reader failed:', e)
    window.w2gp.readFileMetadataPython(filePath).then(function(pyMeta) {
      if (pyMeta && typeof pyMeta === 'object' && Object.keys(pyMeta).length) {
        _metaCache[filePath] = pyMeta
        contentEl.innerHTML = formatMetaHtml(pyMeta, fileName)
        setSelectedTitle(pyMeta.prompt || '')
      } else {
        contentEl.textContent = '── No metadata found ──\n\nJS reader failed, Python reader also found nothing.\nCheck terminal for [meta] error logs.'
      }
    }).catch(function(e) {
      contentEl.textContent = 'Metadata read failed: ' + (e.message || e)
    })
  })
}
function setSelectedTitle(prompt) {
  var sel = $('sidebarFiles').querySelector('.sidebar-file.selected')
  if (!sel) return
  sel.title = prompt || sel.dataset.name || ''
  var pp = sel.querySelector('.sidebar-file-prompt')
  if (pp) pp.textContent = prompt ? prompt.substring(0, 60) + (prompt.length > 60 ? '…' : '') : ''
}

$('sidebarMetaToggle').addEventListener('click', function() {
  var content = $('sidebarMetaContent')
  content.classList.toggle('hidden')
  this.textContent = content.classList.contains('hidden') ? '▶' : '▼'
})
// Click-to-inject on sidebar metadata rows (Prompt Manager style)
$('sidebarMetaContent').addEventListener('click', function(e) {
  var btn = e.target.closest('.meta-copy-btn')
  if (btn) { window.w2gp.clipboardWrite(btn.dataset.copy || ''); return }
  if (e.target.closest('.meta-row')) {
    var path = getSelectedFilePath()
    if (path) loadSettingsViaApi(path)
  }
})

// ── Sidebar dropzone for adding files to output ──
var dropzone = $('sidebarDropzone')
dropzone.addEventListener('dragover', function(e) { e.preventDefault(); dropzone.classList.add('drag-over') })
dropzone.addEventListener('dragleave', function() { dropzone.classList.remove('drag-over') })
dropzone.addEventListener('drop', function(e) {
  e.preventDefault(); dropzone.classList.remove('drag-over')
  var files = Array.from(e.dataTransfer.files || []).map(function(f) { return f.path })
  if (!files.length) return
  window.w2gp.copyFilesToOutput(files).then(function(copied) {
    if (copied && copied.length) {
      refreshSidebar()
      // Select first copied file + show its metadata
      setTimeout(function() {
        var first = copied[0]
        var el = $('sidebarFiles')
        var items = el.querySelectorAll('.sidebar-file')
        for (var i = 0; i < items.length; i++) {
          if (items[i].dataset.path === first) {
            el.querySelectorAll('.sidebar-file').forEach(function(x) { x.classList.remove('selected') })
            items[i].classList.add('selected')
            var actionBar = $('sidebarActions')
            if (actionBar) actionBar.style.display = 'flex'
            loadSidebarMeta(first)
            break
          }
        }
      }, 100)
    }
  })
})

// ── Listen for output dir changes (generation finished, etc.) ──
// Desktop notification when new files appear
var _notifTimer = null
window.w2gp.onOutputFilesChanged(function() {
  refreshSidebar()
  if (_notifTimer) clearTimeout(_notifTimer)
  _notifTimer = setTimeout(function() {
    // Request permission first, then notify
    try {
      if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
        Notification.requestPermission().then(function(perm) {
          if (perm === 'granted') new Notification("Wan2GP Desktop", { body: "New output files generated" })
        })
      } else if (typeof Notification !== 'undefined') {
        new Notification("Wan2GP Desktop", { body: "New output files generated" })
      }
    } catch(e) {}
  }, 1500)
})

$('sidebarTab').addEventListener('click', () => {
  sidebarOpen = !sidebarOpen
  var wrap = $('sidebarWrap')
  var sidebar = $('outputSidebar')
  wrap.classList.toggle('collapsed', !sidebarOpen)
  if (!sidebarOpen) {
    // Clear inline width so CSS collapse takes effect
    sidebar.style.width = ''
    sidebar.style.minWidth = ''
    // Stop watcher — no resources when sidebar hidden
    window.w2gp.stopOutputWatcher()
  } else {
    // Restore persisted width
    var saved = 0
    try { saved = parseInt(localStorage.getItem('sidebarWidth')) } catch {}
    if (saved >= 120) {
      sidebar.style.width = saved + 'px'
      sidebar.style.minWidth = saved + 'px'
    }
    refreshSidebar()
    window.w2gp.startOutputWatcher()
  }
})

// ── Prompt Library ──
function refreshPromptLibrary() {
  var el = $('sidebarPromptLibItems')
  window.w2gp.promptLibraryList().then(function(entries) {
    if (!entries || !entries.length) {
      el.innerHTML = '<div class="pl-empty">No saved prompts</div>'
      $('sidebarPromptLib').style.display = 'block'
      return
    }
    $('sidebarPromptLib').style.display = 'block'
    var html = ''
    for (var i = 0; i < Math.min(entries.length, 30); i++) {
      var e = entries[i]
      var d = new Date(e.created)
      var dateStr = d.toLocaleDateString()
      var prompt = (e.prompt || '').substring(0, 60) + ((e.prompt || '').length > 60 ? '…' : '')
      html += '<div class="pl-item" data-id="' + e.id + '" title="' + (e.prompt || '').replace(/\"/g,'&quot;') + '">'
      html += '<span class="pl-item-prompt">' + prompt + '</span>'
      html += '<span class="pl-item-date">' + dateStr + '</span>'
      html += '<button class="pl-item-del" data-id="' + e.id + '" title="Delete">✕</button>'
      html += '</div>'
    }
    el.innerHTML = html
  }).catch(function() {
    el.innerHTML = '<div class="pl-empty">Could not load prompts</div>'
  })
}
$('sidebarPromptLibItems').addEventListener('click', function(e) {
  var delBtn = e.target.closest('.pl-item-del')
  var item = e.target.closest('.pl-item')
  if (delBtn && item) {
    e.stopPropagation()
    window.w2gp.promptLibraryDelete(delBtn.dataset.id).then(function() { refreshPromptLibrary() })
    return
  }
  if (item && !delBtn) {
    // Load this prompt into Wan2GP
    var id = item.dataset.id
    if (!id) return
    window.w2gp.promptLibraryList().then(function(entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].id === id) {
          // Inject prompt into Gradio textarea
          var wv = $('wangpView')
          if (wv && wv.src && wv.src !== 'about:blank') {
            var prompt = JSON.stringify(entries[i].prompt || '')
            wv.executeJavaScript(
              '(function(){var ta=document.querySelector("gradio-app");return a?(a.shadowRoot||a).querySelector(s):null};var ta=g("textarea")||g("input[type=\\"text\\"]");if(ta){ta.value=' + prompt + ';ta.dispatchEvent(new Event("input",{bubbles:true}))}})()'
            ).catch(function() {})
          }
          break
        }
      }
    }).catch(function() {})
  }
})
$('sidebarPromptLibToggle').addEventListener('click', function() {
  var content = $('sidebarPromptLibItems')
  content.classList.toggle('hidden')
  this.textContent = content.classList.contains('hidden') ? '▶' : '▼'
})
// Load prompt library on startup
refreshPromptLibrary()

// Format Wan2GP metadata — Wan2GP settings first, then Exif as secondary
function formatMeta(meta, indent) {
  if (!meta || typeof meta !== 'object') return String(meta || '')
  indent = indent || ''
  var lines = []
  var seen = {}
  // Show Wan2GP generation settings FIRST (known keys for readability)
  var keys = ['prompt','model_type','model_filename','seed','num_inference_steps','guidance_scale','negative_prompt','image_mode','resolution','video_length','batch_size','skip_steps_cache_type','creation_date','generation_time','type','image_quality','settings_version']
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i]
    if (meta[k] !== undefined && meta[k] !== null && meta[k] !== '') {
      var v = typeof meta[k] === 'object' ? formatMeta(meta[k], indent + '  ') : String(meta[k])
      if (k === 'prompt') lines.push('── Generation Settings ──\nPrompt:\n  ' + v + '\n')
      else if (k === 'negative_prompt') lines.push('Neg Prompt:\n  ' + v + '\n')
      else if (k === 'num_inference_steps') lines.push('Steps: ' + v)
      else if (k === 'guidance_scale') lines.push('Guidance: ' + v)
      else if (k === 'skip_steps_cache_type') lines.push('Cache: ' + v)
      else if (k === 'creation_date') lines.push('Created: ' + v)
      else if (k === 'generation_time') lines.push('Gen Time: ' + v + 's')
      else if (k === 'settings_version') lines.push('Settings v' + v)
      else lines.push(k.replace(/_/g,' ') + ': ' + v)
      seen[k] = true
    }
  }
  // Lora entries
  if (Array.isArray(meta.loras) && meta.loras.length) {
    lines.push('LoRAs:')
    for (var li = 0; li < meta.loras.length; li++) {
      var l = meta.loras[li]
      lines.push('  ' + (l.name || l.model || '?') + ' x' + (l.multiplier || l.strength || 1.0))
    }
    seen.loras = true
  }
  // Show Exif data second (collapsed summary)
  if (meta._exif && typeof meta._exif === 'object') {
    lines.push('\n── Camera / File Info ──')
    var exifKeys = ['Make','Model','Software','Date/Time Original','Date/Time Digitized','Image Description',
      'ISO Speed','Exposure Time','F Number','Focal Length','Focal Length 35',
      'Pixel X Dimension','Pixel Y Dimension','Color Space']
    var shown = {}
    for (var j = 0; j < exifKeys.length; j++) {
      var k = exifKeys[j]
      if (meta._exif[k] !== undefined && meta._exif[k] !== null && meta._exif[k] !== '') {
        lines.push('  ' + k + ': ' + meta._exif[k])
        shown[k] = true
      }
    }
    var exifRest = {}
    for (var k in meta._exif) { if (!shown[k]) exifRest[k] = meta._exif[k] }
    if (Object.keys(exifRest).length) lines.push('  ... + ' + Object.keys(exifRest).length + ' more Exif tags')
    seen._exif = true
  }
  // Remaining keys recursively (skip raw_comment — shown separately)
  var rest = {}
  for (var k in meta) { if (!seen[k] && k !== '_raw_comment') rest[k] = meta[k] }
  var restStr = formatRemaining(rest, indent)
  if (restStr) lines.push('\nAll metadata:\n' + restStr)
  // Raw comment JSON dump at the very end
  if (meta._raw_comment) {
    lines.push('\n── Raw JSON Comment ──\n' + meta._raw_comment.substring(0, 2000) + (meta._raw_comment.length > 2000 ? '\n… (truncated)' : ''))
  }
  return lines.join('\n')
}
function formatRemaining(obj, indent) {
  var parts = []
  for (var k in obj) {
    var v = obj[k]
    if (v === undefined || v === null || v === '') continue
    if (typeof v === 'object') {
      parts.push(indent + k + ':')
      if (Array.isArray(v)) {
        for (var j = 0; j < v.length; j++) {
          parts.push(indent + '  - ' + (typeof v[j] === 'object' ? formatRemaining(v[j], indent + '    ') : String(v[j])))
        }
      } else {
        parts.push(formatRemaining(v, indent + '  '))
      }
    } else {
      parts.push(indent + k.replace(/_/g, ' ') + ': ' + v)
    }
  }
  return parts.join('\n')
}

// ponytail: Gallery-style HTML metadata table for preview overlay
function formatMetaHtml(meta, fileName) {
  if (!meta || typeof meta !== 'object') return '<div class="metadata-content"><p>No metadata</p></div>'
  var lbls = [], rawVals = []
  if (fileName) { rawVals.push(fileName); lbls.push('File Name') }
  var modelName = meta.model_type || meta.type || ''
  if (modelName) { rawVals.push(String(modelName).split(' - ').pop()); lbls.push('Model') }
  if (meta.prompt) { rawVals.push(String(meta.prompt).substring(0, 1024)); lbls.push('Text Prompt') }
  if (meta.negative_prompt) { rawVals.push(String(meta.negative_prompt).substring(0, 256)); lbls.push('Negative Prompt') }
  if (meta.resolution) { rawVals.push(String(meta.resolution)); lbls.push('Resolution') }
  if (meta.video_length !== undefined && meta.video_length !== null && meta.video_length !== '') { rawVals.push(String(meta.video_length)); lbls.push('Video Length') }
  if (meta.seed !== undefined && meta.seed !== null && meta.seed !== '') { rawVals.push(String(meta.seed)); lbls.push('Seed') }
  var cfg = meta.guidance_scale; if (cfg !== undefined && cfg !== null && cfg !== '') { rawVals.push(String(cfg)); lbls.push('Guidance (CFG)') } else { rawVals.push('N/A'); lbls.push('Guidance (CFG)') }
  if (meta.num_inference_steps !== undefined && meta.num_inference_steps !== null && meta.num_inference_steps !== '') { rawVals.push(String(meta.num_inference_steps)); lbls.push('Num Inference Steps') }
  // LoRAs
  if (Array.isArray(meta.loras) && meta.loras.length) {
    rawVals.push(meta.loras.map(function(l) { return (l.name || l.model || '?') + ' x' + (l.multiplier || l.strength || 1.0) }).join(', '))
    lbls.push('LoRAs')
  }
  if (meta.image_mode !== undefined && meta.image_mode !== null && meta.image_mode !== '') { rawVals.push(String(meta.image_mode)); lbls.push('Image Mode') }
  var seenLabels = {}
  var rows = ''
  for (var i = 0; i < lbls.length && i < rawVals.length; i++) {
    if (rawVals[i] === undefined || rawVals[i] === null) continue
    var ev = escapeHtml(rawVals[i])
    var copyAttr = String(rawVals[i]).replace(/"/g,'&quot;')
    rows += '<tr class="meta-row" data-copy="' + copyAttr + '"><td style="text-align:right;vertical-align:top;white-space:nowrap;padding:2px 8px;color:var(--text-secondary);font-size:12px">' + lbls[i] + '</td><td style="padding:2px 8px;font-size:12px"><b>' + ev + '</b> <span class="meta-copy-btn" data-copy="' + copyAttr + '" title="Copy">📋</span></td></tr>\n'
    seenLabels[lbls[i]] = true
  }
  // Show remaining keys not in known list (catches raw_comment, custom fields, etc.)
  var knownLabels = {'File Name':1,'Model':1,'Text Prompt':1,'Negative Prompt':1,'Resolution':1,'Video Length':1,'Seed':1,'Guidance (CFG)':1,'Num Inference Steps':1,'LoRAs':1,'Image Mode':1}
  var extraKeys = []
  for (var k in meta) {
    if (k === '_exif' || k === 'loras' || k === 'metadata') continue
    var label = k.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase() })
    if (knownLabels[label] || seenLabels[label]) continue
    var v = meta[k]
    if (v === undefined || v === null || v === '') continue
    if (typeof v === 'object') {
      try { extraKeys.push({ label: label, val: JSON.stringify(v).substring(0, 200) }) } catch { continue }
    } else {
      extraKeys.push({ label: label, val: String(v).substring(0, 200) })
    }
  }
  for (var ei = 0; ei < extraKeys.length; ei++) {
    var ev = escapeHtml(extraKeys[ei].val)
    var copyAttr = extraKeys[ei].val.replace(/"/g,'&quot;')
    rows += '<tr class="meta-row" data-copy="' + copyAttr + '"><td style="text-align:right;vertical-align:top;white-space:nowrap;padding:2px 8px;color:var(--text-secondary);font-size:12px">' + extraKeys[ei].label + '</td><td style="padding:2px 8px;font-size:12px"><b>' + ev + '</b> <span class="meta-copy-btn" data-copy="' + copyAttr + '" title="Copy">📋</span></td></tr>\n'
  }
  // Exif
  if (meta._exif && typeof meta._exif === 'object') {
    var exifKeys = ['Make','Model','Software','Date/Time Original','ISO Speed','F Number','Focal Length','Exposure Time','Pixel X Dimension','Pixel Y Dimension']
    for (var ei = 0; ei < exifKeys.length; ei++) {
      var ev = meta._exif[exifKeys[ei]]
      if (ev !== undefined && ev !== null && ev !== '') {
        var copyAttr = String(ev).replace(/"/g,'&quot;')
        rows += '<tr class="meta-row" data-copy="' + copyAttr + '"><td style="text-align:right;vertical-align:top;white-space:nowrap;padding:2px 8px;color:var(--text-secondary);font-size:11px">📷 ' + exifKeys[ei] + '</td><td style="padding:2px 8px;font-size:11px">' + escapeHtml(String(ev)) + ' <span class="meta-copy-btn" data-copy="' + copyAttr + '" title="Copy">📋</span></td></tr>\n'
      }
    }
  }
  // Raw comment JSON dump
  if (meta._raw_comment) {
    var rawTrunc = meta._raw_comment.length > 500 ? meta._raw_comment.substring(0, 500) + '…' : meta._raw_comment
    var copyAttr = rawTrunc.replace(/"/g,'&quot;')
    rows += '<tr class="meta-row" data-copy="' + copyAttr + '"><td style="text-align:right;vertical-align:top;white-space:nowrap;padding:2px 8px;color:var(--text-secondary);font-size:12px">📄 Raw Comment</td><td style="padding:2px 8px;font-size:11px;word-break:break-all"><code>' + escapeHtml(rawTrunc) + '</code> <span class="meta-copy-btn" data-copy="' + rawTrunc.replace(/"/g,'&quot;') + '" title="Copy">📋</span></td></tr>\n'
  }
  return '<table style="width:100%;border-collapse:collapse">' + rows + '</table>'
}
function flashBtn(el) {
  var orig = el.textContent;
  el.textContent = '✓';
  el.style.opacity = '0.6';
  setTimeout(function() { el.textContent = orig; el.style.opacity = '' }, 1200);
}
function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }

// ── File preview overlay ──
var previewZoom = 1, previewPanX = 0, previewPanY = 0
var previewDrag = false, previewDragStartX, previewDragStartY, previewDragPanX, previewDragPanY

var _previewFileUrl = '' // track current blob URL for cleanup
var _previewAlive = false // guard against async callbacks after close
var _previewFilePath = '' // ponytail: for Send-to-Wan2GP button

function openPreview(filePath, fileName) {
  console.log('[DP] openPreview called:', filePath)
  _previewAlive = true
  _previewFileUrl = ''
  _previewFilePath = filePath  // ponytail: for Send-to-Wan2GP button
  var ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase()
  var isVideo = ['.mp4','.mov','.avi','.mkv','.webm','.m4v'].includes(ext)
  var isAudio = ['.mp3','.wav','.ogg','.m4a','.flac','.wma','.aac','.opus'].includes(ext)
  $('previewTitle').textContent = fileName
  var img = $('previewImage'); var vid = $('previewVideo'); var aud = $('previewAudio')
  img.style.display = 'none'; vid.style.display = 'none'; aud.style.display = 'none'
  previewZoom = 1; previewPanX = 0; previewPanY = 0
  applyPreviewTransform()
  // Load via IPC → blob URL (avoids file:// stalls and huge data: URLs)
  window.w2gp.readLocalFile(filePath).then(function(r) {
    if (!r || !_previewAlive) return
    var mime = r.mime || (isVideo ? 'video/mp4' : isAudio ? 'audio/mpeg' : 'image/png')
    if (mime === 'application/octet-stream') {
      var m = {'.mp4':'video/mp4','.webm':'video/webm','.mkv':'video/x-matroska','.mov':'video/quicktime','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.m4a':'audio/mp4','.flac':'audio/flac','.wma':'audio/wma','.aac':'audio/aac','.opus':'audio/opus'}[ext]
      if (m) mime = m
    }
    var bin = atob(r.data), bytes = new Uint8Array(bin.length)
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    var blob = new Blob([bytes], { type: mime })
    var url = URL.createObjectURL(blob)
    _previewFileUrl = url
    if (!_previewAlive) { URL.revokeObjectURL(url); return }
    if (isVideo) {
      vid.src = url
      vid.style.display = ''
    } else if (isAudio) {
      aud.src = url
      aud.style.display = ''
    } else {
      img.src = url
      img.style.display = ''
    }
  })
  // Load metadata: check cache first, then Node.js native reader, Python fallback
  var cached = _metaCache[filePath]
  if (cached && typeof cached === 'object' && Object.keys(cached).length) {
    var el = $('previewMetaContent'); var toggle = $('previewMetaToggle')
    if (el) el.innerHTML = formatMetaHtml(cached, fileName)
    if (el) el.classList.remove('hidden')
    if (toggle) toggle.textContent = '▼'
  } else {
    window.w2gp.readFileMetadata(filePath).then(function(meta) {
      if (!_previewAlive) return
      var el = $('previewMetaContent'); var toggle = $('previewMetaToggle')
      if (meta && Object.keys(meta).length) {
        _metaCache[filePath] = meta
        el.innerHTML = formatMetaHtml(meta, fileName)
      } else {
        // Fallback: Python reader (PIL Exif, ffprobe for videos, Wan2GP env)
        window.w2gp.readFileMetadataPython(filePath).then(function(pyMeta) {
          if (!_previewAlive) return
          if (pyMeta && Object.keys(pyMeta).length) {
            _metaCache[filePath] = pyMeta
            el.innerHTML = formatMetaHtml(pyMeta, fileName)
          } else {
            el.textContent = 'No metadata found'
          }
        })
      }
      el.classList.remove('hidden')
      toggle.textContent = '▼'
    }).catch(function() {})
  }
  $('previewOverlay').classList.remove('hidden')
}

function closePreview() {
  _previewAlive = false
  $('previewOverlay').classList.add('hidden')
  if (_previewFileUrl) { URL.revokeObjectURL(_previewFileUrl); _previewFileUrl = '' }
  $('previewImage').removeAttribute('src')
  $('previewVideo').removeAttribute('src')
  var v = $('previewVideo'); v.pause && v.pause()
  $('previewAudio').removeAttribute('src')
  var a = $('previewAudio'); a.pause && a.pause()
}

function applyPreviewTransform() {
  const el = $('previewImage').style.display !== 'none' ? $('previewImage') : $('previewVideo')
  if (el.style.display !== 'none') {
    el.style.transform = 'translate(' + previewPanX + 'px,' + previewPanY + 'px) scale(' + previewZoom + ')'
  }
}

$('previewZoomIn').addEventListener('click', () => {
  previewZoom = Math.min(previewZoom * 1.25, 10)
  applyPreviewTransform()
})
$('previewZoomOut').addEventListener('click', () => {
  previewZoom = Math.max(previewZoom * 0.8, 0.1)
  applyPreviewTransform()
})
$('previewZoomReset').addEventListener('click', () => {
  previewZoom = 1; previewPanX = 0; previewPanY = 0
  applyPreviewTransform()
})
$('previewCloseBtn').addEventListener('click', closePreview)
$('previewBackdrop').addEventListener('click', closePreview)

// Mouse wheel zoom on preview body
$('previewBody').addEventListener('wheel', function(e) {
  e.preventDefault()
  var delta = e.deltaY > 0 ? 0.9 : 1.1
  previewZoom = Math.max(0.1, Math.min(10, previewZoom * delta))
  applyPreviewTransform()
}, { passive: false })

// Pan via click-drag on image
$('previewBody').addEventListener('mousedown', function(e) {
  if (e.target.tagName !== 'IMG' && e.target.tagName !== 'VIDEO') return
  if (previewZoom <= 1) return
  previewDrag = true
  previewDragStartX = e.clientX
  previewDragStartY = e.clientY
  previewDragPanX = previewPanX
  previewDragPanY = previewPanY
  e.target.classList.add('dragging')
  e.preventDefault()
})
window.addEventListener('mousemove', function(e) {
  if (!previewDrag) return
  previewPanX = previewDragPanX + (e.clientX - previewDragStartX)
  previewPanY = previewDragPanY + (e.clientY - previewDragStartY)
  applyPreviewTransform()
})
window.addEventListener('mouseup', function() {
  if (!previewDrag) return
  previewDrag = false
  var el = $('previewImage').style.display !== 'none' ? $('previewImage') : $('previewVideo')
  el.classList.remove('dragging')
})

// Metadata toggle
$('previewMetaToggle').addEventListener('click', function() {
  var content = $('previewMetaContent')
  content.classList.toggle('hidden')
  this.textContent = content.classList.contains('hidden') ? '▶' : '▼'
})
$('previewMetaCopyBtn')?.addEventListener('click', function() {
  var text = $('previewMetaContent').textContent
  if (!text || text === 'No metadata found') return
  window.w2gp.clipboardWrite(text).then(function() {
    var orig = this.textContent
    this.textContent = '✓'
    this.classList.add('copied')
    var self = this
    setTimeout(function() { self.textContent = '📋'; self.classList.remove('copied') }, 1500)
  }.bind(this)).catch(function() {})
})

// ponytail: Send to Wan2GP from preview
$('previewSendBtn')?.addEventListener('click', function() {
  if (_previewFilePath) loadSettingsViaApi(_previewFilePath)
})
// ponytail: Variation — load + random seed
function injectRandomSeed(wv) {
  wv.executeJavaScript(
    '(function(){var e=document.querySelector(\'input[aria-label*="Seed"]\')||document.querySelector(\'input[type="number"]\');if(e){e.value=' + Math.floor(Math.random()*2147483647) + ';e.dispatchEvent(new Event("input",{bubbles:true}))}})()'
  ).catch(function(){})
}
$('previewVariBtn')?.addEventListener('click', function() {
  if (!_previewFilePath) return
  var wv = $('wangpView')
  if (!wv || !wv.src || wv.src === 'about:blank') return
  loadSettingsViaApi(_previewFilePath)
  setTimeout(function() { injectRandomSeed(wv) }, 2000)
})
$('previewPNSBtn')?.addEventListener('click', function() {
  if (!_previewFilePath) return
  var wv = $('wangpView')
  if (!wv || !wv.src || wv.src === 'about:blank') return
  loadSettingsViaApi(_previewFilePath)
  setTimeout(function() { injectRandomSeed(wv) }, 2000)
})
// ponytail: 📋 copy + row click → inject value into Gradio prompt
$('previewMetaContent').addEventListener('click', function(e) {
  var btn = e.target.closest('.meta-copy-btn')
  if (btn) { window.w2gp.clipboardWrite(btn.dataset.copy || ''); return }
  var row = e.target.closest('.meta-row')
  if (!row || !_previewFilePath) return
  var val = row.dataset.copy
  if (!val) { loadSettingsViaApi(_previewFilePath); return }
  // Inject just this value into Gradio textarea
  var wv = $('wangpView')
  if (!wv || !wv.src || wv.src === 'about:blank') { loadSettingsViaApi(_previewFilePath); return }
  var escaped = JSON.stringify(val)
  wv.executeJavaScript(
    '(function(){var ta=document.querySelector("gradio-app");return a?(a.shadowRoot||a).querySelector(s):null};var ta=g("textarea")||g("input[type=\\"text\\"]");if(ta){ta.value=' + escaped + ';ta.dispatchEvent(new Event("input",{bubbles:true}))}})()'
  ).catch(function() { loadSettingsViaApi(_previewFilePath) })
})

// Keyboard: Escape to close
window.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && !$('previewOverlay').classList.contains('hidden')) closePreview()
})

// ── Server restart overlay ──
function showRestartOverlay(exitCode) {
  const ov = $('serverRestartOverlay')
  if (!ov) return
  $('restartTitle').textContent = 'Wan2GP server stopped'
  $('restartMessage').textContent = `Process exited (code ${exitCode}). Auto-restarting...`
  $('restartNowBtn').classList.add('hidden')
  $('restartDashboardBtn').classList.add('hidden')
  ov.classList.remove('hidden')
  // ponytail: poll for real Gradio app (gradioConfig), reload webview when back
  if (window._restartPoller) clearInterval(window._restartPoller)
  window._restartPoller = setInterval(() => {
    const wv = $('wangpView')
    if (!wv || wv.src === 'about:blank' || !currentUrl) return
    wv.executeJavaScript('window.gradioConfig?true:false').then(function(r) {
      if (r !== true) return
      clearInterval(window._restartPoller); window._restartPoller = null
      wv.reload()
      $('serverRestartOverlay').classList.add('hidden')
      setTimeout(injectWebviewDropHandler, 2000)
    }).catch(function() {})
  }, 3000)
}

$('restartNowBtn').addEventListener('click', async () => {
  if (window._restartPoller) { clearInterval(window._restartPoller); window._restartPoller = null }
  $('restartTitle').textContent = 'Starting...'
  $('restartMessage').textContent = 'Please wait...'
  $('restartNowBtn').disabled = true
  try {
    const result = await window.w2gp.launch()
    currentUrl = result.url
    $('serverRestartOverlay').classList.add('hidden')
    var wv = $('wangpView')
    wv.src = result.url
    setTimeout(() => injectWebviewDropHandler(), 2500)
  } catch(e) {
    $('restartTitle').textContent = 'Restart failed'
    $('restartMessage').textContent = e.message
    $('restartNowBtn').disabled = false
  }
})

$('restartDashboardBtn').addEventListener('click', async () => {
  if (window._restartPoller) { clearInterval(window._restartPoller); window._restartPoller = null }
  await window.w2gp.stop()
  window.w2gp.setViewerActive(false)
  show('dashboard')
  refreshDashboard()
})

// ── Settings ──
$('settingsBackBtn').addEventListener('click',closeSettings)
$('settingsReinstallBtn').addEventListener('click',async()=>{ if(!confirm('Re-run the full installer?'))return; $('settingsLog').textContent='Reinstalling...\n'; try{ await window.w2gp.reinstall(); await window.w2gp.install(selectedEnvType); log($('settingsLog'),'\n[*] Done'); refreshDashboard() }catch(e){ log($('settingsLog'),'\n[!] '+e.message) } })
$('settingsUninstallEnvBtn').addEventListener('click',async()=>{
  const active = await window.w2gp.manageActive()
  if (!active || !confirm('Uninstall the active environment \"' + active + '\"? The Wan2GP installation (repos, config, models) will be kept.')) return
  $('settingsLog').textContent='Uninstalling environment...\n'
  try {
    const r = await window.w2gp.uninstallEnv(active)
    if (r.error) throw new Error(r.error)
    log($('settingsLog'),'\n[*] Environment uninstalled.')
    refreshDashboard()
  } catch(e) { log($('settingsLog'),'\n[!] '+e.message) }
})
$('settingsUninstallWangpBtn').addEventListener('click',async()=>{
  // Native dialogs in main.js handle backup and keep/delete prompts
  $('settingsLog').textContent='Uninstalling Wan2GP...\n'
  try {
    const r = await window.w2gp.uninstallWangp()
    if (r.error) throw new Error(r.error)
    if (r.cancelled) { log($('settingsLog'),'\n[*] Cancelled.'); return }
    log($('settingsLog'),'\n[*] Wan2GP uninstalled.')
    refreshDashboard()
  } catch(e) { log($('settingsLog'),'\n[!] '+e.message) }
})

$('settingsUpgradeBtn').addEventListener('click',async()=>{
  $('settingsLog').textContent='Upgrade running...\n'
  try{ await window.w2gp.upgrade(); log($('settingsLog'),'\n[*] Done'); refreshDashboard() }catch(e){ log($('settingsLog'),'\n[!] '+e.message) }
})

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
$('tokenDocsLink')?.addEventListener('click', (e) => {
  e.preventDefault()
  window.w2gp.openExternal('https://github.com/settings/tokens')
})
$('launchArgsSaveBtn')?.addEventListener('click', async () => {
  const args = $('launchArgsInput')?.value || ''
  const cfg = await window.w2gp.configLoad()
  cfg.launchArgs = args.trim()
  await window.w2gp.configSave(cfg)
  log($('settingsLog'), 'Extra launch args saved — will apply on next WanGP launch')
})
$('portSaveBtn')?.addEventListener('click', async () => {
  const val = parseInt($('portInput')?.value) || 17861
  if (val < 1024 || val > 65535) { log($('settingsLog'), 'Port must be between 1024 and 65535'); return }
  const cfg = await window.w2gp.configLoad()
  cfg.serverPort = val
  await window.w2gp.configSave(cfg)
  log($('settingsLog'), `Server port set to ${val} — will apply on next WanGP launch`)
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
      // autoDownload is on — download starts immediately, show progress
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

$('updateCheckBtn').addEventListener('click', (e) => {
  $('updateCheckBtn').disabled = true
  $('updateCheckBtn').textContent = e.shiftKey ? 'Local test...' : 'Checking...'
  window.w2gp.checkUpdate(e.shiftKey ? { local: true } : undefined)
  setTimeout(() => { $('updateCheckBtn').disabled = false; $('updateCheckBtn').textContent = '⬆ Check Desktop Updates' }, 10000)
})

$('updateDownloadBtn').addEventListener('click', () => window.w2gp.downloadUpdate())
$('updateInstallBtn').addEventListener('click', () => window.w2gp.installUpdate())
$('updateDismissBtn').addEventListener('click', () => $('updateBanner').classList.add('hidden'))
