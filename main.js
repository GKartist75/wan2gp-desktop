const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, execSync } = require('child_process')
const net = require('net')
const { autoUpdater } = require('electron-updater')

const DATA_DIR = path.join(app.getPath('userData'), 'Wan2GP')
const REPO_DIR = path.join(DATA_DIR, 'repo')
const ENVS_FILE = path.join(REPO_DIR, 'envs.json')
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

// ── TCP port check (reliable, doesn't need HTTP) ──
function waitForPort(host, port, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    // Also monitor if process died
    const check = () => {
      // Check if process already exited
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

// ── Run setup.py with structured events ──
function runSetup(args) {
  return new Promise((resolve, reject) => {
    const py = sysPython()
    const proc = spawn(py, ['setup.py', ...args], {
      cwd: REPO_DIR, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    })
    setupProc = proc
    let buf = ''
    const emit = (text) => {
      buf += text
      send('setup-output', text)
      // Detect profile marker
      const profileMatch = text.match(/Hardware Profile:\s*(\S+)/)
      if (profileMatch) send('setup-profile', profileMatch[1])
      // Also emit structured phase events
      const phase = detectPhase(text)
      if (phase) send('setup-phase', phase)
    }
    proc.stdout.on('data', (d) => emit(d.toString()))
    proc.stderr.on('data', (d) => emit('[stderr] ' + d.toString()))
    proc.on('close', (code) => {
      setupProc = null
      if (code === 0) resolve(buf)
      else reject(new Error(`setup.py exited code ${code}`))
    })
    proc.on('error', reject)
  })
}

// Detect install phases from setup.py output (matches actual setup.py format)
function detectPhase(line) {
  // Phase markers from setup.py's install_logic()
  if (line.includes('[1/3] Preparing Environment')) return { id: 'venv', label: 'Creating Python venv', done: false }
  if (line.includes('[2/3] Installing Torch')) return { id: 'torch', label: 'Installing PyTorch + CUDA wheels', done: false }
  if (line.includes('[3/3] Installing Requirements')) return { id: 'reqs', label: 'Installing Python dependencies', done: false }
  // Individual component installs (the >>> Running: lines)
  if (line.includes('>>> Running') && (line.includes('triton-windows') || line.includes('triton<'))) return { id: 'triton', label: 'Installing Triton compiler', done: false }
  if (line.includes('>>> Running') && (line.includes('sageattention') || line.includes('SageAttention'))) return { id: 'sage', label: 'Installing Sage Attention kernel', done: false }
  if (line.includes('>>> Running') && (line.includes('flash_attn') || line.includes('flash-attn'))) return { id: 'flash', label: 'Installing Flash Attention', done: false }
  if (line.includes('>>> Running') && (line.includes('nunchaku') || line.includes('gguf') || line.includes('lightx2v'))) return { id: 'kernels', label: 'Installing GPU kernels', done: false }
  if (line.includes('>>> Running') && (line.includes('SpargeAttn') || line.includes('spas_sage'))) return { id: 'sage', label: 'Installing Sparge Attention', done: false }
  if (line.includes('>>> Running') && line.includes('pip install -r requirements')) return { id: 'reqs', label: 'Installing dependencies from requirements.txt', done: false }
  if (line.includes('>>> Running') && line.includes('plugins')) return { id: 'plugins', label: 'Installing plugin requirements', done: false }
  // Completion marker from setup.py
  if (line.includes('Automatic Install Complete') || line.includes('is now active')) return { id: 'done', label: 'Installation complete', done: true }
  return null
}

// ── Read active env ──
function getActiveEnv() {
  try {
    if (!fs.existsSync(ENVS_FILE)) return null
    const data = JSON.parse(fs.readFileSync(ENVS_FILE, 'utf8'))
    const active = data.active
    if (!active || !data.envs[active]) return null
    return { name: active, ...data.envs[active] }
  } catch { return null }
}

function getPythonForEnv(env) {
  if (!env || !env.path) return null
  if (env.type === 'none') return sysPython()
  return IS_WIN
    ? path.join(env.path, 'Scripts', 'python.exe')
    : path.join(env.path, 'bin', 'python')
}

// ── IPC ──

ipcMain.handle('check-installed', () => ({
  repo: fs.existsSync(path.join(REPO_DIR, 'wgp.py')),
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
            o = subprocess.check_output('wmic path win32_VideoController get name', shell=True, encoding='utf-8', stderr=subprocess.DEVNULL).replace('Name','').strip().split(chr(10))[0].strip()
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

ipcMain.handle('install', async () => {
  if (!fs.existsSync(path.join(REPO_DIR, 'wgp.py'))) {
    send('setup-output', '[*] Cloning Wan2GP repository...\n')
    fs.mkdirSync(DATA_DIR, { recursive: true })
    execSync(`git clone --depth 1 https://github.com/deepbeepmeep/Wan2GP.git "${REPO_DIR}"`, {
      stdio: 'pipe', timeout: 120000, windowsHide: true
    })
    send('setup-output', '[*] Repository cloned.\n')
  }
  await runSetup(['install', '--env', 'venv', '--auto'])
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
        'peft','timm','vector_quantize_pytorch','torchcodec','torchaudio']
r = []
for p in pkgs:
    try: 
        if p == 'python': r.append(f'python={sys.version.split()[0]}')
        elif p == 'opencv-python': r.append(f'opencv={importlib.metadata.version(\"opencv-python\")}')
        else: r.append(f'{p}={importlib.metadata.version(p)}')
    except: pass
print('||'.join(r))
"`, { encoding: 'utf8', timeout: 30000, cwd: REPO_DIR }).trim()
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
    cwd: REPO_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GRADIO_LANG: 'en' },
    windowsHide: true
  })

  wangpProc.stdout.on('data', (d) => { send('launch-log', d.toString()) })
  wangpProc.stderr.on('data', (d) => { send('launch-log', '[e] ' + d.toString()) })

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
    // If process already exited, get the stderr
    if (exited) {
      throw new Error(`Wan2GP exited before server started. Check launch logs.`)
    }
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
    if (!fs.existsSync(ENVS_FILE)) return []
    const d = JSON.parse(fs.readFileSync(ENVS_FILE, 'utf8'))
    return Object.entries(d.envs).map(([name, info]) => ({ name, ...info, active: name === d.active }))
  } catch { return [] }
})

ipcMain.handle('manage-set-active', (_, name) => {
  const d = JSON.parse(fs.readFileSync(ENVS_FILE, 'utf8'))
  d.active = name
  fs.writeFileSync(ENVS_FILE, JSON.stringify(d, null, 4))
  return true
})

ipcMain.handle('manage-delete', async (_, name) => {
  const d = JSON.parse(fs.readFileSync(ENVS_FILE, 'utf8'))
  const entry = d.envs[name]
  if (entry?.path && fs.existsSync(entry.path) && entry.type !== 'none') {
    execSync(IS_WIN ? `rmdir /s /q "${entry.path}"` : `rm -rf "${entry.path}"`, { stdio: 'pipe' })
  }
  delete d.envs[name]
  if (d.active === name) {
    const keys = Object.keys(d.envs)
    d.active = keys.length > 0 ? keys[0] : null
  }
  fs.writeFileSync(ENVS_FILE, JSON.stringify(d, null, 4))
  return true
})

ipcMain.handle('open-external', (_, url) => shell.openExternal(url))

// ── Hardware detection ──
ipcMain.handle('detect-hardware', () => {
  const info = { cpu: '—', ram: '—', gpu: '—', vram: '—' }
  try {
    if (IS_WIN) {
      // CPU
      try {
        const cpuOut = execSync('wmic cpu get name', { encoding: 'utf8', timeout: 5000, shell: true, windowsHide: true })
        info.cpu = cpuOut.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('Name'))[0] || '—'
        if (info.cpu.length > 45) info.cpu = info.cpu.substring(0, 42) + '...'
      } catch {}

      // RAM
      try {
        const ramOut = execSync('wmic memorychip get capacity', { encoding: 'utf8', timeout: 5000, shell: true, windowsHide: true })
        const capacities = ramOut.split('\n').map(l => l.trim()).filter(l => l && !isNaN(Number(l)))
        if (capacities.length > 0) {
          const totalGB = capacities.reduce((s, c) => s + Number(c), 0) / (1024**3)
          info.ram = Math.round(totalGB) + ' GB'
        }
      } catch {}
      if (info.ram === '—') {
        try {
          const totalOut = execSync('wmic computersystem get TotalPhysicalMemory', { encoding: 'utf8', timeout: 5000, shell: true, windowsHide: true })
          const n = totalOut.split('\n').map(l => l.trim()).filter(l => l && !isNaN(Number(l)))[0]
          if (n) info.ram = Math.round(Number(n) / (1024**3)) + ' GB'
        } catch {}
      }

      // GPU + VRAM
      try {
        const gpuOut = execSync('wmic path win32_VideoController get name,adapterram', { encoding: 'utf8', timeout: 5000, shell: true, windowsHide: true })
        const lines = gpuOut.split('\n').filter(l => l.trim())
        if (lines.length > 1) {
          // Last line should have actual data (header skipped)
          for (let i = lines.length - 1; i >= 1; i--) {
            const parts = lines[i].trim().split(/\s{2,}/)
            if (parts.length >= 1 && parts[0].length > 0) {
              info.gpu = parts[0]
              if (parts.length >= 2 && !isNaN(Number(parts[parts.length-1]))) {
                const vramBytes = Number(parts[parts.length-1])
                info.vram = (vramBytes / (1024**3)) >= 1 ? Math.round(vramBytes / (1024**3)) + ' GB' : Math.round(vramBytes / (1024**2)) + ' MB'
              }
              break
            }
          }
        }
      } catch {}

      // Fallback GPU from nvidia-smi
      if (info.gpu === '—') {
        try {
          const nvOut = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader', { encoding: 'utf8', timeout: 10000, windowsHide: true })
          const [nvName, memStr] = nvOut.trim().split(', ')
          if (nvName) info.gpu = nvName
          if (memStr) {
            const mem = parseFloat(memStr)
            info.vram = Math.round(mem) + ' MB'
            if (mem >= 1024) info.vram = Math.round(mem / 1024) + ' GB'
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
      // Apple Silicon GPU info via system_profiler
      try {
        const gpuOut = execSync('system_profiler SPDisplaysDataType 2>/dev/null | grep -E "Chipset Model|VRAM"', { encoding: 'utf8', timeout: 10000 })
        const lines = gpuOut.trim().split('\n')
        if (lines.length > 0) info.gpu = lines[0].replace('Chipset Model:', '').trim()
        if (lines.length > 1) info.vram = lines[1].replace('VRAM (Dynamic, Max):', '').replace('VRAM (Total):', '').trim()
      } catch {}
    } else {
      // Linux
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

autoUpdater.on('checking-for-update', () => send('update-status', { status: 'checking' }))
autoUpdater.on('update-available', (info) => {
  send('update-status', { status: 'available', version: info.version, releaseNotes: info.releaseNotes })
})
autoUpdater.on('update-not-available', () => send('update-status', { status: 'up-to-date' }))
autoUpdater.on('download-progress', (p) => send('update-status', { status: 'downloading', percent: Math.round(p.percent), bytesPerSecond: p.bytesPerSecond, total: p.total, transferred: p.transferred }))
autoUpdater.on('update-downloaded', (info) => send('update-status', { status: 'downloaded', version: info.version }))
autoUpdater.on('error', (err) => send('update-status', { status: 'error', message: err.message || err.toString() }))

ipcMain.handle('check-update', async () => {
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
  // Check for updates after window is ready
  setTimeout(() => {
    try { autoUpdater.checkForUpdates() } catch {}
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
