const { app, BrowserWindow, ipcMain, shell, Menu, MenuItem, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, exec, execSync } = require('child_process')
const net = require('net')
const http = require('http')
const https = require('https')
const { autoUpdater } = require('electron-updater')

// No GPU override — Electron uses SwiftShader by default.
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
function getRepoDir() { return path.join(getDataDir(), 'Wan2GP') }
function getEnvsFile() { return path.join(getRepoDir(), 'envs.json') }

const PLATFORM = process.platform
const IS_WIN = PLATFORM === 'win32'

let mainWin = null, setupProc = null
let _currentPort = 7860 // tracked across launches/restarts

function sysPython() {
  try {
    const out = execSync(IS_WIN ? 'where python' : 'which python3', { encoding: 'utf8' })
    return (out.split('\n')[0] || '').trim() || (IS_WIN ? 'python' : 'python3')
  } catch { return IS_WIN ? 'python' : 'python3' }
}

function send(ch, data) {
  mainWin?.webContents.send(ch, data)
}

function loadConfig() {
  try {
    if (fs.existsSync(getConfigFile())) return JSON.parse(fs.readFileSync(getConfigFile(), 'utf8'))
  } catch {}
  return { githubToken: '', theme: 'dark', serverPort: 7860 }
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

function fetchUrl(url, opts = {}) {
  const { method, body, headers, timeout } = opts
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const mod = parsed.protocol === 'https:' ? https : http
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: method || 'GET',
      headers: { 'User-Agent': 'wan2gp-desktop', ...headers },
      timeout: timeout || 15000
    }
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body)
    const req = mod.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        } else {
          try { resolve(JSON.parse(data)) } catch { resolve(data) }
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    if (body) req.write(body)
    req.end()
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
    let lineBuf = ''
    const emit = (text) => {
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
      if (code === 0) resolve()
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
  const envPath = path.normalize(path.isAbsolute(env.path) ? env.path : path.join(getRepoDir(), env.path))
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
    // Write Python script to temp file to avoid shell quoting issues
    const helperPath = path.join(getDataDir(), '.get_versions.py')
    const helperCode = [
      'import sys, importlib.metadata',
      "aliases = {'triton': 'triton-windows', 'opencv-python': 'opencv',",
      "          'spas_sage_attn': 'spas-sage-attn', 'huggingface_hub': 'huggingface-hub'}",
      "pkgs = ['python','torch','triton','sageattention','spas_sage_attn','flash_attn',",
      "        'diffusers','transformers','gradio','accelerate','onnxruntime','xformers',",
      "        'nunchaku','gguf','mmgp','moviepy','opencv-python','insightface',",
      "        'peft','timm','vector_quantize_pytorch','torchcodec','torchaudio',",
      "        'huggingface_hub','bitsandbytes','numpy','sentencepiece','open_clip_torch',",
      "        'imageio','einops','librosa','soundfile','tokenizers','av']",
      'r = []',
      'for p in pkgs:',
      '    try:',
      "        if p == 'python': r.append(f'python={sys.version.split()[0]}')",
      "        elif p in aliases: r.append(f'{p}={importlib.metadata.version(aliases[p])}')",
      '        else: r.append(f\'{p}={importlib.metadata.version(p)}\')',
      '    except: pass',
      "print('||'.join(r))",
    ].join('\n')
    fs.writeFileSync(helperPath, helperCode)
    const { exec } = require('child_process')
    const out = await new Promise((resolve, reject) => {
      exec('"' + py + '" "' + helperPath + '"', {
        cwd: getRepoDir(), timeout: 30000, windowsHide: true, encoding: 'utf8'
      }, (err, stdout) => {
        if (err) reject(err)
        else resolve(stdout.trim())
      })
    })
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

  const cfg = loadConfig()
  let preferredPort = cfg.serverPort || 7860
  const extraArgs = (cfg.launchArgs || '').trim().split(/\s+/).filter(Boolean)
  for (let i = 0; i < extraArgs.length; i++) {
    if (extraArgs[i] === '--server-port' && i + 1 < extraArgs.length) {
      preferredPort = parseInt(extraArgs[i + 1]) || preferredPort
    }
  }
  // Ensure --server-port in args
  const hasPort = extraArgs.some(a => a === '--server-port')
  if (!hasPort) { extraArgs.push('--server-port', String(preferredPort)) }

  const port = preferredPort
  _currentPort = port
  send('launch-log', '[*] Starting Wan2GP...\n')
  send('launch-log', `[*] Python: ${py}\n`)
  send('launch-log', `[*] Port: ${port}\n`)
  send('launch-log', `[*] Args: ${extraArgs.join(' ')}\n`)

  // Create temp launch script (visible terminal window)
  const repoDir = getRepoDir()
  const tmpDir = require('os').tmpdir()
  const scriptPath = path.join(tmpDir, 'wan2gp-launch' + (IS_WIN ? '.bat' : '.sh'))

  if (IS_WIN) {
    const bat = [
      '@echo off',
      'title Wan2GP',
      'cd /d "' + repoDir + '"',
      'echo.',
      'echo [Wan2GP Desktop Launcher]',
      'echo Starting Wan2GP on port ' + port + '...',
      'echo First launch loads models + compiles CUDA kernels - this will take some extra time.',
      'echo.',
      '"' + py + '" -u wgp.py ' + extraArgs.join(' '),
      'echo.',
      'if errorlevel 1 echo [Wan2GP] Process exited with code %errorlevel% ^(see above for errors^)',
      'echo [Wan2GP] You can close this window.',
      'pause',
    ].join('\n')
    fs.writeFileSync(scriptPath, bat, 'utf8')
  } else {
    const sh = [
      '#!/bin/bash',
      'echo "[Wan2GP Desktop Launcher]"',
      'echo "Starting Wan2GP on port ' + port + '..."',
      'echo',
      'cd "' + repoDir + '"',
      '"' + py + '" -u wgp.py ' + extraArgs.join(' '),
      'echo',
      'echo "[Wan2GP] Process exited. You can close this terminal."',
      'read -p "Press Enter to close..."',
    ].join('\n')
    fs.writeFileSync(scriptPath, sh, 'utf8')
    fs.chmodSync(scriptPath, 0o755)
  }

  // Open in new terminal window
  const cmd = IS_WIN
    ? `start "Wan2GP" cmd /c "${scriptPath}"`
    : `x-terminal-emulator -e "${scriptPath}" 2>/dev/null || xterm -e "${scriptPath}" 2>/dev/null || gnome-terminal -- "${scriptPath}"`
  exec(cmd, { windowsHide: false, detached: true })

  send('launch-log', '[*] Waiting for Gradio server...\n')
  try {
    await waitForPort('localhost', port, 180000)
    send('launch-log', '[*] Wan2GP is ready!\n')
    // Monitor process — report when it stops (terminal closed / crash)
    let monitorInterval = setInterval(() => {
      const sock = new net.Socket()
      sock.setTimeout(2000)
      sock.on('connect', () => { sock.destroy() })
      sock.on('error', () => {
        sock.destroy()
        clearInterval(monitorInterval)
        send('launch-log', '[!] Wan2GP process closed (terminal window or server stopped).\n')
        send('wangp-exit', -1)
      })
      sock.on('timeout', () => { sock.destroy() })
      sock.connect(port, 'localhost')
    }, 8000)
    return { url: `http://localhost:${port}`, port }
  } catch (err) {
    throw err
  }
})

ipcMain.handle('update', async () => await runSetup(['update']))

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

ipcMain.handle('open-external', (_, url) => {
  if (typeof url !== 'string' || !url.startsWith('http')) return
  try { new URL(url) } catch { return }
  shell.openExternal(url)
})

ipcMain.handle('open-task-manager', () => {
  try { require('child_process').exec('taskmgr.exe') } catch {}
})

// ── Desktop config ──
ipcMain.handle('check-command', (_, cmd) => {
  if (!cmd) return false
  try {
    const out = execSync(IS_WIN ? `where ${cmd}` : `which ${cmd}`, { encoding: 'utf8', timeout: 5000, windowsHide: true })
    return out.trim().length > 0
  } catch { return false }
})

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
  try {
    const ed = path.join(dir, '.electron')
    fs.mkdirSync(ed, { recursive: true })
    app.setPath('userData', ed)
  } catch {}
  return true
})
ipcMain.handle('open-folder', (_, dir) => {
  try { shell.openPath(dir) } catch {}
})
ipcMain.handle('reset-data-dir', () => {
  try {
    if (fs.existsSync(DATA_DIR_OVERRIDE)) fs.rmSync(DATA_DIR_OVERRIDE, { force: true })
    const d = path.join(app.getPath('userData'), 'Wan2GP')
    fs.mkdirSync(d, { recursive: true })
    app.setPath('userData', path.join(d, '.electron'))
  } catch {}
  return true
})

// ── Install a prerequisite tool (Git, Python, uv, Miniconda) ──
ipcMain.handle('install-prerequisite', async (_, tool) => {
  const tmpDir = require('os').tmpdir()
  const sendLog = (msg) => send('launch-log', msg + '\n')

  if (tool === 'git') {
    sendLog('[*] Downloading Git for Windows...')
    const url = 'https://github.com/git-for-windows/git/releases/download/v2.49.0.windows.1/Git-2.49.0-64-bit.exe'
    const dest = path.join(tmpDir, 'Git-2.49.0-64-bit.exe')
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest)
      https.get(url, (res) => { res.pipe(file); file.on('finish', () => { file.close(); resolve() }) })
        .on('error', (e) => { try { fs.rmSync(dest) } catch {}; reject(e) })
    })
    sendLog('[*] Installing Git (silent)...')
    execSync(`"${dest}" /VERYSILENT /NORESTART /SUPPRESSMSGBOXES /CLOSEAPPLICATIONS`, { timeout: 120000, windowsHide: true })
    sendLog('[*] Git installed. Please restart the launcher.')
    return { success: true }

  } else if (tool === 'python') {
    sendLog('[*] Downloading Python 3.11...')
    const url = 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe'
    const dest = path.join(tmpDir, 'python-3.11.9-amd64.exe')
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest)
      https.get(url, (res) => { res.pipe(file); file.on('finish', () => { file.close(); resolve() }) })
        .on('error', (e) => { try { fs.rmSync(dest) } catch {}; reject(e) })
    })
    sendLog('[*] Installing Python 3.11.9 (silent)...')
    execSync(`"${dest}" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0`, { timeout: 180000, windowsHide: true })
    sendLog('[*] Python installed. Please restart the launcher.')
    return { success: true }

  } else if (tool === 'uv') {
    sendLog('[*] Installing uv via PowerShell...')
    execSync('powershell -NoProfile -Command "& { iwr -useb https://astral.sh/uv/install.ps1 | iex }"', { timeout: 60000, windowsHide: true })
    sendLog('[*] uv installed. Please restart the launcher.')
    return { success: true }

  } else if (tool === 'conda') {
    sendLog('[*] Downloading Miniconda...')
    const url = 'https://repo.anaconda.com/miniconda/Miniconda3-latest-Windows-x86_64.exe'
    const dest = path.join(tmpDir, 'Miniconda3-latest-Windows-x86_64.exe')
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest)
      https.get(url, (res) => { res.pipe(file); file.on('finish', () => { file.close(); resolve() }) })
        .on('error', (e) => { try { fs.rmSync(dest) } catch {}; reject(e) })
    })
    sendLog('[*] Installing Miniconda (silent)...')
    execSync(`"${dest}" /InstallationType=JustMe /RegisterPython=0 /S /D=%USERPROFILE%\\Miniconda3`, { timeout: 180000, windowsHide: true })
    sendLog('[*] Miniconda installed. Please restart the launcher.')
    return { success: true }
  }
  return { error: 'Unknown tool: ' + tool }
})

// ── Hardware-tuned default settings for wgp_config.json ──
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

ipcMain.handle('write-wgp-config', (_, { checkpointsPaths, lorasRoot, savePath }) => {
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
  if (savePath) {
    cfg.save_path = savePath
    cfg.image_save_path = savePath
    cfg.audio_save_path = savePath
  }
  // Hardware-tuned defaults — only fill missing
  // Attention defaults to AUTO (gradio UI can override)
  if (cfg.attention_mode === undefined) cfg.attention_mode = 'auto'
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


// ── Create Desktop Shortcut for Wan2GP (standalone launch without desktop app) ──
ipcMain.handle('create-desktop-shortcut', () => {
  try {
    const env = getActiveEnv()
    if (!env) return { error: 'No active environment' }
    const py = getPythonForEnv(env)
    if (!py) return { error: 'Cannot find Python for active env' }
    const repo = getRepoDir()
    if (!repo || !fs.existsSync(path.join(repo, 'wgp.py'))) return { error: 'Wan2GP repo not found' }
    const desktop = app.getPath('desktop')
    if (!desktop) return { error: 'Cannot find desktop path' }

    const cfg = loadConfig()
    const port = cfg.serverPort || 7860
    const extraArgs = (cfg.launchArgs || '').trim()

    // Build activation command based on env type
    let activate = ''
    const envPath = path.isAbsolute(env.path) ? env.path : path.join(getRepoDir(), env.path)
    if (env.type === 'venv' || env.type === 'uv') {
      const activateScript = IS_WIN
        ? path.join(envPath, 'Scripts', 'activate')
        : path.join(envPath, 'bin', 'activate')
      if (fs.existsSync(activateScript)) {
        activate = IS_WIN
          ? 'call "' + activateScript + '"'
          : 'source "' + activateScript + '"'
      }
    } else if (env.type === 'conda') {
      activate = 'call conda activate "' + envPath + '"'
    }

    let batContent = '@echo off\n'
    batContent += 'title Wan2GP\n'
    batContent += 'cd /d "' + repo + '"\n'
    batContent += 'echo.\n'
    batContent += 'echo [Wan2GP Desktop Launcher]\n'
    batContent += 'echo Starting Wan2GP on port ' + port + '...\n'
    batContent += 'echo.\n'
    if (activate) {
      batContent += 'echo Activating environment: ' + env.name + ' (' + env.type + ')\n'
      batContent += activate + '\n'
      if (IS_WIN && (env.type === 'venv' || env.type === 'uv')) {
        batContent += 'set PATH=' + path.join(envPath, 'Scripts') + ';%PATH%\n'
      }
    }
    batContent += 'echo.\n'
    batContent += 'echo Starting wgp.py in background...\n'
    // Run wgp.py in background so we can monitor + open browser when ready
    batContent += 'start /b "" cmd /c "python -u wgp.py --server-port ' + port + (extraArgs ? ' ' + extraArgs : '') + '" 2>&1\n'
    batContent += 'echo.\n'
    batContent += 'echo Waiting for Wan2GP server on port ' + port + '...\n'
    // Poll via HTTP (wait for real Gradio response, not just TCP socket)
    batContent += ':waitloop\n'
    batContent += 'timeout /t 2 /nobreak >nul\n'
    batContent += 'powershell -Command "try{$(Invoke-WebRequest -Uri http://localhost:' + port + '/config -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200;exit 0}catch{exit 1}" >nul 2>&1 && goto ready\n'
    batContent += 'goto waitloop\n'
    batContent += ':ready\n'
    batContent += 'echo Wan2GP is ready! Opening browser...\n'
    batContent += 'start http://localhost:' + port + '\n'
    batContent += 'echo.\n'
    batContent += 'echo [Wan2GP] Server is running. Close this window to stop it.\n'
    batContent += 'pause >nul\n'

    const batPath = path.join(desktop, 'Launch Wan2GP.bat')
    fs.writeFileSync(batPath, batContent, 'utf8')
    return { success: true, path: batPath }
  } catch (e) { return { error: e.message } }
})

// ── Disk space ──
ipcMain.handle('get-disk-space', () => {
  try {
    const p = getDataDir()
    if (!p) return null
    const root = path.parse(p).root || p.substring(0, 2)
    if (typeof fs.statfs === 'function') {
      const s = fs.statfsSync(root)
      return { free: s.bsize * s.bfree, total: s.bsize * s.blocks }
    }
    const { execSync } = require('child_process')
    const out = execSync('wmic logicaldisk where caption="' + root.charAt(0) + ':" get freespace,size /format:csv', { timeout: 5000, encoding: 'utf8' })
    const parts = out.trim().split(/\\r?\\n/)
    if (parts.length >= 2) {
      const cols = parts[1].split(',')
      if (cols.length >= 3) {
        return { free: parseInt(cols[1]) || 0, total: parseInt(cols[2]) || 0 }
      }
    }
  } catch {}
  return null
})


// ── Wan2GP upstream version ──
ipcMain.handle('get-wangp-local-version', () => getLocalWangpHead())

ipcMain.handle('get-wangp-upstream-info', async () => {
  try {
    const data = await fetchUrl(`https://api.github.com/repos/${WAN2GP_UPSTREAM}/commits?per_page=10&sha=main`, {
      headers: { 'User-Agent': 'wan2gp-desktop', 'Accept': 'application/vnd.github.v3+json' }
    })
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

ipcMain.handle('get-desktop-version', () => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'))
    return pkg.version || null
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

// ── Check PyPI for latest package versions ──
const _pypiCache = {}
const PACKAGES_TO_CHECK = ['torch','triton','sageattention','spas_sage_attn','flash_attn','diffusers','transformers','gradio','accelerate','onnxruntime','xformers','nunchaku','gguf','mmgp','moviepy','opencv-python','insightface','peft','timm','vector_quantize_pytorch','torchcodec','torchaudio','huggingface_hub','lightx2v']

ipcMain.handle('check-package-updates', async (_, installedVersions) => {
  const results = []
  if (!installedVersions || typeof installedVersions !== 'object') return results
  const names = Object.keys(installedVersions).filter(n => n !== 'python' && n !== 'error')
  const fetchOne = async (name) => {
    try {
      if (_pypiCache[name] && Date.now() - _pypiCache[name].ts < 300000) {
        return { name, latest: _pypiCache[name].latest, installed: installedVersions[name] }
      }
      const pypiName = ({sageattention:'sageattention',spas_sage_attn:'spas-sage-attn',opencv:'opencv-python',hfhub:'huggingface-hub',onnxruntime:'onnxruntime',nunchaku:'nunchaku',gguf:'gguf',mmgp:'mmgp',moviepy:'moviepy',insightface:'insightface',peft:'peft',timm:'timm',vector_quantize_pytorch:'vector-quantize-pytorch',torchcodec:'torchcodec',torchaudio:'torchaudio',lightx2v:'lightx2v',xformers:'xformers'})[name] || name
      const data = await fetchUrl(`https://pypi.org/pypi/${pypiName}/json`, { timeout: 8000 })
      const latest = (data && data.info && data.info.version) || null
      if (latest) _pypiCache[name] = { latest, ts: Date.now() }
      return { name, installed: installedVersions[name], latest }
    } catch { return { name, installed: installedVersions[name], latest: null } }
  }
  const settled = await Promise.allSettled(names.map(fetchOne))
  for (const s of settled) { if (s.status === 'fulfilled' && s.value) results.push(s.value) }
  return results
})

// ── Upgrade a single package in the active env ──
ipcMain.handle('upgrade-package', async (_, pkgName) => {
  try {
    const env = getActiveEnv()
    if (!env) return { error: 'No active environment' }
    const py = getPythonForEnv(env)
    if (!py) return { error: 'Cannot find Python' }
    send('launch-log', '[*] Upgrading ' + pkgName + '...\n')
    const { spawn } = require('child_process')
    await new Promise((resolve, reject) => {
      const proc = spawn(py, ['-m', 'pip', 'install', '--upgrade', pkgName], {
        cwd: getRepoDir(), timeout: 120000, windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      })
      proc.stdout.on('data', (d) => { const s = d.toString(); if (s) send('launch-log', s) })
      proc.stderr.on('data', (d) => { const s = d.toString(); if (s) send('launch-log', s) })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error('pip exited code ' + code))
      })
      proc.on('error', reject)
    })
    send('launch-log', '[*] ' + pkgName + ' upgraded successfully.\n')
    delete _pypiCache[pkgName]
    return { success: true }
  } catch (e) { return { error: e.message } }
})

// ── Install a single package (e.g. triton, flash_attn) into active env ──
ipcMain.handle('install-package', async (_, pkgName) => {
  try {
    const env = getActiveEnv()
    if (!env) return { error: 'No active environment' }
    const py = getPythonForEnv(env)
    if (!py) return { error: 'Cannot find Python' }
    send('launch-log', '[*] Installing ' + pkgName + '...\n')
    const { spawn } = require('child_process')
    await new Promise((resolve, reject) => {
      const proc = spawn(py, ['-m', 'pip', 'install', pkgName], {
        cwd: getRepoDir(), timeout: 300000, windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      })
      proc.stdout.on('data', (d) => { const s = d.toString(); if (s) send('launch-log', s) })
      proc.stderr.on('data', (d) => { const s = d.toString(); if (s) send('launch-log', s) })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error('pip exited code ' + code))
      })
      proc.on('error', reject)
    })
    send('launch-log', '[*] ' + pkgName + ' installed successfully.\n')
    return { success: true }
  } catch (e) { return { error: e.message } }
})

// ── Restore all packages from requirements.txt ──
ipcMain.handle('restore-requirements', async () => {
  try {
    const env = getActiveEnv()
    if (!env) return { error: 'No active environment' }
    const py = getPythonForEnv(env)
    if (!py) return { error: 'Cannot find Python' }
    const reqPath = path.join(getRepoDir(), 'requirements.txt')
    if (!fs.existsSync(reqPath)) return { error: 'requirements.txt not found' }
    send('launch-log', '[*] Restoring packages from requirements.txt...\n')
    const { spawn } = require('child_process')
    await new Promise((resolve, reject) => {
      const proc = spawn(py, ['-m', 'pip', 'install', '-r', reqPath], {
        cwd: getRepoDir(), timeout: 300000, windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      })
      proc.stdout.on('data', (d) => { const s = d.toString(); if (s) send('launch-log', s) })
      proc.stderr.on('data', (d) => { const s = d.toString(); if (s) send('launch-log', s) })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error('pip exited code ' + code))
      })
      proc.on('error', reject)
    })
    send('launch-log', '[*] Requirements restored successfully.\n')
    return { success: true }
  } catch (e) { return { error: e.message } }
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
        const lines = nvOut.trim().split('\n').map(l => l.trim()).filter(l => l)
        const gpuNames = [], vramVals = []
        for (const line of lines) {
          const [name, mem] = line.split(', ')
          if (name) gpuNames.push(name.trim())
          if (mem) {
            const mb = parseFloat(mem)
            vramVals.push(mb >= 1024 ? Math.round(mb / 1024) + ' GB' : Math.round(mb) + ' MB')
          }
        }
        if (gpuNames.length) info.gpu = gpuNames.join(' + ')
        if (vramVals.length) info.vram = vramVals.join(' + ')
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

// ── Hardware profile: maps detected GPU → expected install packages ──
ipcMain.handle('get-hardware-profile', () => {
  const profiles = {
    GTX_10:  { python: '3.10.9', torch: '2.7.1 CU12.8', triton: null, sage: null, sparge: null, flash: null, kernels: [] },
    RTX_20:  { python: '3.11.14', torch: '2.10.0 CU13',  triton: 'latest', sage: '1.0.6', sparge: null, flash: '2.8.3', kernels: ['nunchaku','gguf'] },
    RTX_30:  { python: '3.11.14', torch: '2.10.0 CU13',  triton: 'latest', sage: '2.2.0', sparge: '0.1.0', flash: '2.8.3', kernels: ['nunchaku','gguf'] },
    RTX_40:  { python: '3.11.14', torch: '2.10.0 CU13',  triton: 'latest', sage: '2.2.0', sparge: '0.1.0', flash: '2.8.3', kernels: ['nunchaku','gguf'] },
    RTX_50:  { python: '3.11.14', torch: '2.10.0 CU13',  triton: 'latest', sage: '2.2.0', sparge: '0.1.0', flash: '2.8.3', kernels: ['nunchaku','lightx2v','gguf'] },
    MPS:     { python: '3.11.14', torch: 'MPS',          triton: null, sage: null, sparge: null, flash: null, kernels: [] },
    AMD:     { python: '3.11.14', torch: 'ROCm 6.5',     triton: null, sage: null, sparge: null, flash: null, kernels: [] },
  }
  const result = { profile: 'STANDARD', packages: [] }
  try {
    const out = execSync('nvidia-smi --query-gpu=name --format=csv,noheader', { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim().split('\n')[0].trim().toUpperCase()
    if (out.includes('RTX')) {
      if (/50\d0/.test(out)) result.profile = 'RTX_50'
      else if (/40\d0/.test(out)) result.profile = 'RTX_40'
      else if (/30\d0/.test(out)) result.profile = 'RTX_30'
      else if (/20\d0/.test(out)) result.profile = 'RTX_20'
    } else if (out.includes('GTX') || /10\d0/.test(out)) {
      result.profile = 'GTX_10'
    }
  } catch {
    // Fallback MPS/AMD — keep STANDARD
  }
  if (profiles[result.profile]) {
    const p = profiles[result.profile]
    if (p.python) result.packages.push('🐍 Python ' + p.python)
    if (p.torch) result.packages.push('🔥 PyTorch ' + p.torch)
    if (p.triton) result.packages.push('⚡ Triton (' + p.triton + ')')
    if (p.sage) result.packages.push('🌀 Sage Attn ' + p.sage)
    if (p.sparge) result.packages.push('🌊 Sparge Attn ' + p.sparge)
    if (p.flash) result.packages.push('💥 Flash Attn ' + p.flash)
    for (const k of p.kernels) {
      const labels = { nunchaku: '🔩 Nunchaku INT4/FP4', lightx2v: '⚡ Lightx2v NVFP4', gguf: '📦 GGUF llama.cpp' }
      result.packages.push(labels[k] || k)
    }
    // All profiles get requirements.txt
    result.packages.push('📋 50+ reqs (diffusers, gradio, opencv, moviepy…)')
  }
  return result
})

// ── Live system metrics (free RAM / free VRAM) ──
ipcMain.handle('get-system-metrics', () => {
  const result = { ramFree: null, vramFree: null }
  try {
    if (IS_WIN) {
      const out = execSync('wmic OS get FreePhysicalMemory /format:csv', { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim()
      const lines = out.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('Node'))
      if (lines.length) {
        const kb = parseInt(lines[lines.length - 1].split(',')[1] || lines[lines.length - 1])
        if (!isNaN(kb)) result.ramFree = Math.round(kb / 1024) + ' GB'
      }
    }
  } catch {}
  try {
    const nvOut = execSync('nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits', { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim()
    const vals = nvOut.split('\n').map(l => parseInt(l.trim())).filter(v => !isNaN(v))
    if (vals.length) {
      const total = vals.reduce((a, b) => a + b, 0)
      result.vramFree = total >= 1024 ? Math.round(total / 1024) + ' GB' : total + ' MB'
    }
  } catch {}
  return result
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
    title: 'Wan2GP Desktop Launcher',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
    show: true, backgroundColor: '#0f0f0f', maximizable: true,
  })
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  mainWin.once('ready-to-show', () => { mainWin.maximize() })
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
app.on('window-all-closed', () => {
  if (setupProc) setupProc.kill()
  if (PLATFORM !== 'darwin') app.quit()
})
app.on('activate', () => { if (!mainWin) createWindow() })
app.on('before-quit', () => {
  if (setupProc) setupProc.kill()
})
