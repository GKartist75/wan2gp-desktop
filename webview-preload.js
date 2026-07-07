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

// Upload file to Gradio /upload endpoint, returns [{name, size, ...}]
window.__uploadToGradio = (filePath) => {
  return ipcRenderer.invoke('upload-to-gradio', filePath)
}

// Read metadata from file (via Wan2GP's Python) AND upload settings JSON to Gradio
// Returns { meta: {...}, gradioFile: [...], error: '...' }
window.__readSettingsAndUpload = (filePath) => {
  return ipcRenderer.invoke('read-settings-and-upload', filePath)
}

// Send file path to main process for full Gradio API upload + predict
// Returns { success, fn_index, result } or { error }
window.__sendToWangp = (filePath) => {
  return ipcRenderer.invoke('send-to-wangp', filePath)
}
