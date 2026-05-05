const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rainyDesktop', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggle-always-on-top'),
  speakOnAvatar: (payload) => ipcRenderer.invoke('avatar:speak', payload),
  onToggleVoice: (callback) => ipcRenderer.on('rainy:toggle-voice', callback),
  onAvatarSpeak: (callback) => ipcRenderer.on('rainy:avatar-speak', (_event, payload) => callback(payload)),
});
