"use strict";

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('w2gp', {
  // Platform (used by the renderer to gate Windows-only UI)
  platform: process.platform,
  // Install
  checkInstalled: () => ipcRenderer.invoke('check-installed'),
  detectGpu: () => ipcRenderer.invoke('detect-gpu'),
  detectGpus: () => ipcRenderer.invoke('detect-gpus'),
  install: (envType) => ipcRenderer.invoke('install', envType),
  reinstall: () => ipcRenderer.invoke('reinstall'),
  uninstall: () => ipcRenderer.invoke('uninstall'),

  // Status
  getStatus: () => ipcRenderer.invoke('get-status'),
  syncKernels: () => ipcRenderer.invoke('sync-kernels'),

  // Run
  launch: (mode) => ipcRenderer.invoke('launch', mode),
  launchWebview: () => ipcRenderer.invoke('launch-webview'),
  stopWangp: () => ipcRenderer.invoke('stop-wangp'),
  popoutWebview: (url) => ipcRenderer.invoke('popout-webview', url),

  // BrowserView (in-app Wan2GP embed — renders reliably on Electron 40; intercepts /manifest.json)
  createBrowserView: (url, opts) => ipcRenderer.invoke('create-browser-view', url, opts),
  hideBrowserView: () => ipcRenderer.invoke('hide-browser-view'),
  destroyBrowserView: () => ipcRenderer.invoke('destroy-browser-view'),
  detachBrowserView: () => ipcRenderer.invoke('detach-browser-view'),
  reattachBrowserView: () => ipcRenderer.invoke('reattach-browser-view'),
  bvNavigate: (action) => ipcRenderer.invoke('bv-navigate', action),
  onBvNavState: (cb) => {
    const h = (_e, state) => cb(state)
    ipcRenderer.on('bv-nav-state', h)
    return () => ipcRenderer.removeListener('bv-nav-state', h)
  },
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
  manageSetActive: (name) => ipcRenderer.invoke('manage-set-active', name),
  uninstallEnv: (name) => ipcRenderer.invoke('uninstall-env', name),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  deepyStatus: () => ipcRenderer.invoke('deepy:status'),
  deepyActivate: (engineId) => ipcRenderer.invoke('deepy:activate', engineId),
  openTaskManager: () => ipcRenderer.invoke('open-task-manager'),
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
  setDataDir: (dir) => ipcRenderer.invoke('set-data-dir', dir),
  resetDataDir: () => ipcRenderer.invoke('reset-data-dir'),
  migrateToPreferred: (choices) => ipcRenderer.invoke('migrate-to-preferred', choices),
  moveFolder: (src, dst) => ipcRenderer.invoke('move-folder', src, dst),
  migrateChoose: () => ipcRenderer.invoke('migrate-choose'),
  onOpenMigration: (cb) => ipcRenderer.on('open-migration', () => cb()),
  onMigrationProgress: (cb) => ipcRenderer.on('migration-progress', (_, pct) => cb(pct)),
  writeWgpConfig: (cfg) => ipcRenderer.invoke('write-wgp-config', cfg),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  confirmDialog: (opts) => ipcRenderer.invoke('confirm-dialog', opts),
  checkCommand: (cmd) => ipcRenderer.invoke('check-command', cmd),
  installPrerequisite: (tool) => ipcRenderer.invoke('install-prerequisite', tool),
  detectModelFolders: () => ipcRenderer.invoke('detect-model-folders'),
  getModelPaths: () => ipcRenderer.invoke('get-model-paths'),
  repairSettings: () => ipcRenderer.invoke('repair-settings'),

  // uv wheel cache management (Manage → General)
  uvCacheInfo: () => ipcRenderer.invoke('uv-cache-info'),
  uvCacheSize: () => ipcRenderer.invoke('uv-cache-size'),
  uvCacheClean: (action) => ipcRenderer.invoke('uv-cache-clean', action),

  // Config
  configLoad: () => ipcRenderer.invoke('config-load'),
  configSave: (cfg) => ipcRenderer.invoke('config-save', cfg),

  // Auto-Tune
  autoTuneDetect: () => ipcRenderer.invoke('auto-tune:detect'),
  autoTuneRecommend: (hw, opts) => ipcRenderer.invoke('auto-tune:recommend', hw, opts),

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
  reportIssue: () => ipcRenderer.invoke('report-issue'),

  // Desktop shortcut
  createDesktopShortcut: () => ipcRenderer.invoke('create-desktop-shortcut'),

  // Package updates
  checkPackageUpdates: (versions) => ipcRenderer.invoke('check-package-updates', versions),
  upgradePackage: (pkgName) => ipcRenderer.invoke('upgrade-package', pkgName),
  installPackage: (pkgName) => ipcRenderer.invoke('install-package', pkgName),
  uninstallPackage: (pkgName) => ipcRenderer.invoke('uninstall-package', pkgName),
  checkPackage: (pkgName) => ipcRenderer.invoke('check-package', pkgName),
  restoreRequirements: () => ipcRenderer.invoke('restore-requirements'),

  // Guided LLM engine setup (Deepy Prime)
  llmEnginesList: () => ipcRenderer.invoke('llm-engines:list'),
  llmEngineInstall: (engineId) => ipcRenderer.invoke('llm-engine-install', engineId),
  llmEngineServe: (engineId, action) => ipcRenderer.invoke('llm-engine-serve', engineId, action),
  llmEngineAuth: (engineId) => ipcRenderer.invoke('llm-engine-auth', engineId),

  // Desktop experience: tray, auto-start, notifications, theme
  setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),

  // VRAM / RAM Adjuster
  memoryProfileRead: () => ipcRenderer.invoke('memory-profile:read'),
  memoryProfileApply: (settings) => ipcRenderer.invoke('memory-profile:apply', settings),

  // Queue Notifier
  notifierConfig: () => ipcRenderer.invoke('notifier-config'),
  notifierSet: (cfg) => ipcRenderer.invoke('notifier-set', cfg),
  notifierTest: (cfg) => ipcRenderer.invoke('notifier-test', cfg),
  notifierEnsure: () => ipcRenderer.invoke('notifier-ensure'),

  // Pulsebar overlay
  pulsebarHide: () => ipcRenderer.invoke('pulsebar-hide'),

  // Install hardening
  installPlan: () => ipcRenderer.invoke('install-plan'),
  validateInstall: () => ipcRenderer.invoke('validate-install'),
  setThemeFollowSystem: (enabled) => ipcRenderer.invoke('set-theme-follow-system', enabled),
  setNotificationsEnabled: (enabled) => ipcRenderer.invoke('set-notifications-enabled', enabled),
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

  // Crash recovery: the renderer reports its UI mode so a later renderer crash
  // can be undone (auto-reload + restore of the embedded view / browser mode).
  uiModeSet: (mode) => ipcRenderer.invoke('ui-mode-set', mode),
  getCrashRecoveryInfo: () => ipcRenderer.invoke('get-crash-recovery-info'),
  onBvCrashRecovered: (cb) => {
    const h = () => cb()
    ipcRenderer.on('bv-crash-recovered', h)
    return () => ipcRenderer.removeListener('bv-crash-recovered', h)
  },
})
