const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rainyDesktop', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  toggleChat: () => ipcRenderer.invoke('window:toggle-chat'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggle-always-on-top'),
  getWindowPosition: () => ipcRenderer.invoke('window:get-position'),
  setWindowPosition: (position) => ipcRenderer.invoke('window:set-position', position),
  speakOnAvatar: (payload) => ipcRenderer.invoke('avatar:speak', payload),
  updateAvatarSettings: (settings) => ipcRenderer.invoke('avatar:update-settings', settings),
  setAvatarState: (state) => ipcRenderer.invoke('avatar:set-state', state),
  notifyWakewordTriggered: () => ipcRenderer.invoke('avatar:wakeword-triggered'),
  executeAction: (action) => ipcRenderer.invoke('system:execute-action', action),
  onToggleVoice: (callback) => ipcRenderer.on('rainy:toggle-voice', callback),
  onAvatarSpeak: (callback) => ipcRenderer.on('rainy:avatar-speak', (_event, payload) => callback(payload)),
  onAvatarSettings: (callback) => ipcRenderer.on('rainy:avatar-settings', (_event, settings) => callback(settings)),
  onAvatarState: (callback) => ipcRenderer.on('rainy:avatar-state', (_event, state) => callback(state)),
  onAvatarWakewordTriggered: (callback) => ipcRenderer.on('rainy:avatar-wakeword-triggered', (_event, payload) => callback(payload)),
  onSpotifyPlayback: (callback) => ipcRenderer.on('rainy:spotify-playback', (_event, payload) => callback(payload)),
  onGlobalCursor: (callback) => ipcRenderer.on('rainy:global-cursor', (_event, payload) => callback(payload)),
});
