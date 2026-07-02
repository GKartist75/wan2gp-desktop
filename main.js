const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, execSync } = require('child_process')
const net = require('net')

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

// Detect install phases from setup.py output
function detectPhase(line) {
  const l = line.toLowerCase()
  if (l.includes('preparing environment')) return { id: 'venv', label: 'Creating Python venv', done: false }
  if (l.includes('[2/3] installing torch')) return { id: 'torch', label: 'Installing PyTorch + CUDA wheels', done: false }
  if (l.includes('[3/3] installing requirements')) return { id: 'reqs', label: 'Installing Python dependencies', done: false }
  if (l.includes('installing triton')) return { id: 'triton', label: 'Installing Triton compiler', done: false }
  if (l.includes('sage attention') && l.includes('installing')) return { id: 'sage', label: 'Installing Sage Attention', done: false }
  if (l.includes('flash attention') && l.includes('installing')) return { id: 'flash', label: 'Installing Flash Attention', done: false }
  if (l.includes('nunchaku') && (l.includes('installing') || l.includes('running'))) return { id: 'kernels', label: 'Installing GPU kernels (nunchaku/GGUF)', done: false }
  if (l.includes('requirements for plugin')) return { id: 'plugins', label: 'Installing plugin requirements', done: false }
  // Completion markers
  if (l.includes('automatic install complete') || l.includes('installation complete')) return { id: 'done', label: 'Installation complete', done: true }
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
r = [f'python={sys.version.split()[0]}']
for p in ['torch','triton','sageattention','spas_sage_attn','flash_attn']:
    try: r.append(f'{p}={importlib.metadata.version(p)}')
    except: r.append(f'{p}=missing')
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

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  if (wangpProc) wangpProc.kill()
  if (PLATFORM !== 'darwin') app.quit()
})
app.on('activate', () => { if (!mainWin) createWindow() })
app.on('before-quit', () => {
  if (wangpProc) wangpProc.kill()
  if (setupProc) setupProc.kill()
})
