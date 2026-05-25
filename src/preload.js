const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('haCompanion', {
  // System controls
  setVolume: (v) => ipcRenderer.invoke('set-volume', v),
  setMute: (m) => ipcRenderer.invoke('set-mute', m),
  setBrightness: (v) => ipcRenderer.invoke('set-brightness', v),
  bluetoothScan: () => ipcRenderer.invoke('bluetooth-scan'),
  bluetoothConnect: (mac) => ipcRenderer.invoke('bluetooth-connect', mac),

  // App controls
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  logout: () => ipcRenderer.invoke('logout'),
  quit: () => ipcRenderer.invoke('quit'),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getAudioStatus: () => ipcRenderer.invoke('get-audio-status'),
  setupAudio: () => ipcRenderer.invoke('setup-audio'),

  // Auth
  connect: (data) => ipcRenderer.invoke('connect', data),
  loginWithCredentials: (data) => ipcRenderer.invoke('login-with-credentials', data),
  getSensors: () => ipcRenderer.invoke('get-sensors'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  getNotificationHistory: () => ipcRenderer.invoke('get-notification-history'),
});
