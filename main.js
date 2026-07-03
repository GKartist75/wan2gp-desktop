const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, execSync } = require('child_process')
const net = require('net')
const https = require('https')
const { autoUpdater } = require('electron-updater')

const DATA_DIR = path.join(app.getPath('userData'), 'Wan2GP')
function getRepoDir() { const c = loadConfig(); return c.repoDir || path.join(DATA_DIR, 'repo') }
function getEnvsFile() { return path.join(getRepoDir(), 'envs.json') }
const CONFIG_FILE = path.join(DATA_DIR, 'desktop-config.json')

const PLATFORM = process.platform
const IS_WIN = PLATFORM === 'win32'

let mainWin = null, wangpProc = null, setupProc = null

function sysPython() {
  try {
    const out = execSync(IS_WIN ? 'where python' : 'which python3', { encoding: 'utf8' })
    return (out.split('\n')[0] || '').trim() || (IS_WIN ? 'python' : 'python3')
  } catch { return IS_WIN ? 'python' : 'python3' }
}

function send(ch, data) { mainWin?.webContents.send(ch, data) }

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch {}
  return { githubToken: '', defaultBrowser: '' }
}

function saveConfig(cfg) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2))
}

// ── TCP port check ──
function waitForPort(host, port, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      if (wangpProc && wangpProc.exitCode !== null) {
        return reject(new Error(`Wan2GP process exited with code ${wangpProc.exitCode} before server started`))
      }
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

function getLocalWangpHead() {
  if (!fs.existsSync(path.join(getRepoDir(), '.git'))) return null
  try {
    const hash = execSync('git rev-parse HEAD', { cwd: getRepoDir(), encoding: 'utf8', timeout: 5000 }).trim()
    const date = execSync('git log -1 --format=%cI', { cwd: getRepoDir(), encoding: 'utf8', timeout: 5000 }).trim()
    const msg = execSync('git log -1 --format=%s', { cwd: getRepoDir(), encoding: 'utf8', timeout: 5000 }).trim()
    return { hash, date, message: msg }
  } catch { return null }
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'wan2gp-desktop' }, timeout: 10000 }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

// ── Run setup.py with structured events ──
function runSetup(args) {
  return new Promise((resolve, reject) => {
    const py = sysPython()
    const proc = spawn(py, ['setup.py', ...args], {
      cwd: getRepoDir(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    })
    setupProc = proc
    let buf = ''
    const emit = (text) => {
      buf += text
      send('setup-output', text)
      const profileMatch = text.match(/Hardware Profile:\s*(\S+)/)
      if (profileMatch) send('setup-profile', profileMatch[1])
      const phase = detectPhase(text)
      if (phase) send('setup-phase', phase)
    }
    proc.stdout.on('data', (d) => { const s = d.toString(); emit(s); process.stdout.write(s) })
    proc.stderr.on('data', (d) => { const s = d.toString(); emit(s); process.stderr.write(s) })
    proc.on('close', (code) => {
      setupProc = null
      if (code === 0) resolve(buf)
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
  const envPath = path.isAbsolute(env.path) ? env.path : path.join(getRepoDir(), env.path)
  if (env.type === 'none') return sysPython()
  return IS_WIN
    ? path.join(envPath, 'Scripts', 'python.exe')
    : path.join(envPath, 'bin', 'python')
}

// ── IPC ──

ipcMain.handle('check-installed', () => ({
  repo: fs.existsSync(path.join(getRepoDir(), 'wgp.py')),
  env: getActiveEnv() !== null
}))

ipcMain.handle('detect-gpu', () => {
  try {
    const out = execSync(`"${sysPython()}" -c "
import subprocess, sys
n, v = 'Unknown', 'UNKNOWN'
try:
    o = subprocess.check_output(['nvidia-smi','--query-gpu=name','--format=csv,noheader'], encoding='utf-8', stderr=subprocess.DEVNULL).strip()
    n, v = o, 'NVIDIA'
except:
    if sys.platform == 'darwin': n, v = 'Apple Silicon', 'APPLE'
    elif sys.platform == 'win32':
        try:
            o = subprocess.check_output('powershell -Command "Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name"', shell=True, encoding='utf-8', stderr=subprocess.DEVNULL).strip()
            if o: n, v = o, 'AMD' if 'Radeon' in o or 'AMD' in o else 'INTEL'
        except: pass
    else:
        try:
            o = subprocess.check_output('lspci | grep -i vga', shell=True, encoding='utf-8', stderr=subprocess.DEVNULL)
            if 'NVIDIA' in o: n, v = o, 'NVIDIA'
            elif 'AMD' in o: n, v = o, 'AMD'
        except: pass
print(f'{v}||{n}')
"`, { encoding: 'utf8', timeout: 15000 }).trim()
    const [v, n] = out.split('||')
    return { vendor: v, name: n }
  } catch { return { vendor: 'UNKNOWN', name: 'Unknown' } }
})

ipcMain.handle('install', async (_, envType) => {
  const env = envType || 'venv'
  if (!fs.existsSync(path.join(getRepoDir(), 'wgp.py'))) {
    send('setup-output', '[*] Cloning Wan2GP repository...\n')
    fs.mkdirSync(DATA_DIR, { recursive: true })
    execSync(`git clone --depth 1 https://github.com/deepbeepmeep/Wan2GP.git "${getRepoDir()}"`, {
      stdio: 'pipe', timeout: 120000, windowsHide: true
    })
    send('setup-output', '[*] Repository cloned.\n')
    send('setup-phase', { id: 'clone', label: 'Clone Wan2GP repository', done: true })
  } else {
    send('setup-phase', { id: 'clone', label: 'Clone Wan2GP repository', done: true })
  }
  await runSetup(['install', '--env', env, '--auto'])
  // Post-install: ensure huggingface_hub is installed (avoids Xet warning)
  send('setup-output', '[*] Ensuring huggingface_hub is installed...\n')
  try {
    const envData = getActiveEnv()
    if (envData) {
      const py = getPythonForEnv(envData)
      if (py) execSync(`"${py}" -m pip install huggingface_hub -q`, { stdio: 'pipe', timeout: 30000, cwd: getRepoDir(), windowsHide: true })
    }
  } catch (e) { send('setup-output', `[!] huggingface_hub install: ${e.message}\n`) }
  return true
})

ipcMain.handle('reinstall', async () => {
  // Remove repo and envs so fresh install runs clean
  send('setup-output', '[*] Removing existing installation...\n')
  const rmCmd = IS_WIN ? 'rmdir /s /q' : 'rm -rf'
  try { execSync(`${rmCmd} "${getRepoDir()}"`, { stdio: 'pipe', timeout: 30000, windowsHide: true }) } catch {}
  try { execSync(`${rmCmd} "${getEnvsFile()}"`, { stdio: 'pipe', timeout: 10000, windowsHide: true }) } catch {}
  send('setup-output', '[*] Ready for fresh install.\n')
  return true
})

ipcMain.handle('get-status', async () => {
  const env = getActiveEnv()
  if (!env) return { error: 'No active environment' }
  const py = getPythonForEnv(env)
  if (!py) return { error: 'No python' }
  try {
    const out = execSync(`"${py}" -c "
import sys, importlib.metadata
pkgs = ['python','torch','triton','sageattention','spas_sage_attn','flash_attn',
        'diffusers','transformers','gradio','accelerate','onnxruntime','xformers',
        'nunchaku','gguf','mmgp','moviepy','opencv-python','insightface',
        'peft','timm','vector_quantize_pytorch','torchcodec','torchaudio',
        'huggingface_hub']
r = []
for p in pkgs:
    try:
        if p == 'python': r.append(f'python={sys.version.split()[0]}')
        elif p == 'opencv-python': r.append(f'opencv={importlib.metadata.version(\"opencv-python\")}')
        else: r.append(f'{p}={importlib.metadata.version(p)}')
    except: pass
print('||'.join(r))
"`, { encoding: 'utf8', timeout: 30000, cwd: getRepoDir() }).trim()
    const parts = out.split('||')
    const versions = {}
    parts.forEach(p => { const [k, v] = p.split('='); versions[k] = v })
    return { env, versions }
  } catch (e) { return { env, versions: { error: e.message } } }
})

// ── Launch with proper port check ──
ipcMain.handle('launch', async () => {
  const env = getActiveEnv()
  if (!env) throw new Error('No active environment')
  const py = getPythonForEnv(env)
  if (!py) throw new Error('Cannot find python for env')

  const port = 17861
  send('launch-log', '[*] Starting Wan2GP...\n')
  send('launch-log', `[*] Python: ${py}\n`)
  send('launch-log', `[*] Port: ${port}\n`)

  wangpProc = spawn(py, ['wgp.py', '--server-port', String(port)], {
    cwd: getRepoDir(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GRADIO_LANG: 'en', HF_HUB_DISABLE_PROGRESS_BARS: '0', HF_HUB_DISABLE_TELEMETRY: '1', TQDM_POSITION: '-1' },
    windowsHide: true
  })

  wangpProc.stdout.on('data', (d) => { const s = d.toString(); send('launch-log', s); process.stdout.write(s) })
  wangpProc.stderr.on('data', (d) => { const s = d.toString(); send('launch-log', s); process.stderr.write(s) })

  let exited = false
  wangpProc.on('exit', (code) => {
    exited = true
    wangpProc = null
    send('wangp-exit', code)
  })

  send('launch-log', '[*] Waiting for Gradio server...\n')
  try {
    await waitForPort('127.0.0.1', port, 180000)
    send('launch-log', '[*] Wan2GP is ready!\n')
    return { url: `http://127.0.0.1:${port}`, port }
  } catch (err) {
    if (exited) throw new Error(`Wan2GP exited before server started. Check launch logs.`)
    throw err
  }
})

ipcMain.handle('stop', () => {
  if (wangpProc) { wangpProc.kill('SIGTERM'); setTimeout(() => { if (wangpProc) wangpProc.kill('SIGKILL') }, 5000); wangpProc = null }
  return true
})

ipcMain.handle('update', async () => await runSetup(['update']))
ipcMain.handle('upgrade', async () => await runSetup(['upgrade']))

ipcMain.handle('manage-list', () => {
  try {
    if (!fs.existsSync(getEnvsFile())) return []
    const d = JSON.parse(fs.readFileSync(getEnvsFile(), 'utf8'))
    return Object.entries(d.envs).map(([name, info]) => ({ name, ...info, active: name === d.active }))
  } catch { return [] }
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
  if (entry?.path && fs.existsSync(entry.path) && entry.type !== 'none') {
    execSync(IS_WIN ? `rmdir /s /q "${entry.path}"` : `rm -rf "${entry.path}"`, { stdio: 'pipe' })
  }
  delete d.envs[name]
  if (d.active === name) {
    const keys = Object.keys(d.envs)
    d.active = keys.length > 0 ? keys[0] : null
  }
  fs.writeFileSync(getEnvsFile(), JSON.stringify(d, null, 4))
  return true
})

ipcMain.handle('open-external', (_, url) => shell.openExternal(url))

// ── Browser detection ──
ipcMain.handle('detect-browsers', () => {
  const browsers = []
  if (IS_WIN) {
    const checks = [
      { name: 'Edge', paths: [process.env['PROGRAMFILES(X86)'] + '\\Microsoft\\Edge\\Application\\msedge.exe', process.env.LOCALAPPDATA + '\\Microsoft\\Edge\\Application\\msedge.exe'] },
      { name: 'Chrome', paths: [process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe', process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'] },
      { name: 'Firefox', paths: [process.env.PROGRAMFILES + '\\Mozilla Firefox\\firefox.exe', process.env['PROGRAMFILES(X86)'] + '\\Mozilla Firefox\\firefox.exe'] },
      { name: 'Brave', paths: [process.env.LOCALAPPDATA + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'] },
      { name: 'Opera', paths: [process.env['PROGRAMFILES(X86)'] + '\\Opera\\launcher.exe'] },
      { name: 'Vivaldi', paths: [process.env.LOCALAPPDATA + '\\Vivaldi\\Application\\vivaldi.exe'] },
      { name: 'Yandex', paths: [process.env.LOCALAPPDATA + '\\Yandex\\YandexBrowser\\Application\\browser.exe'] },
    ]
    for (const c of checks) {
      for (const p of c.paths) {
        if (p && fs.existsSync(p)) { browsers.push({ name: c.name, path: p }); break }
      }
    }
  } else if (PLATFORM === 'darwin') {
    const apps = [
      { name: 'Safari', path: '/Applications/Safari.app' },
      { name: 'Chrome', path: '/Applications/Google Chrome.app' },
      { name: 'Firefox', path: '/Applications/Firefox.app' },
      { name: 'Brave', path: '/Applications/Brave Browser.app' },
    ]
    for (const a of apps) { if (fs.existsSync(a.path)) browsers.push(a) }
  } else {
    const bins = ['google-chrome', 'chromium-browser', 'firefox', 'brave-browser']
    for (const b of bins) {
      try {
        const p = execSync(`which ${b} 2>/dev/null`, { encoding: 'utf8', timeout: 3000 }).trim()
        if (p) browsers.push({ name: b, path: p })
      } catch {}
    }
  }
  return browsers
})

// ── Launch URL in specific browser ──
ipcMain.handle('open-in-browser', (_, { url, browserPath }) => {
  if (browserPath) {
    const cmd = IS_WIN ? `"${browserPath}" "${url}"` : `open -a "${browserPath}" "${url}"`
    execSync(cmd, { stdio: 'pipe', windowsHide: true, timeout: 5000 })
  } else {
    shell.openExternal(url)
  }
  return true
})

// ── Desktop config (token, browser preference) ──
ipcMain.handle('config-load', () => loadConfig())
ipcMain.handle('config-save', (_, cfg) => { saveConfig(cfg); return true })

// ── Install paths ──
ipcMain.handle('get-install-paths', () => ({
  appData: DATA_DIR,
  repo: getRepoDir(),
  config: CONFIG_FILE
}))

ipcMain.handle('select-folder', async () => {
  const { dialog } = require('electron')
  const result = await dialog.showOpenDialog(mainWin, { properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

// ── Wan2GP upstream version ──
ipcMain.handle('get-wangp-local-version', () => getLocalWangpHead())

ipcMain.handle('get-wangp-upstream-info', async () => {
  try {
    const body = await fetchUrl(`https://api.github.com/repos/${WAN2GP_UPSTREAM}/commits?per_page=5&sha=main`)
    const data = JSON.parse(body)
    if (!Array.isArray(data)) return { error: 'Invalid response' }
    return {
      commits: data.map(c => ({
        hash: c.sha,
        date: c.commit.author.date,
        message: c.commit.message.split('\n')[0],
        author: c.commit.author.name
      }))
    }
  } catch (e) { return { error: e.message } }
})

ipcMain.handle('get-wangp-changelog', async () => {
  for (const file of ['docs/CHANGELOG.md', 'README.md']) {
    try {
      const body = await fetchUrl(`https://raw.githubusercontent.com/${WAN2GP_UPSTREAM}/main/${file}`)
      if (body && !body.includes('404:')) return body.substring(0, 5000)
    } catch {}
  }
  return null
})

ipcMain.handle('get-wangp-version', async () => {
  try {
    const body = await fetchUrl(`https://raw.githubusercontent.com/${WAN2GP_UPSTREAM}/main/README.md`)
    if (!body) return null
    const m = body.match(/WanGP\s+v?(\d+\.\d+(?:\.\d+)?)/i)
    return m ? m[1] : null
  } catch { return null }
})

// ── Hardware detection ──
ipcMain.handle('detect-hardware', () => {
  const info = { cpu: '—', ram: '—', gpu: '—', vram: '—' }
  try {
    if (IS_WIN) {
      try {
        const cpuOut = execSync('powershell -Command "Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name"', { encoding: 'utf8', timeout: 5000, windowsHide: true })
        info.cpu = cpuOut.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('Name'))[0] || '—'
        if (info.cpu.length > 45) info.cpu = info.cpu.substring(0, 42) + '...'
      } catch {}
      try {
        const ramOut = execSync('powershell -Command "Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum | ForEach-Object { [math]::Round($_.Sum / 1GB) }"', { encoding: 'utf8', timeout: 5000, windowsHide: true })
        const val = ramOut.trim()
        if (val && !isNaN(Number(val))) info.ram = Number(val) + ' GB'
      } catch {}
      if (info.ram === '—') {
        try {
          const totalOut = execSync('powershell -Command "Get-CimInstance Win32_ComputerSystem | ForEach-Object { [math]::Round($_.TotalPhysicalMemory / 1GB) }"', { encoding: 'utf8', timeout: 5000, windowsHide: true })
          const val = totalOut.trim()
          if (val && !isNaN(Number(val))) info.ram = Number(val) + ' GB'
        } catch {}
      }
      // Try nvidia-smi first (most accurate for NVIDIA GPUs)
      try {
        const nvOut = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader', { encoding: 'utf8', timeout: 10000, windowsHide: true })
        const [nvName, memStr] = nvOut.trim().split(', ')
        if (nvName) info.gpu = nvName
        if (memStr) {
          const mem = parseFloat(memStr)
          info.vram = mem >= 1024 ? Math.round(mem / 1024) + ' GB' : Math.round(mem) + ' MB'
        }
      } catch {
        // Fallback to WMI for non-NVIDIA GPUs
        try {
          const gpuOut = execSync(`powershell -Command "Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM | ForEach-Object {$_.Name + '|' + ($_.AdapterRAM -or '0')}"`, { encoding: 'utf8', timeout: 5000, windowsHide: true })
          const lines = gpuOut.split('\n').map(l => l.trim()).filter(l => l)
          const gpuList = []
          const vramList = []
          for (const line of lines) {
            const [name, vramStr] = line.split('|')
            if (name && name.trim() && name !== 'Name') {
              gpuList.push(name.trim())
              const vramBytes = parseInt(vramStr?.trim())
              if (!isNaN(vramBytes) && vramBytes > 0) {
                vramList.push((vramBytes / (1024**3)) >= 1 ? Math.round(vramBytes / (1024**3)) + ' GB' : Math.round(vramBytes / (1024**2)) + ' MB')
              }
            }
          }
          if (gpuList.length > 0) {
            info.gpu = gpuList.join(' + ')
            if (vramList.length > 0) info.vram = vramList.join(' + ')
          }
        } catch {}
      }
    } else if (PLATFORM === 'darwin') {
      try {
        const cpuOut = execSync('sysctl -n machdep.cpu.brand_string', { encoding: 'utf8', timeout: 5000 }).trim()
        info.cpu = cpuOut
      } catch {}
      try {
        const ramOut = execSync('sysctl -n hw.memsize', { encoding: 'utf8', timeout: 5000 }).trim()
        info.ram = Math.round(Number(ramOut) / (1024**3)) + ' GB'
      } catch {}
      try {
        const gpuOut = execSync('system_profiler SPDisplaysDataType 2>/dev/null | grep -E "Chipset Model|VRAM"', { encoding: 'utf8', timeout: 10000 })
        const lines = gpuOut.trim().split('\n')
        if (lines.length > 0) info.gpu = lines[0].replace('Chipset Model:', '').trim()
        if (lines.length > 1) info.vram = lines[1].replace('VRAM (Dynamic, Max):', '').replace('VRAM (Total):', '').trim()
      } catch {}
    } else {
      try {
        const cpuOut = execSync('cat /proc/cpuinfo | grep "model name" | head -1', { encoding: 'utf8', timeout: 5000, shell: true })
        info.cpu = cpuOut.split(':')[1]?.trim() || '—'
      } catch {}
      try {
        const ramOut = execSync('free -h | grep Mem', { encoding: 'utf8', timeout: 5000, shell: true })
        info.ram = ramOut.split(/\s+/)[1] || '—'
      } catch {}
      try {
        const gpuOut = execSync('lspci | grep -i "vga\\|3d" | head -1', { encoding: 'utf8', timeout: 5000, shell: true })
        info.gpu = gpuOut.split(':')[2]?.trim() || gpuOut.trim() || '—'
      } catch {}
      try {
        const nvOut = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null', { encoding: 'utf8', timeout: 10000, shell: true })
        const [nvName, memStr] = nvOut.trim().split(', ')
        if (nvName) info.gpu = nvName
        if (memStr) {
          const mem = parseFloat(memStr)
          if (!isNaN(mem)) info.vram = mem >= 1024 ? Math.round(mem / 1024) + ' GB' : Math.round(mem) + ' MB'
        }
      } catch {}
    }
  } catch {}
  return info
})

// ── Auto-updater ──
autoUpdater.autoDownload = false
autoUpdater.allowPrerelease = false

autoUpdater.on('checking-for-update', () => { console.log('[DEBUG] Checking for update...'); send('update-status', { status: 'checking' }) })
autoUpdater.on('update-available', (info) => { console.log('[DEBUG] Update available:', info.version); send('update-status', { status: 'available', version: info.version, releaseNotes: info.releaseNotes }) })
autoUpdater.on('update-not-available', () => { console.log('[DEBUG] Up to date'); send('update-status', { status: 'up-to-date' }) })
autoUpdater.on('download-progress', (p) => { console.log('[DEBUG] Download progress:', p.percent); send('update-status', { status: 'downloading', percent: Math.round(p.percent), bytesPerSecond: p.bytesPerSecond, total: p.total, transferred: p.transferred }) })
autoUpdater.on('update-downloaded', (info) => { console.log('[DEBUG] Update downloaded:', info.version); send('update-status', { status: 'downloaded', version: info.version }) })
autoUpdater.on('error', (err) => { console.log('[DEBUG] Update error:', err.message); send('update-status', { status: 'error', message: err.message || err.toString() }) })

ipcMain.handle('check-update', async () => {
  // Load token from config if available
  const cfg = loadConfig()
  console.log('[DEBUG] Config loaded:', JSON.stringify(cfg))
  if (cfg.githubToken) {
    console.log('[DEBUG] Setting GH_TOKEN:', cfg.githubToken.substring(0, 10) + '...')
    process.env.GH_TOKEN = cfg.githubToken
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'GKartist75',
      repo: 'wan2gp-desktop',
      token: cfg.githubToken,
      private: true
    })
  } else {
    console.log('[DEBUG] No GitHub token in config')
  }
  try { autoUpdater.checkForUpdates() } catch (e) { send('update-status', { status: 'error', message: e.message }) }
})

ipcMain.handle('download-update', async () => {
  try { await autoUpdater.downloadUpdate() } catch (e) { send('update-status', { status: 'error', message: e.message }) }
})

ipcMain.handle('install-update', async () => autoUpdater.quitAndInstall())

// ── Window ──
function createWindow() {
  mainWin = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    title: 'Wan2GP Desktop',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, webviewTag: true,
    },
    show: false, backgroundColor: '#0f0f0f',
  })
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  mainWin.once('ready-to-show', () => mainWin.show())
  mainWin.on('closed', () => { mainWin = null })
}

app.whenReady().then(() => {
  createWindow()
  setTimeout(() => {
    try {
      const cfg = loadConfig()
      if (cfg.githubToken) {
        process.env.GH_TOKEN = cfg.githubToken
        autoUpdater.setFeedURL({
          provider: 'github',
          owner: 'GKartist75',
          repo: 'wan2gp-desktop',
          token: cfg.githubToken,
          private: true
        })
      }
      autoUpdater.checkForUpdates()
    } catch {}
  }, 5000)
})
app.on('window-all-closed', () => {
  if (wangpProc) wangpProc.kill()
  if (PLATFORM !== 'darwin') app.quit()
})
app.on('activate', () => { if (!mainWin) createWindow() })
app.on('before-quit', () => {
  if (wangpProc) wangpProc.kill()
  if (setupProc) setupProc.kill()
})
