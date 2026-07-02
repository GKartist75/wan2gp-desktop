const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('w2gp', {
  // Install
  checkInstalled: () => ipcRenderer.invoke('check-installed'),
  detectGpu: () => ipcRenderer.invoke('detect-gpu'),
  install: (envType) => ipcRenderer.invoke('install', envType),

  // Status
  getStatus: () => ipcRenderer.invoke('get-status'),

  // Run
  launch: () => ipcRenderer.invoke('launch'),
  stop: () => ipcRenderer.invoke('stop'),

  // Manage
  update: () => ipcRenderer.invoke('update'),
  upgrade: () => ipcRenderer.invoke('upgrade'),
  manageList: () => ipcRenderer.invoke('manage-list'),
  manageSetActive: (name) => ipcRenderer.invoke('manage-set-active', name),
  manageDelete: (name) => ipcRenderer.invoke('manage-delete', name),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openInBrowser: (url, browserPath) => ipcRenderer.invoke('open-in-browser', { url, browserPath }),

  // Update (desktop app itself)
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (cb) => {
    const h = (_e, d) => cb(d)
    ipcRenderer.on('update-status', h)
    return () => ipcRenderer.removeListener('update-status', h)
  },

  // Config
  configLoad: () => ipcRenderer.invoke('config-load'),
  configSave: (cfg) => ipcRenderer.invoke('config-save', cfg),

  // Browser
  detectBrowsers: () => ipcRenderer.invoke('detect-browsers'),

  // Hardware
  detectHardware: () => ipcRenderer.invoke('detect-hardware'),

  // Events
  onSetupOutput: (cb) => {
    const h = (_e, d) => cb(d)
    ipcRenderer.on('setup-output', h)
    return () => ipcRenderer.removeListener('setup-output', h)
  },
  onSetupPhase: (cb) => {
    const h = (_e, d) => cb(d)
    ipcRenderer.on('setup-phase', h)
    return () => ipcRenderer.removeListener('setup-phase', h)
  },
  onSetupProfile: (cb) => {
    const h = (_e, profile) => cb(profile)
    ipcRenderer.on('setup-profile', h)
    return () => ipcRenderer.removeListener('setup-profile', h)
  },
  onLaunchLog: (cb) => {
    const h = (_e, d) => cb(d)
    ipcRenderer.on('launch-log', h)
    return () => ipcRenderer.removeListener('launch-log', h)
  },
  onWangpExit: (cb) => {
    const h = (_e, d) => cb(d)
    ipcRenderer.on('wangp-exit', h)
    return () => ipcRenderer.removeListener('wangp-exit', h)
  },
})
