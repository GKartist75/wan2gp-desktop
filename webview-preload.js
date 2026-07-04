// Webview preload — exposes file-reading to the webview's JS context
// so drag-drop from the sidebar can load files into Gradio's File component
const { ipcRenderer } = require('electron')

// Returns { data: base64, name, size } or null
window.__readLocalFile = (filePath) => {
  return ipcRenderer.invoke('read-local-file', filePath)
}

// Get drag path set by sidebar (IPC bridges webview <-> renderer)
window.__getPendingDragPath = () => {
  return ipcRenderer.invoke('get-pending-drag-path')
}
