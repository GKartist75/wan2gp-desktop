// ── Global Log Buffer ──
const logBuffer = []
const MAX_LOG = 5000
function appendLog(text) {
  if (!text) return
  text.split('\n').forEach(line => { if (line.trim()) logBuffer.push(line.trim()) })
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

function clearLogBuffer() { logBuffer.length = 0; renderTerminals() }

function setupScrollUnfollow(bodyId, btnId) {
  const body = document.getElementById(bodyId)
  const btn = document.getElementById(btnId)
  if (!body || !btn) return
  body.addEventListener('scroll', () => {
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 30
    if (!atBottom && termFollow[bodyId]) { termFollow[bodyId] = false; btn.classList.remove('active'); btn.textContent = '▼ Follow' }
    else if (atBottom && !termFollow[bodyId]) { termFollow[bodyId] = true; btn.classList.add('active'); btn.textContent = '▼ Follow' }
  })
}

const $ = id => document.getElementById(id)
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); $(id).classList.add('active') }
function log(el, msg) { if (!el) return; el.textContent += msg + '\n'; el.scrollTop = el.scrollHeight }

let currentUrl = null

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  const installed = await window.w2gp.checkInstalled()
  setupScrollUnfollow('termBody','termFollowBtn')
  setupScrollUnfollow('installTermBody',null)
  setupScrollUnfollow('viewerTermBody','viewerFollowBtn')

  window.w2gp.onSetupOutput(t => appendLog(t))
  window.w2gp.onLaunchLog(t => appendLog(t))
  window.w2gp.onSetupOutput(t => { const c=t.replace(/[\x00-\x1f]/g,'').trim(); if(c){ log($('installLog'),c); log($('settingsLog'),c) } })
  window.w2gp.onLaunchLog(t => { const c=t.replace(/[\x00-\x1f]/g,'').trim(); if(c) log($('launchLog'),c) })
  window.w2gp.onSetupPhase(p => taskComplete(p.id))
  window.w2gp.onSetupProfile(p => { $('installProfile').textContent=p; $('installProfileRow').style.display='flex' })
  window.w2gp.onWangpExit(c => { if($('viewer').classList.contains('active')){ show('dashboard'); refreshDashboard() } })

  loadHardware()

  if (installed.repo && installed.env) {
    show('dashboard')
    refreshDashboard()
    setTimeout(() => toggleTerm('termPanel','termFollowBtn'), 300)
  } else {
    $('splashStatus').textContent = 'First-time setup...'
    const hw = await window.w2gp.detectHardware()
    $('installCpu').textContent=hw.cpu||'—'; $('installRam').textContent=hw.ram||'—'
    $('installGpu').textContent=hw.gpu||'—'; $('installVram').textContent=hw.vram||'—'
    setTimeout(startInstall, 500)
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
async function startInstall(){
  show('installer'); $('installLog').textContent=''; resetTasks()
  $('installSubtitle').textContent='Setting up Wan2GP...'
  const installed = await window.w2gp.checkInstalled()
  if(installed.repo) taskComplete('clone'); else taskStart('clone')
  try {
    await window.w2gp.install()
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
    taskComplete('done'); $('installSubtitle').textContent='Wan2GP is ready!'
    setTimeout(()=>{ show('dashboard'); refreshDashboard(); toggleTerm('termPanel','termFollowBtn') }, 1200)
  } catch(e){ taskComplete('done',true); $('installSubtitle').textContent='Installation failed'; appendLog(`[ERROR] ${e.message}`) }
}

// ── Dashboard ──
async function refreshDashboard(){
  const status = await window.w2gp.getStatus()
  if(status.error||!status.env){
    $('envName').textContent='No active environment'
    ;['specPython','specTorch','specCuda','specTriton','specSage','specFlash','specDiffusers','specTransformers','specGradio','specAccelerate','specOnnx','specOpencv','specPeft','specGguf'].forEach(id=>$(id).textContent='—')
  } else {
    $('envName').textContent=status.env.name; $('envType').textContent=status.env.type
    $('specPython').textContent=status.versions?.python||'—'; $('specTorch').textContent=status.versions?.torch||'—'
    const m=(status.versions?.torch||'').match(/cu(\d+)/); $('specCuda').textContent=m?`CUDA ${m[1]}`:'—'
    $('specTriton').textContent=status.versions?.triton||'—'
    $('specSage').textContent=status.versions?.sageattention||status.versions?.spas_sage_attn||'—'
    $('specFlash').textContent=status.versions?.flash_attn||'—'
    $('specDiffusers').textContent=status.versions?.diffusers||'—'
    $('specTransformers').textContent=status.versions?.transformers||'—'
    $('specGradio').textContent=status.versions?.gradio||'—'
    $('specAccelerate').textContent=status.versions?.accelerate||'—'
    $('specOnnx').textContent=status.versions?.onnxruntime||'—'
    $('specOpencv').textContent=status.versions?.opencv||'—'
    $('specPeft').textContent=status.versions?.peft||'—'
    $('specGguf').textContent=status.versions?.gguf||'—'
  }
  const envs = await window.w2gp.manageList()
  const list=$('envList'); list.innerHTML=''
  envs.forEach(e=>{
    const div=document.createElement('div')
    div.className='env-list-item'+(e.active?' active':'')
    div.innerHTML=`<span class="env-list-dot"></span><span class="env-list-name">${e.name}</span><span style="font-size:0.65rem;color:#666;flex-shrink:0">${e.type}</span><button class="env-list-del" data-name="${e.name}">✕</button>`
    if(!e.active) div.addEventListener('click',async()=>{ await window.w2gp.manageSetActive(e.name); refreshDashboard() })
    div.querySelector('.env-list-del').addEventListener('click',async(ev)=>{ ev.stopPropagation(); if(confirm(`Delete "${e.name}"?`)){ await window.w2gp.manageDelete(e.name); refreshDashboard() } })
    list.appendChild(div)
  })
}

// ── Launch (desktop) ──
let launchCancelled = false
async function doLaunch(){
  launchCancelled = false; show('launching'); $('launchLog').textContent=''
  const s1=$('launchStep1'),s2=$('launchStep2'),s3=$('launchStep3')
  ;[s1,s2,s3].forEach(s=>{ s.className='launch-step'; s.querySelector('.step-icon').textContent='○' })
  s1.className='launch-step active'; s1.querySelector('.step-icon').textContent='◌'
  try {
    const result = await window.w2gp.launch()
    if(launchCancelled){ await window.w2gp.stop(); show('dashboard'); return }
    s1.className='launch-step done'; s1.querySelector('.step-icon').textContent='✓'
    s2.className='launch-step done'; s2.querySelector('.step-icon').textContent='✓'
    s3.className='launch-step active'; s3.querySelector('.step-icon').textContent='◌'
    currentUrl=result.url; show('viewer'); $('wangpView').src=result.url
    s3.className='launch-step done'; s3.querySelector('.step-icon').textContent='✓'
    toggleTerm('viewerTermPanel','viewerFollowBtn')
  } catch(e){
    if(!launchCancelled){
      s1.className='launch-step done'; s1.querySelector('.step-icon').textContent='✕'
      log($('launchLog'),`\n[!] ${e.message}`); appendLog(`[LAUNCH ERROR] ${e.message}`)
      setTimeout(()=>show('dashboard'),3000)
    }
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
    item.innerHTML = `<span class="browser-list-icon">${b.path ? '🌐' : '⚙'}</span><span class="browser-list-name">${b.name}</span>`
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
      if(btn){ termFollow[panel.querySelector('.term-body')?.id]=true; btn.classList.add('active'); btn.textContent='▼ Follow' }
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
  try{ await window.w2gp.update(); refreshDashboard() }catch(e){ alert('Update: '+e.message) }
  $('updateBtn').disabled=false; $('updateBtn').textContent='↻ Update Wan2GP'
})
$('upgradeBtn').addEventListener('click',async()=>{
  show('settings'); $('settingsLog').textContent='Upgrade running (check Terminal for output)...\n'
  try{ await window.w2gp.upgrade(); log($('settingsLog'),'\n[*] Done'); refreshDashboard() }catch(e){ log($('settingsLog'),'\n[!] '+e.message) }
})
$('refreshBtn').addEventListener('click',()=>{ refreshDashboard(); loadHardware() })
$('settingsBtn').addEventListener('click',()=>{ show('settings'); $('settingsLog').textContent='' })

$('dashTermBtn').addEventListener('click',()=>toggleTerm('termPanel','termFollowBtn'))
$('viewTermBtn').addEventListener('click',()=>toggleTerm('viewerTermPanel','viewerFollowBtn'))

$('termFollowBtn').addEventListener('click',()=>{
  termFollow.termBody=!termFollow.termBody
  const b=$('termFollowBtn'); b.classList.toggle('active'); b.textContent=termFollow.termBody?'▼ Follow':'◼ Paused'
  if(termFollow.termBody){ const e=$('termBody'); if(e) setTimeout(()=>e.scrollTop=e.scrollHeight,10) }
})
$('viewerFollowBtn').addEventListener('click',()=>{
  termFollow.viewerTermBody=!termFollow.viewerTermBody
  const b=$('viewerFollowBtn'); b.classList.toggle('active'); b.textContent=termFollow.viewerTermBody?'▼ Follow':'◼ Paused'
  if(termFollow.viewerTermBody){ const e=$('viewerTermBody'); if(e) setTimeout(()=>e.scrollTop=e.scrollHeight,10) }
})

$('termClearBtn').addEventListener('click', clearLogBuffer)
$('viewerTermClearBtn').addEventListener('click', clearLogBuffer)
$('viewerTermCloseBtn').addEventListener('click',()=>$('viewerTermPanel').classList.remove('open'))

// ── Installer tabs ──
$('installTasksTab').addEventListener('click',()=>{ $('installTasks').classList.remove('hidden'); $('installTerm').classList.add('hidden'); $('installTasksTab').classList.add('active'); $('installTermTab').classList.remove('active') })
$('installTermTab').addEventListener('click',()=>{ $('installTasks').classList.add('hidden'); $('installTerm').classList.remove('hidden'); $('installTasksTab').classList.remove('active'); $('installTermTab').classList.add('active'); renderTerminals() })

// ── Viewer ──
$('viewBackBtn').addEventListener('click',async()=>{ await window.w2gp.stop(); show('dashboard'); refreshDashboard() })
$('viewBrowserBtn').addEventListener('click',()=>{ if(currentUrl) openBrowserPicker(currentUrl) })

// ── Settings ──
$('settingsBackBtn').addEventListener('click',()=>show('dashboard'))
$('settingsUpdateBtn').addEventListener('click',async()=>{ $('settingsLog').textContent='Updating...\n'; try{ await window.w2gp.update(); log($('settingsLog'),'\n[*] Done'); refreshDashboard() }catch(e){ log($('settingsLog'),'\n[!] '+e.message) } })
$('settingsUpgradeBtn').addEventListener('click',async()=>{ $('settingsLog').textContent='Upgrading...\n'; try{ await window.w2gp.upgrade(); log($('settingsLog'),'\n[*] Done'); refreshDashboard() }catch(e){ log($('settingsLog'),'\n[!] '+e.message) } })
$('settingsReinstallBtn').addEventListener('click',async()=>{ if(!confirm('Re-run the full installer?'))return; $('settingsLog').textContent='Reinstalling...\n'; try{ await window.w2gp.install(); log($('settingsLog'),'\n[*] Done'); refreshDashboard() }catch(e){ log($('settingsLog'),'\n[!] '+e.message) } })

// ── GitHub token config in settings ──
$('githubTokenSaveBtn')?.addEventListener('click', async () => {
  const token = $('githubTokenInput')?.value
  if (!token) return
  const cfg = await window.w2gp.configLoad()
  cfg.githubToken = token
  await window.w2gp.configSave(cfg)
  log($('settingsLog'), 'GitHub token saved — app will now check for updates')
})
$('githubTokenClearBtn')?.addEventListener('click', async () => {
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
      setTimeout(() => { if (updateState?.status !== 'available') $('updateBanner').classList.add('hidden') }, 3000)
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
      // Private repo = auth error. Show help text.
      $('updateText').textContent = status.message.includes('401') || status.message.includes('403') || status.message.includes('authentication')
        ? 'Private repo — need GitHub token in Manage settings'
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
