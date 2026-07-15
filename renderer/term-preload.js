const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('w2gp', {
  onLaunchLog: (cb) => {
    const h = (_e, t) => cb(t)
    ipcRenderer.on('launch-log', h)
    return () => ipcRenderer.removeListener('launch-log', h)
  },
  onSetupOutput: (cb) => {
    const h = (_e, t) => cb(t)
    ipcRenderer.on('setup-output', h)
    return () => ipcRenderer.removeListener('setup-output', h)
  },
  onWangpExit: (cb) => {
    const h = (_e, c) => cb(c)
    ipcRenderer.on('wangp-exit', h)
    return () => ipcRenderer.removeListener('wangp-exit', h)
  },
  getLogHistory: () => ipcRenderer.invoke('get-log-history'),
  setDock: (dock) => ipcRenderer.invoke('term-set-dock', dock),
  closeTerm: () => ipcRenderer.invoke('term-close'),
  exportLogs: (text) => ipcRenderer.invoke('term-export', text),
})
