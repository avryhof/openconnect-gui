const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Host platform (e.g. 'darwin', 'linux', 'win32')
  platform: process.platform,

  // VPN connection methods
  connectVPN: (config) => ipcRenderer.invoke('connect-vpn', config),
  disconnectVPN: () => ipcRenderer.invoke('disconnect-vpn'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  checkOpenConnect: () => ipcRenderer.invoke('check-openconnect'),

  // Profile management methods
  saveProfiles: (profiles) => ipcRenderer.invoke('save-profiles', profiles),
  loadProfiles: () => ipcRenderer.invoke('load-profiles'),

  // App settings (tray behavior, autostart, theme)
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Advanced: validate a custom OpenConnect binary path
  validateOpenConnectPath: (candidatePath) => ipcRenderer.invoke('validate-openconnect-path', candidatePath),

  // Process management
  checkRunningProcesses: () => ipcRenderer.invoke('check-running-processes'),
  killProcess: (pid, sudoPassword) => ipcRenderer.invoke('kill-process', pid, sudoPassword),

  // Network diagnostics
  getRoutes: () => ipcRenderer.invoke('get-routes'),
  testConnectivity: (host, port) => ipcRenderer.invoke('test-connectivity', host, port),
  deleteRoute: (destination, sudoPassword) => ipcRenderer.invoke('delete-route', destination, sudoPassword),
  getNetworkInterfaces: () => ipcRenderer.invoke('get-network-interfaces'),

  // Event listeners
  onStatusChanged: (callback) => {
    ipcRenderer.on('status-changed', (event, status) => callback(status));
  },
  onLogMessage: (callback) => {
    ipcRenderer.on('log-message', (event, log) => callback(log));
  },
  onConnectionError: (callback) => {
    ipcRenderer.on('connection-error', (event, error) => callback(error));
  }
});
