const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('termAPI', {
  onLog: (ch, cb) => {
    const h = (_e, data) => cb(typeof data === 'string' ? data : '')
    ipcRenderer.on(ch, h)
    return () => ipcRenderer.removeListener(ch, h)
  },
  getInitBuffer: () => ipcRenderer.invoke('get-term-buffer'),
  dock: (pos) => ipcRenderer.invoke('dock-terminal', pos),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-term-always-on-top'),
  close: () => ipcRenderer.invoke('close-terminal-window'),
})
