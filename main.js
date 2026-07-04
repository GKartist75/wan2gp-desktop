const { app, BrowserWindow, ipcMain, shell, Menu, MenuItem, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, exec, execSync } = require('child_process')
const net = require('net')
const http = require('http')
const https = require('https')
const { autoUpdater } = require('electron-updater')

// Ponytail: zero VRAM — Electron uses SwiftShader by default, no need to force-disable GPU.
// Keeping GPU enabled lets webview hardware-decode h265 and keeps Gradio WebSocket stable.
const DATA_DIR_OVERRIDE = path.join(app.getPath('home'), '.wan2gp-desktop-data-dir')

// Redirect Electron's internal runtime data (Cache, blob_storage, etc.) to chosen dir
try {
  if (fs.existsSync(DATA_DIR_OVERRIDE)) {
    const d = fs.readFileSync(DATA_DIR_OVERRIDE, 'utf8').trim()
    if (d) {
      const ed = path.join(d, '.electron')
      fs.mkdirSync(ed, { recursive: true })
      app.setPath('userData', ed)
    }
  }
} catch {}

function getDataDir() {
  try {
    if (fs.existsSync(DATA_DIR_OVERRIDE)) {
      const d = fs.readFileSync(DATA_DIR_OVERRIDE, 'utf8').trim()
      if (d) return d
    }
  } catch {}
  return path.join(app.getPath('userData'), 'Wan2GP')
}

function getConfigFile() { return path.join(getDataDir(), 'desktop-config.json') }
function getRepoDir() { return path.join(getDataDir(), 'Repo_Wan2GP') }
function getEnvsFile() { return path.join(getRepoDir(), 'envs.json') }

const PLATFORM = process.platform
const IS_WIN = PLATFORM === 'win32'

let mainWin = null, wangpProc = null, setupProc = null
let isViewerActive = false
let userStoppedProcess = false
let restartAttempts = 0
const MAX_RESTART_ATTEMPTS = 3

function sysPython() {
  try {
    const out = execSync(IS_WIN ? 'where python' : 'which python3', { encoding: 'utf8' })
    return (out.split('\n')[0] || '').trim() || (IS_WIN ? 'python' : 'python3')
  } catch { return IS_WIN ? 'python' : 'python3' }
}

function send(ch, data) { mainWin?.webContents.send(ch, data) }

function loadConfig() {
  try {
    if (fs.existsSync(getConfigFile())) return JSON.parse(fs.readFileSync(getConfigFile(), 'utf8'))
  } catch {}
  return { githubToken: '', defaultBrowser: '', theme: 'dark' }
}

function saveConfig(cfg) {
  fs.mkdirSync(getDataDir(), { recursive: true })
  fs.writeFileSync(getConfigFile(), JSON.stringify(cfg, null, 2))
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
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        res.resume()
        return
      }
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
    const proc = spawn(py, ['-u', 'setup.py', ...args], {
      cwd: getRepoDir(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    })
    setupProc = proc
    let buf = '', lineBuf = ''
    const emit = (text) => {
      buf += text
      send('setup-output', text)
      lineBuf += text
      const lines = lineBuf.split('\n')
      lineBuf = lines.pop()
      for (const line of lines) {
        const profileMatch = line.match(/Hardware Profile:\s*(\S+)/)
        if (profileMatch) send('setup-profile', profileMatch[1])
        const phase = detectPhase(line)
        if (phase) send('setup-phase', phase)
      }
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
    fs.mkdirSync(getDataDir(), { recursive: true })
    execSync(`git clone --depth 1 https://github.com/deepbeepmeep/Wan2GP.git "${getRepoDir()}"`, {
      stdio: 'pipe', timeout: 120000, windowsHide: true
    })
    send('setup-output', '[*] Repository cloned.\n')
    // Restore backed-up plugins, finetunes, and config from reinstall
    try {
      const backupDir = path.join(getDataDir(), '.reinstall-backup')
      if (fs.existsSync(backupDir)) {
        const repo = getRepoDir()
        for (const sub of ['plugins', 'finetunes']) {
          const src = path.join(backupDir, sub)
          if (fs.existsSync(src)) {
            execSync(IS_WIN ? `xcopy /E /I "${src}" "${path.join(repo, sub)}"` : `cp -r "${src}" "${repo}/"`, { stdio: 'pipe', timeout: 30000, windowsHide: true })
          }
        }
        // Restore config if it exists and no config exists yet
        const configBackup = path.join(backupDir, 'wgp_config.json')
        const configTarget = path.join(repo, 'wgp_config.json')
        if (fs.existsSync(configBackup) && !fs.existsSync(configTarget)) {
          fs.copyFileSync(configBackup, configTarget)
        }
        send('setup-output', '[*] Restored plugins, finetunes, and config.\n')
        // Clean up backup
        fs.rmSync(backupDir, { recursive: true })
      }
    } catch (e) { send('setup-output', `[!] Restore warning: ${e.message}\n`) }
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
  send('setup-output', '[*] Preparing reinstall...\n')
  // Backup plugins, finetunes, and config before wiping
  const backupDir = path.join(getDataDir(), '.reinstall-backup')
  try {
    if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true })
    fs.mkdirSync(backupDir, { recursive: true })
    const repo = getRepoDir()
    for (const sub of ['plugins', 'finetunes']) {
      const src = path.join(repo, sub)
      if (fs.existsSync(src)) {
        execSync(IS_WIN ? `xcopy /E /I "${src}" "${path.join(backupDir, sub)}"` : `cp -r "${src}" "${backupDir}/"`, { stdio: 'pipe', timeout: 30000, windowsHide: true })
      }
    }
    // Backup config
    const configPath = path.join(repo, 'wgp_config.json')
    if (fs.existsSync(configPath)) fs.copyFileSync(configPath, path.join(backupDir, 'wgp_config.json'))
    send('setup-output', '[*] Backed up plugins, finetunes, and config.\n')
  } catch (e) { send('setup-output', `[!] Backup warning: ${e.message}\n`) }
  // Remove repo and envs
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

  wangpProc = spawn(py, ['-u', 'wgp.py', '--server-port', String(port)], {
    cwd: getRepoDir(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1', GRADIO_LANG: 'en', HF_HUB_DISABLE_PROGRESS_BARS: '1', HF_HUB_DISABLE_TELEMETRY: '1', TQDM_POSITION: '-1' },
    windowsHide: true
  })

  wangpProc.stdout.on('data', (d) => { const s = d.toString(); send('launch-log', s); process.stdout.write(s) })
  wangpProc.stderr.on('data', (d) => { const s = d.toString(); send('launch-log', s); process.stderr.write(s) })

  let exited = false
  wangpProc.on('exit', (code) => {
    exited = true
    wangpProc = null
    send('wangp-exit', code)
    if (isViewerActive && !userStoppedProcess) {
      send('launch-log', `[*] Process exited (code ${code}), auto-restarting...\n`)
      setTimeout(() => restartWan2GP(), 1500)
    }
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

ipcMain.handle('is-running', () => wangpProc !== null && wangpProc.exitCode === undefined)

ipcMain.handle('stop', () => {
  userStoppedProcess = true
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

ipcMain.handle('manage-active', () => {
  try {
    if (!fs.existsSync(getEnvsFile())) return null
    const d = JSON.parse(fs.readFileSync(getEnvsFile(), 'utf8'))
    return d.active || null
  } catch { return null }
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
  if (entry?.path && entry.type !== 'none') {
    const envPath = path.isAbsolute(entry.path) ? entry.path : path.join(getRepoDir(), entry.path)
    if (fs.existsSync(envPath)) {
      execSync(IS_WIN ? `rmdir /s /q "${envPath}"` : `rm -rf "${envPath}"`, { stdio: 'pipe' })
    }
  }
  delete d.envs[name]
  if (d.active === name) {
    const keys = Object.keys(d.envs)
    d.active = keys.length > 0 ? keys[0] : null
  }
  fs.writeFileSync(getEnvsFile(), JSON.stringify(d, null, 4))
  return true
})

// ── Uninstall single environment (venv only, keep repo/data) ──
ipcMain.handle('uninstall-env', async (_, name) => {
  const d = JSON.parse(fs.readFileSync(getEnvsFile(), 'utf8'))
  const entry = d.envs[name]
  if (!entry) return { error: 'Environment not found' }
  if (entry?.path && entry.type !== 'none') {
    const envPath = path.isAbsolute(entry.path) ? entry.path : path.join(getRepoDir(), entry.path)
    if (fs.existsSync(envPath)) {
      send('setup-output', `[*] Removing environment ${name}...\n`)
      execSync(IS_WIN ? `rmdir /s /q "${envPath}"` : `rm -rf "${envPath}"`, { stdio: 'pipe' })
    }
  }
  delete d.envs[name]
  if (d.active === name) {
    const keys = Object.keys(d.envs)
    d.active = keys.length > 0 ? keys[0] : null
  }
  fs.writeFileSync(getEnvsFile(), JSON.stringify(d, null, 4))
  send('setup-output', `[*] Environment ${name} uninstalled.\n`)
  return { success: true }
})

// ── Uninstall all Wan2GP (keep output/checkpoint/lora, backup plugins/finetunes) ──
ipcMain.handle('uninstall-wangp', async () => {
  const repo = getRepoDir()
  if (!fs.existsSync(repo)) return { error: 'No Wan2GP installation found' }

  // Ask about backup
  const backupChoice = await dialog.showMessageBox(mainWin, {
    type: 'question',
    buttons: ['Backup plugins & finetunes', 'Skip backup', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: 'Backup plugins and finetunes?',
    detail: 'Plugins and finetunes will be backed up to: ' + path.join(getDataDir(), '.uninstall-backup')
  })
  if (backupChoice.response === 2) return { cancelled: true }
  const doBackup = backupChoice.response === 0

  if (doBackup) {
    send('setup-output', '[*] Backing up plugins and finetunes...\n')
    const backupDir = path.join(getDataDir(), '.uninstall-backup')
    try {
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true })
      fs.mkdirSync(backupDir, { recursive: true })
      for (const sub of ['plugins', 'finetunes']) {
        const src = path.join(repo, sub)
        if (fs.existsSync(src)) {
          execSync(IS_WIN ? `xcopy /E /I "${src}" "${path.join(backupDir, sub)}"` : `cp -r "${src}" "${backupDir}/"`, { stdio: 'pipe', timeout: 30000, windowsHide: true })
        }
      }
      const configPath = path.join(repo, 'wgp_config.json')
      if (fs.existsSync(configPath)) fs.copyFileSync(configPath, path.join(backupDir, 'wgp_config.json'))
      send('setup-output', `[*] Backup saved to ${backupDir}\n`)
    } catch (e) { send('setup-output', `[!] Backup warning: ${e.message}\n`) }
  }

  // Ask about output/checkpoint/lora — delete or keep?
  let keepDirs = []
  // Collect paths first
  const collectedPaths = []
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(repo, 'wgp_config.json'), 'utf8'))
    for (const key of ['save_path', 'checkpoints_path', 'loras_path']) {
      if (cfg[key] && path.isAbsolute(cfg[key]) && fs.existsSync(cfg[key])) {
        collectedPaths.push({ path: cfg[key], label: key === 'save_path' ? 'Outputs folder' : key === 'checkpoints_path' ? 'Checkpoints folder' : 'LoRAs folder' })
      }
    }
  } catch {}
  const defaultSubs = [
    { sub: 'workspace/outputs', label: 'Outputs folder (workspace/outputs)' },
    { sub: 'workspace/checkpoints', label: 'Checkpoints folder (workspace/checkpoints)' },
    { sub: 'workspace/loras', label: 'LoRAs folder (workspace/loras)' }
  ]
  for (const ds of defaultSubs) {
    const p = path.join(repo, ds.sub)
    if (fs.existsSync(p) && !collectedPaths.find(c => c.path === p)) {
      collectedPaths.push({ path: p, label: ds.label })
    }
  }

  if (collectedPaths.length > 0) {
    const detail = collectedPaths.map(c => '  • ' + c.label).join('\n')
    const keepChoice = await dialog.showMessageBox(mainWin, {
      type: 'question',
      buttons: ['Keep them', 'Delete them too', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Delete or keep these folders?',
      detail: detail
    })
    if (keepChoice.response === 2) return { cancelled: true }
    if (keepChoice.response === 0) {
      keepDirs = collectedPaths.map(c => c.path)
    }
  }

  // Nuke repo (keeping or moving aside preserve dirs)
  send('setup-output', '[*] Removing Wan2GP...\n')
  if (keepDirs.length > 0) {
    const tempDir = path.join(getDataDir(), '.uninstall-keep')
    try {
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true })
      fs.mkdirSync(tempDir, { recursive: true })
      for (const p of keepDirs) {
        const base = path.basename(p)
        const dest = path.join(tempDir, base)
        if (fs.existsSync(p)) {
          execSync(IS_WIN ? `move "${p}" "${dest}"` : `mv "${p}" "${dest}"`, { stdio: 'pipe', timeout: 30000, windowsHide: true })
        }
      }
      execSync(IS_WIN ? `rmdir /s /q "${repo}"` : `rm -rf "${repo}"`, { stdio: 'pipe', timeout: 60000, windowsHide: true })
      fs.mkdirSync(repo, { recursive: true })
      for (const p of keepDirs) {
        const base = path.basename(p)
        const src = path.join(tempDir, base)
        if (fs.existsSync(src)) {
          const parent = path.dirname(p)
          if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true })
          execSync(IS_WIN ? `move "${src}" "${p}"` : `mv "${src}" "${p}"`, { stdio: 'pipe', timeout: 30000, windowsHide: true })
        }
      }
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch (e) { send('setup-output', `[!] Error: ${e.message}\n`) }
  } else {
    // Just nuke everything
    try { execSync(IS_WIN ? `rmdir /s /q "${repo}"` : `rm -rf "${repo}"`, { stdio: 'pipe', timeout: 60000, windowsHide: true }) } catch {}
  }

  // Remove envs.json
  try { fs.rmSync(getEnvsFile(), { force: true }) } catch {}

  send('setup-output', `[*] Wan2GP uninstalled.${keepDirs.length > 0 ? ' Output/checkpoint/loras kept.' : ''}${doBackup ? ' Plugins/finetunes backed up.' : ''}\n`)
  return { success: true }
})

ipcMain.handle('open-external', (_, url) => {
  if (typeof url !== 'string' || !url.startsWith('http')) return
  try { new URL(url) } catch { return }
  shell.openExternal(url)
})

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
  appData: getDataDir(),
  repo: getRepoDir(),
  config: getConfigFile()
}))

ipcMain.handle('get-data-dir', () => getDataDir())
ipcMain.handle('set-data-dir', (_, dir) => {
  fs.writeFileSync(DATA_DIR_OVERRIDE, dir)
  // Redirect Electron runtime cache to new location
  try {
    const ed = path.join(dir, '.electron')
    fs.mkdirSync(ed, { recursive: true })
    app.setPath('userData', ed)
  } catch {}
  return true
})

// ── Hardware-tuned default settings for wgp_config.json ──
// Mirrors WanGP's own setup.py profile logic but runs in Node (no Python dep)
function getHardwareDefaults() {
  const out = { attention: 'auto', compile: '', profile: 5, hierarchy: 1 }
  try {
    let gpuName = '', vramMB = 0
    // Try nvidia-smi first
    try {
      const ns = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader', { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim()
      if (ns) {
        const parts = ns.split(', ')
        gpuName = parts[0] || ''
        vramMB = parseFloat(parts[1]) || 0
      }
    } catch {}
    // Fallback to WMI for non-NVIDIA GPUs
    if (!gpuName && IS_WIN) {
      try {
        const wmi = execSync('powershell -Command "Get-CimInstance Win32_VideoController | Select-Object -First 1 Name, AdapterRAM | ForEach-Object {$_.Name + \'|\' + $_.AdapterRAM}"', { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim()
        if (wmi) {
          const parts = wmi.split('|')
          gpuName = (parts[0] || '').trim()
          vramMB = Math.round((parseInt(parts[1]) || 0) / (1024*1024))
        }
      } catch {}
    }

    // Detect total RAM
    let ramGB = 0
    try {
      if (IS_WIN) {
        const r = execSync('powershell -Command "Get-CimInstance Win32_ComputerSystem | ForEach-Object { [math]::Round($_.TotalPhysicalMemory / 1GB) }"', { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim()
        ramGB = parseInt(r) || 0
      } else if (PLATFORM === 'darwin') {
        const r = execSync('sysctl -n hw.memsize', { encoding: 'utf8', timeout: 5000 }).trim()
        ramGB = Math.round(Number(r) / (1024**3))
      } else {
        const r = execSync('free -b | grep Mem', { encoding: 'utf8', timeout: 5000, shell: true }).trim()
        ramGB = Math.round(parseInt(r.split(/\s+/)[1]) / (1024**3))
      }
    } catch {}
    if (ramGB <= 0) ramGB = 16; // fallback

    const upper = gpuName.toUpperCase()

    // Attention mode by GPU generation
    if (upper.includes('RTX') || upper.includes('QUADRO')) {
      if (/50\s*\d0|RTX 50|5090|5080|5070|5060/.test(upper)) {
        out.attention = 'sage2'
        out.compile = 'transformer'
      }
      else if (/40\s*\d0|RTX 40|4090|4080|4070|4060/.test(upper)) {
        out.attention = 'sage2'
        out.compile = 'transformer'
      }
      else if (/30\s*\d0|RTX 30|3090|3080|3070|3060/.test(upper)) {
        out.attention = 'sage2'
        out.compile = 'transformer'
      }
      else if (/20\s*\d0|RTX 20|2080|2070|2060/.test(upper)) {
        out.attention = 'sage'
      }
      else {
        out.attention = 'auto'
      }
    } else if (upper.includes('APPLE') || upper.includes('MPS')) {
      out.attention = 'auto'
    } else {
      out.attention = 'auto'
    }

    // Profile 1-5 based on RAM+VRAM (same algorithm as WanGP setup.py)
    const hasHighRam = ramGB > 60
    const hasMidRam = ramGB > 30
    const hasHugeVram = vramMB > 22 * 1024  // >22 GB
    const hasHighVram = vramMB > 11 * 1024  // >11 GB
    if (hasHighRam && hasHugeVram) out.profile = 1
    else if (hasHighRam) out.profile = 2
    else if (hasMidRam && hasHugeVram) out.profile = 3
    else if (hasMidRam && hasHighVram) out.profile = 4
    else out.profile = 5

    // Hierarchy: 2 (expert) if >16GB VRAM, else 1 (standard)
    out.hierarchy = vramMB > 16 * 1024 ? 2 : 1
  } catch {}
  return out
}

ipcMain.handle('write-wgp-config', (_, { checkpointsPaths, lorasRoot }) => {
  const hw = getHardwareDefaults()
  const configPath = path.join(getRepoDir(), 'wgp_config.json')
  let cfg = {}
  try {
    if (fs.existsSync(configPath)) {
      cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    }
  } catch {}
  if (checkpointsPaths) cfg.checkpoints_paths = checkpointsPaths
  if (lorasRoot) cfg.loras_root = lorasRoot
  // ponytail: hardware-tuned defaults — setdefault-style, only fill missing
  if (cfg.attention_mode === undefined) cfg.attention_mode = hw.attention
  // Profile 1-5 based on RAM/VRAM (same as WanGP setup.py)
  if (cfg.video_profile === undefined) cfg.video_profile = hw.profile
  if (cfg.image_profile === undefined) cfg.image_profile = hw.profile
  if (cfg.audio_profile === undefined) cfg.audio_profile = hw.profile
  // Compile mode: 'transformer' for RTX 40+ with sage2 attn, else ''
  if (cfg.compile === undefined) cfg.compile = hw.compile
  if (cfg.transformer_quantization === undefined) cfg.transformer_quantization = 'int8'
  if (cfg.text_encoder_quantization === undefined) cfg.text_encoder_quantization = 'int8'
  if (cfg.metadata_type === undefined) cfg.metadata_type = 'metadata'
  if (cfg.boost === undefined) cfg.boost = 1
  if (cfg.enable_int8_kernels === undefined) cfg.enable_int8_kernels = 1
  if (cfg.clear_file_list === undefined) cfg.clear_file_list = 10
  if (cfg.keep_intermediate_sliding_windows === undefined) cfg.keep_intermediate_sliding_windows = 1
  if (cfg.keep_resolution_on_model_switch === undefined) cfg.keep_resolution_on_model_switch = true
  if (cfg.enable_4k_resolutions === undefined) cfg.enable_4k_resolutions = 0
  if (cfg.max_reserved_loras === undefined) cfg.max_reserved_loras = -1
  if (cfg.vae_config === undefined) cfg.vae_config = 0
  if (cfg.preload_model_policy === undefined) cfg.preload_model_policy = []
  if (cfg.UI_theme === undefined) cfg.UI_theme = 'default'
  if (cfg.save_queue_if_crash === undefined) cfg.save_queue_if_crash = 1
  if (cfg.queue_color_scheme === undefined) cfg.queue_color_scheme = 'pastel'
  if (cfg.process_queues_when_browser_unfocused === undefined) cfg.process_queues_when_browser_unfocused = 1
  if (cfg.model_hierarchy_type === undefined) cfg.model_hierarchy_type = hw.hierarchy
  if (cfg.prompt_enhancer_quantization === undefined) cfg.prompt_enhancer_quantization = 'quanto_int8'
  if (cfg.prompt_enhancer_temperature === undefined) cfg.prompt_enhancer_temperature = 0.6
  if (cfg.prompt_enhancer_top_p === undefined) cfg.prompt_enhancer_top_p = 0.9
  if (cfg.prompt_enhancer_randomize_seed === undefined) cfg.prompt_enhancer_randomize_seed = true
  // Enable real-time RAM/VRAM stats display in Wan2GP UI
  if (cfg.display_stats === undefined || cfg.display_stats === 0) cfg.display_stats = 1
  // Save outputs to desktop data dir instead of default repo path
  cfg.save_path = path.join(getDataDir(), 'outputs')
  cfg.image_save_path = cfg.save_path
  cfg.audio_save_path = cfg.save_path
  // Ensure all tensors default to cuda:0
  if (cfg.device === undefined) cfg.device = 'cuda:0'
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 4))
  return true
})

ipcMain.handle('select-folder', async () => {
  const { dialog } = require('electron')
  const result = await dialog.showOpenDialog(mainWin, { properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

// ── Auto-detect model folders ──
ipcMain.handle('get-model-paths', () => {
  const configPath = path.join(getRepoDir(), 'wgp_config.json')
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    const paths = {}
    if (cfg.checkpoints_paths && Array.isArray(cfg.checkpoints_paths)) paths.checkpoints = cfg.checkpoints_paths[0]
    if (cfg.loras_root) paths.loras = cfg.loras_root
    if (cfg.save_path) paths.output = cfg.save_path
    return Object.keys(paths).length ? paths : null
  } catch { return null }
})

ipcMain.handle('detect-model-folders', () => {
  const repo = getRepoDir()
  const ckptsDir = path.join(repo, 'ckpts')
  const lorasDir = path.join(repo, 'loras')
  const suggestions = {
    checkpointsPaths: [ckptsDir, repo],
    lorasRoot: fs.existsSync(lorasDir) ? lorasDir : ''
  }
  // If existing config has saved paths, use those instead
  const configPath = path.join(repo, 'wgp_config.json')
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      if (cfg.checkpoints_paths && Array.isArray(cfg.checkpoints_paths)) suggestions.checkpointsPaths = cfg.checkpoints_paths
      if (cfg.loras_root) suggestions.lorasRoot = cfg.loras_root
    }
  } catch {}
  return suggestions
})

// ── Output folder browser ──
const IMG_EXTS = new Set(['.png','.jpg','.jpeg','.gif','.webp','.bmp','.tif','.tiff'])
const VID_EXTS = new Set(['.mp4','.mov','.avi','.mkv','.webm','.m4v','.mpeg','.mpg'])

function getOutputDir() {
  const configPath = path.join(getRepoDir(), 'wgp_config.json')
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      if (cfg.save_path && fs.existsSync(cfg.save_path)) return cfg.save_path
    }
  } catch {}
  return path.join(getRepoDir(), 'outputs')
}

// ── Watch output directory for changes ──
let outputWatchDebounce = null
let outputWatcher = null
function startOutputWatcher() {
  try {
    if (outputWatcher) { outputWatcher.close(); outputWatcher = null }
    const dir = getOutputDir()
    if (!fs.existsSync(dir)) return
    outputWatcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
      if (outputWatchDebounce) clearTimeout(outputWatchDebounce)
      outputWatchDebounce = setTimeout(() => {
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('output-files-changed')
        }
      }, 500)
    })
  } catch {}
}

// ── Copy files to output directory (dropped by user) ──
ipcMain.handle('copy-files-to-output', (_, filePaths) => {
  if (!Array.isArray(filePaths)) return []
  const outDir = getOutputDir()
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const copied = []
  for (const fp of filePaths) {
    try {
      const name = path.basename(fp)
      const dest = path.join(outDir, name)
      // Avoid overwrite
      let finalDest = dest
      let counter = 1
      while (fs.existsSync(finalDest)) {
        const ext = path.extname(name)
        const base = path.basename(name, ext)
        finalDest = path.join(outDir, base + '_' + counter + ext)
        counter++
      }
      fs.copyFileSync(fp, finalDest)
      copied.push(finalDest)
    } catch {}
  }
  if (copied.length && mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('output-files-changed')
  }
  return copied
})

ipcMain.handle('list-output-files', (_, subdir) => {
  const base = getOutputDir()
  const dir = subdir && path.isAbsolute(subdir) && fs.existsSync(subdir) ? subdir : base
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const folders = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => ({
      name: e.name,
      path: path.join(dir, e.name),
      type: 'folder'
    })).sort((a, b) => a.name.localeCompare(b.name))
    // Add parent folder entry if not at root
    if (path.resolve(dir) !== path.resolve(base)) {
      folders.unshift({ name: '..', path: path.resolve(dir, '..'), type: 'folder' })
    }
    const files = entries.filter(e => {
      if (!e.isFile()) return false
      const ext = path.extname(e.name).toLowerCase()
      return IMG_EXTS.has(ext) || VID_EXTS.has(ext)
    }).sort((a, b) => fs.statSync(path.join(dir, b.name)).mtimeMs - fs.statSync(path.join(dir, a.name)).mtimeMs).slice(0, 200).map(e => ({
      name: e.name,
      path: path.join(dir, e.name),
      type: IMG_EXTS.has(path.extname(e.name).toLowerCase()) ? 'image' : 'video'
    }))
    return { dir, files, folders }
  } catch { return { dir, files: [], folders: [] } }
})

ipcMain.handle('delete-files', (_, filePaths) => {
  if (!Array.isArray(filePaths)) return false
  for (const fp of filePaths) {
    try {
      if (fs.existsSync(fp)) fs.rmSync(fp)
      // Remove sidecar files
      const base = path.join(path.dirname(fp), path.basename(fp, path.extname(fp)))
      for (const ext of ['.json', '.txt', '.metadata']) {
        const sidecar = base + ext
        if (fs.existsSync(sidecar)) fs.rmSync(sidecar)
      }
    } catch {}
  }
  return true
})

ipcMain.handle('set-output-path', async () => {
  const { dialog } = require('electron')
  const result = await dialog.showOpenDialog(mainWin, { properties: ['openDirectory'] })
  if (result.canceled) return null
  const newDir = result.filePaths[0]
  const configPath = path.join(getRepoDir(), 'wgp_config.json')
  try {
    let cfg = {}
    if (fs.existsSync(configPath)) cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    cfg.save_path = newDir
    cfg.image_save_path = newDir
    cfg.audio_save_path = newDir
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 4))
    startOutputWatcher()
  } catch {}
  return newDir
})

// ── Read file metadata via WanGP's own Python (handles PNG/JPEG/MP4/MKV/audio) ──
// ── Read file metadata via WanGP's own Python (handles PNG/JPEG/MP4/MKV/audio) ──
ipcMain.handle('read-file-metadata-python', async (_, filePath) => {
  const env = getActiveEnv()
  if (!env) return null
  const py = getPythonForEnv(env)
  if (!py) return null
  const repo = getRepoDir()
  // Write a small Python helper to temp and run it (async, doesn't block main process)
  const helperPath = path.join(getDataDir(), '.meta_reader.py')
  const helperCode = `import sys, json
sys.path.insert(0, sys.argv[1])
from wgp import get_settings_from_file
fp = sys.argv[2]
configs, any_video, any_audio = get_settings_from_file({'model_type': None}, fp, True, True, True, skip_validate_settings=True) or (None, False, False)
if configs:
    for k in list(configs.keys()):
        if isinstance(configs[k], (dict, list, str, int, float, bool, type(None))): continue
        del configs[k]
    sys.stdout.write('JSON_OK:' + json.dumps(configs, default=str))
else:
    sys.stdout.write('JSON_NULL')
`
  try {
    fs.writeFileSync(helperPath, helperCode)
    const { exec } = require('child_process')
    const result = await new Promise((resolve, reject) => {
      exec('"' + py + '" "' + helperPath + '" "' + repo + '" "' + filePath + '"',
        { cwd: repo, timeout: 30000, windowsHide: true, encoding: 'utf8' },
        (err, stdout) => { if (err) reject(err); else resolve(stdout.trim()) }
      )
    })
    if (result.startsWith('JSON_OK:')) {
      try { return JSON.parse(result.substring(8)) } catch {}
    }
  } catch (e) { /* fallback to Node.js reader */ }
  return null
})

ipcMain.handle('read-file-metadata', (_, filePath) => {
  const ext = path.extname(filePath).toLowerCase()
  try {
    if (ext === '.png') return readPngComment(filePath)
    const sidecar = filePath + '.json'
    if (fs.existsSync(sidecar)) return JSON.parse(fs.readFileSync(sidecar, 'utf8'))
    const txtSidecar = filePath.replace(ext, '.txt')
    if (fs.existsSync(txtSidecar)) return { prompt: fs.readFileSync(txtSidecar, 'utf8').trim() }
  } catch {}
  return null
})

// ── Read local file from webview context (used by drag-drop handler) ──
ipcMain.handle('read-local-file', (_, filePath) => {
  try {
    const data = fs.readFileSync(filePath)
    return { data: data.toString('base64'), name: path.basename(filePath), size: data.length, mime: 'application/octet-stream' }
  } catch { return null }
})

// ── Upload file to Gradio's /upload endpoint (for loading settings into WanGP) ──
ipcMain.handle('upload-to-gradio', (_, filePath) => {
  return new Promise((resolve) => {
    try {
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2)
      const fileName = path.basename(filePath)
      const fileData = fs.readFileSync(filePath)
      const header = `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
      const footer = `\r\n--${boundary}--\r\n`
      const body = Buffer.concat([Buffer.from(header), fileData, Buffer.from(footer)])

      const options = {
        hostname: '127.0.0.1',
        port: 17861,
        path: '/upload',
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
          'Content-Length': body.length
        }
      }

      const req = http.request(options, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            resolve(Array.isArray(parsed) ? parsed : null)
          } catch { resolve(null) }
        })
      })
      req.on('error', () => resolve(null))
      req.write(body)
      req.end()
    } catch { resolve(null) }
  })
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

ipcMain.handle('set-viewer-active', (_, active) => {
  isViewerActive = active
  if (!active) {
    userStoppedProcess = false
    restartAttempts = 0
  }
  return true
})

// ── Sidebar drag path (IPC bridge for drag to webview) ──
let pendingDragPath = ''
ipcMain.handle('set-pending-drag-path', (_, p) => { pendingDragPath = p || ''; return true })
ipcMain.handle('get-pending-drag-path', () => pendingDragPath)

// ── Desktop app git info ──
ipcMain.handle('get-desktop-git-info', () => {
  try {
    const cwd = path.resolve(__dirname)
    if (!fs.existsSync(path.join(cwd, '.git'))) return null
    const hash = execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf8', timeout: 5000 }).trim()
    const date = execSync('git log -1 --format=%cI', { cwd, encoding: 'utf8', timeout: 5000 }).trim()
    const msg = execSync('git log -1 --format=%s', { cwd, encoding: 'utf8', timeout: 5000 }).trim()
    return { hash, date, message: msg }
  } catch { return null }
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
autoUpdater.autoDownload = true
autoUpdater.allowPrerelease = false

autoUpdater.on('checking-for-update', () => { console.log('[DEBUG] Checking for update...'); send('update-status', { status: 'checking' }) })
autoUpdater.on('update-available', (info) => { console.log('[DEBUG] Update available:', info.version); send('update-status', { status: 'available', version: info.version, releaseNotes: info.releaseNotes }) })
autoUpdater.on('update-not-available', () => { console.log('[DEBUG] Up to date'); send('update-status', { status: 'up-to-date' }) })
autoUpdater.on('download-progress', (p) => { console.log('[DEBUG] Download progress:', p.percent); send('update-status', { status: 'downloading', percent: Math.round(p.percent), bytesPerSecond: p.bytesPerSecond, total: p.total, transferred: p.transferred }) })
autoUpdater.on('update-downloaded', (info) => { console.log('[DEBUG] Update downloaded:', info.version); send('update-status', { status: 'downloaded', version: info.version }) })
autoUpdater.on('error', (err) => { console.log('[DEBUG] Update error:', err.message); send('update-status', { status: 'error', message: err.message || err.toString() }) })

ipcMain.handle('check-update', async (_, opts) => {
  if (opts?.local) {
    // Shift+click — test against local server
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: 'http://localhost:8888'
    })
  } else {
    const cfg = loadConfig()
    if (cfg.githubToken) {
      process.env.GH_TOKEN = cfg.githubToken
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'GKartist75',
        repo: 'wan2gp-desktop',
        token: cfg.githubToken
      })
    } else {
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'GKartist75',
        repo: 'wan2gp-desktop'
      })
    }
  }
  try { autoUpdater.checkForUpdates() } catch (e) { send('update-status', { status: 'error', message: e.message }) }
})

ipcMain.handle('download-update', async () => {
  try { await autoUpdater.downloadUpdate() } catch (e) { send('update-status', { status: 'error', message: e.message }) }
})

ipcMain.handle('install-update', async () => autoUpdater.quitAndInstall())

// ── Webview native context menu (copy/paste/select all) ──
app.on('web-contents-created', (_event, contents) => {
  contents.on('context-menu', (_event, params) => {
    const menu = new Menu()
    if (params.isEditable) {
      menu.append(new MenuItem({ label: 'Undo', role: 'undo' }))
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({ label: 'Cut', role: 'cut' }))
    }
    menu.append(new MenuItem({ label: 'Copy', role: 'copy' }))
    if (params.isEditable) menu.append(new MenuItem({ label: 'Paste', role: 'paste' }))
    menu.append(new MenuItem({ type: 'separator' }))
    menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }))
    menu.popup({ window: contents })
  })
})

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
  mainWin.once('ready-to-show', () => { mainWin.maximize(); mainWin.show() })
  mainWin.on('closed', () => { mainWin = null })
}

process.on('uncaughtException', err => console.error('[FATAL]', err))
process.on('unhandledRejection', reason => console.error('[FATAL] Unhandled Rejection:', reason))

app.whenReady().then(() => {
  // Pin data dir on first launch so it never shifts between updates
  try {
    if (!fs.existsSync(DATA_DIR_OVERRIDE)) {
      const d = path.join(app.getPath('userData'), 'Wan2GP')
      fs.mkdirSync(d, { recursive: true })
      fs.writeFileSync(DATA_DIR_OVERRIDE, d)
    }
  } catch {}
  createWindow()
  // Watch output dir for new files (generation completed signal)
  setTimeout(startOutputWatcher, 3000)
  setTimeout(() => {
    try {
      const cfg = loadConfig()
      if (cfg.githubToken) {
        process.env.GH_TOKEN = cfg.githubToken
        autoUpdater.setFeedURL({
          provider: 'github',
          owner: 'GKartist75',
          repo: 'wan2gp-desktop',
          token: cfg.githubToken
        })
      }
      autoUpdater.checkForUpdates()
    } catch {}
  }, 5000)
})
async function restartWan2GP() {
  if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
    send('launch-log', `[!] Max restart attempts (${MAX_RESTART_ATTEMPTS}) reached.\n`)
    send('wangp-restart-failed', 'Max restart attempts exceeded')
    isViewerActive = false
    return
  }
  restartAttempts++
  send('launch-log', `[*] Restart attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS}...\n`)
  send('wangp-restarting', restartAttempts)

  try {
    const env = getActiveEnv()
    if (!env) throw new Error('No active environment')
    const py = getPythonForEnv(env)
    if (!py) throw new Error('Cannot find python for env')

    const port = 17861
    wangpProc = spawn(py, ['-u', 'wgp.py', '--server-port', String(port)], {
      cwd: getRepoDir(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1', GRADIO_LANG: 'en', HF_HUB_DISABLE_PROGRESS_BARS: '1', HF_HUB_DISABLE_TELEMETRY: '1', TQDM_POSITION: '-1' },
      windowsHide: true
    })

    wangpProc.stdout.on('data', (d) => { const s = d.toString(); send('launch-log', s); process.stdout.write(s) })
    wangpProc.stderr.on('data', (d) => { const s = d.toString(); send('launch-log', s); process.stderr.write(s) })

    wangpProc.on('exit', (code) => {
      wangpProc = null
      send('wangp-exit', code)
      if (isViewerActive && !userStoppedProcess) {
        send('launch-log', `[*] Process exited (code ${code}), auto-restarting...\n`)
        setTimeout(() => restartWan2GP(), 1500)
      }
    })

    await waitForPort('127.0.0.1', port, 180000)
    send('launch-log', '[*] Wan2GP restarted successfully!\n')
    restartAttempts = 0
    send('wangp-restarted', `http://127.0.0.1:${port}`)
  } catch (err) {
    send('launch-log', `[!] Restart failed: ${err.message}\n`)
    send('wangp-restart-failed', err.message)
  }
}

app.on('window-all-closed', () => {
  if (wangpProc) wangpProc.kill()
  if (PLATFORM !== 'darwin') app.quit()
})
app.on('activate', () => { if (!mainWin) createWindow() })
app.on('before-quit', () => {
  if (wangpProc) wangpProc.kill()
  if (setupProc) setupProc.kill()
})
