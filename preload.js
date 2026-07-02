const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('w2gp', {
  // Install
  checkInstalled: () => ipcRenderer.invoke('check-installed'),
  detectGpu: () => ipcRenderer.invoke('detect-gpu'),
  install: () => ipcRenderer.invoke('install'),

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

  // Update (desktop app itself)
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (cb) => {
    const h = (_e, d) => cb(d)
    ipcRenderer.on('update-status', h)
    return () => ipcRenderer.removeListener('update-status', h)
  },

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
  detectHardware: () => ipcRenderer.invoke('detect-hardware'),
})
