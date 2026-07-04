const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('w2gp', {
  // Install
  checkInstalled: () => ipcRenderer.invoke('check-installed'),
  detectGpu: () => ipcRenderer.invoke('detect-gpu'),
  install: (envType) => ipcRenderer.invoke('install', envType),
  reinstall: () => ipcRenderer.invoke('reinstall'),

  // Status
  getStatus: () => ipcRenderer.invoke('get-status'),

  // Run
  launch: () => ipcRenderer.invoke('launch'),
  isRunning: () => ipcRenderer.invoke('is-running'),
  stop: () => ipcRenderer.invoke('stop'),

  // Manage
  update: () => ipcRenderer.invoke('update'),
  upgrade: () => ipcRenderer.invoke('upgrade'),
  manageList: () => ipcRenderer.invoke('manage-list'),
  manageActive: () => ipcRenderer.invoke('manage-active'),
  manageSetActive: (name) => ipcRenderer.invoke('manage-set-active', name),
  manageDelete: (name) => ipcRenderer.invoke('manage-delete', name),
  uninstallEnv: (name) => ipcRenderer.invoke('uninstall-env', name),
  uninstallWangp: () => ipcRenderer.invoke('uninstall-wangp'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openInBrowser: (url, browserPath) => ipcRenderer.invoke('open-in-browser', { url, browserPath }),

  // Update (desktop app itself)
  checkUpdate: (opts) => ipcRenderer.invoke('check-update', opts),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (cb) => {
    const h = (_e, d) => cb(d)
    ipcRenderer.on('update-status', h)
    return () => ipcRenderer.removeListener('update-status', h)
  },

  // Paths
  getInstallPaths: () => ipcRenderer.invoke('get-install-paths'),
  getDataDir: () => ipcRenderer.invoke('get-data-dir'),
  setDataDir: (dir) => ipcRenderer.invoke('set-data-dir', dir),
  writeWgpConfig: (cfg) => ipcRenderer.invoke('write-wgp-config', cfg),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  detectModelFolders: () => ipcRenderer.invoke('detect-model-folders'),
  getModelPaths: () => ipcRenderer.invoke('get-model-paths'),

  // File system
  readLocalFile: (filePath) => ipcRenderer.invoke('read-local-file', filePath),

  // Output folder
  listOutputFiles: (subdir) => ipcRenderer.invoke('list-output-files', subdir),
  setOutputPath: () => ipcRenderer.invoke('set-output-path'),
  readFileMetadata: (filePath) => ipcRenderer.invoke('read-file-metadata', filePath),
  readFileMetadataPython: (filePath) => ipcRenderer.invoke('read-file-metadata-python', filePath),
  uploadToGradio: (filePath) => ipcRenderer.invoke('upload-to-gradio', filePath),
  deleteFiles: (filePaths) => ipcRenderer.invoke('delete-files', filePaths),
  copyFilesToOutput: (filePaths) => ipcRenderer.invoke('copy-files-to-output', filePaths),

  // Config
  configLoad: () => ipcRenderer.invoke('config-load'),
  configSave: (cfg) => ipcRenderer.invoke('config-save', cfg),

  // Browser
  detectBrowsers: () => ipcRenderer.invoke('detect-browsers'),

  // Hardware
  detectHardware: () => ipcRenderer.invoke('detect-hardware'),

  // Wan2GP upstream
  getWangpLocalVersion: () => ipcRenderer.invoke('get-wangp-local-version'),
  getWangpUpstreamInfo: () => ipcRenderer.invoke('get-wangp-upstream-info'),
  getWangpChangelog: () => ipcRenderer.invoke('get-wangp-changelog'),
  getDesktopGitInfo: () => ipcRenderer.invoke('get-desktop-git-info'),
  onOutputFilesChanged: (cb) => {
    const h = (_e) => cb()
    ipcRenderer.on('output-files-changed', h)
    return () => ipcRenderer.removeListener('output-files-changed', h)
  },
  setPendingDragPath: (p) => ipcRenderer.invoke('set-pending-drag-path', p),
  getWangpVersion: () => ipcRenderer.invoke('get-wangp-version'),

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
  setViewerActive: (active) => ipcRenderer.invoke('set-viewer-active', active),
  onWangpRestarting: (cb) => {
    const h = (_e, d) => cb(d)
    ipcRenderer.on('wangp-restarting', h)
    return () => ipcRenderer.removeListener('wangp-restarting', h)
  },
  onWangpRestarted: (cb) => {
    const h = (_e, d) => cb(d)
    ipcRenderer.on('wangp-restarted', h)
    return () => ipcRenderer.removeListener('wangp-restarted', h)
  },
  onWangpRestartFailed: (cb) => {
    const h = (_e, d) => cb(d)
    ipcRenderer.on('wangp-restart-failed', h)
    return () => ipcRenderer.removeListener('wangp-restart-failed', h)
  },
})
