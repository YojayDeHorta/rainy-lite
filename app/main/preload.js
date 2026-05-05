const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rainyDesktop', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggle-always-on-top'),
  onToggleVoice: (callback) => ipcRenderer.on('rainy:toggle-voice', callback),
});
