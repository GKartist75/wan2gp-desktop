const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('w2gp', {
  onLaunchLog: (cb) => {
    const h = (_e, t) => cb(t)
    ipcRenderer.on('launch-log', h)
    return () => ipcRenderer.removeListener('launch-log', h)
  },
  onWangpExit: (cb) => {
    const h = (_e, c) => cb(c)
    ipcRenderer.on('wangp-exit', h)
    return () => ipcRenderer.removeListener('wangp-exit', h)
  },
  setDock: (dock) => ipcRenderer.invoke('term-set-dock', dock),
  closeTerm: () => ipcRenderer.invoke('term-close'),
  exportLogs: (text) => ipcRenderer.invoke('term-export', text),
})
