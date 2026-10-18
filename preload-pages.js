// Preload for the auxiliary windows (splash, installer helper, password
// prompt). These windows previously ran with nodeIntegration enabled and no
// context isolation; they now run sandboxed and reach the main process only
// through the allow-listed channels below.
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE_CHANNELS = ['install-openconnect', 'check-openconnect'];
const SEND_CHANNELS = [
  'splash-loaded',
  'splash-ready',
  'open-installer',
  'openconnect-installed',
  'open-terminal',
  'password-prompt-result'
];
const RECEIVE_CHANNELS = [
  'system-check-start',
  'system-check-complete',
  'system-check-warning',
  'splash-progress',
  'splash-error',
  'splash-complete'
];

contextBridge.exposeInMainWorld('pageBridge', {
  platform: process.platform,

  invoke: (channel, ...args) => {
    if (!INVOKE_CHANNELS.includes(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  send: (channel, ...args) => {
    if (SEND_CHANNELS.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },

  // Returns an unsubscribe function for the registered listener
  on: (channel, callback) => {
    if (!RECEIVE_CHANNELS.includes(channel)) {
      return () => {};
    }
    const listener = (event, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  removeAllListeners: (channel) => {
    if (RECEIVE_CHANNELS.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  }
});
