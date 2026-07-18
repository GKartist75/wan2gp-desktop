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
  launch: (mode) => ipcRenderer.invoke('launch', mode),
  launchWebview: () => ipcRenderer.invoke('launch-webview'),
  stopWangp: () => ipcRenderer.invoke('stop-wangp'),
  isWangpRunning: () => ipcRenderer.invoke('is-wangp-running'),
  popoutWebview: (url) => ipcRenderer.invoke('popout-webview', url),
  onWebviewReturned: (cb) => { const h = (_e) => cb(); ipcRenderer.on('webview-returned', h); return () => ipcRenderer.removeListener('webview-returned', h) },

  // BrowserView (in-app Wan2GP embed — renders reliably on Electron 40; intercepts /manifest.json)
  createBrowserView: (url) => ipcRenderer.invoke('create-browser-view', url),
  showBrowserView: () => ipcRenderer.invoke('show-browser-view'),
  hideBrowserView: () => ipcRenderer.invoke('hide-browser-view'),
  destroyBrowserView: () => ipcRenderer.invoke('destroy-browser-view'),
  detachBrowserView: () => ipcRenderer.invoke('detach-browser-view'),
  reattachBrowserView: () => ipcRenderer.invoke('reattach-browser-view'),
  bvNavigate: (action) => ipcRenderer.invoke('bv-navigate', action),
  bvSetZoom: (factor) => ipcRenderer.invoke('bv-set-zoom', factor),
  bvSetDock: (dock) => ipcRenderer.invoke('bv-set-dock', dock),

  // Floating-terminal overlay (BrowserView above Wan2GP, used for the 'floating' dock)
  createTermView: () => ipcRenderer.invoke('create-term-view'),
  destroyTermView: () => ipcRenderer.invoke('destroy-term-view'),
  onTermDockChanged: (cb) => {
    const h = (_e, dock) => cb(dock)
    ipcRenderer.on('term-dock-changed', h)
    return () => ipcRenderer.removeListener('term-dock-changed', h)
  },
  onTermClosed: (cb) => {
    const h = () => cb()
    ipcRenderer.on('term-closed', h)
    return () => ipcRenderer.removeListener('term-closed', h)
  },

  // Manage
  update: () => ipcRenderer.invoke('update'),
  manageList: () => ipcRenderer.invoke('manage-list'),
  manageActive: () => ipcRenderer.invoke('manage-active'),
  manageSetActive: (name) => ipcRenderer.invoke('manage-set-active', name),
  manageDelete: (name) => ipcRenderer.invoke('manage-delete', name),
  uninstallEnv: (name) => ipcRenderer.invoke('uninstall-env', name),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openTaskManager: () => ipcRenderer.invoke('open-task-manager'),
  toggleDevTools: () => ipcRenderer.invoke('toggle-devtools'),
  detectBrowsers: () => ipcRenderer.invoke('detect-browsers'),
  launchBrowser: (url) => ipcRenderer.invoke('launch-browser', url),
  launchBrowserNoGpu: (url) => ipcRenderer.invoke('launch-browser-no-gpu', url),
  chromeAvailable: () => ipcRenderer.invoke('chrome-available'),

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
  getDiskSpace: () => ipcRenderer.invoke('get-disk-space'),
  openFolder: (p) => ipcRenderer.invoke('open-folder', p),
  getDataDir: () => ipcRenderer.invoke('get-data-dir'),
  setDataDir: (dir) => ipcRenderer.invoke('set-data-dir', dir),
  resetDataDir: () => ipcRenderer.invoke('reset-data-dir'),
  writeWgpConfig: (cfg) => ipcRenderer.invoke('write-wgp-config', cfg),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  checkCommand: (cmd) => ipcRenderer.invoke('check-command', cmd),
  installPrerequisite: (tool) => ipcRenderer.invoke('install-prerequisite', tool),
  detectModelFolders: () => ipcRenderer.invoke('detect-model-folders'),
  getModelPaths: () => ipcRenderer.invoke('get-model-paths'),

  // Config
  configLoad: () => ipcRenderer.invoke('config-load'),
  configSave: (cfg) => ipcRenderer.invoke('config-save', cfg),

  // Auto-Tune
  autoTuneDetect: () => ipcRenderer.invoke('auto-tune:detect'),
  autoTuneRecommend: (hw) => ipcRenderer.invoke('auto-tune:recommend', hw),
  autoTuneApply: (settings) => ipcRenderer.invoke('auto-tune:apply', settings),
  autoTuneFullTune: () => ipcRenderer.invoke('auto-tune:full-tune'),

  // Hardware
  detectHardware: () => ipcRenderer.invoke('detect-hardware'),
  getHardwareProfile: () => ipcRenderer.invoke('get-hardware-profile'),
  getSystemMetrics: () => ipcRenderer.invoke('get-system-metrics'),

  // Wan2GP upstream
  getWangpLocalVersion: () => ipcRenderer.invoke('get-wangp-local-version'),
  getWangpUpstreamInfo: () => ipcRenderer.invoke('get-wangp-upstream-info'),
  getDesktopGitInfo: () => ipcRenderer.invoke('get-desktop-git-info'),
  getDesktopVersion: () => ipcRenderer.invoke('get-desktop-version'),
  getWangpVersion: () => ipcRenderer.invoke('get-wangp-version'),

  // Desktop shortcut
  createDesktopShortcut: () => ipcRenderer.invoke('create-desktop-shortcut'),

  // Package updates
  checkPackageUpdates: (versions) => ipcRenderer.invoke('check-package-updates', versions),
  upgradePackage: (pkgName) => ipcRenderer.invoke('upgrade-package', pkgName),
  installPackage: (pkgName) => ipcRenderer.invoke('install-package', pkgName),
  restoreRequirements: () => ipcRenderer.invoke('restore-requirements'),

  // Desktop experience: tray, auto-start, notifications, theme
  setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),
  setThemeFollowSystem: (enabled) => ipcRenderer.invoke('set-theme-follow-system', enabled),
  setNotificationsEnabled: (enabled) => ipcRenderer.invoke('set-notifications-enabled', enabled),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  onSystemThemeChange: (cb) => {
    const h = (_e, theme) => cb(theme)
    ipcRenderer.on('system-theme-changed', h)
    return () => ipcRenderer.removeListener('system-theme-changed', h)
  },
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
