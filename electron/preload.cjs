// Preload: exposes a minimal Steam bridge to the renderer (used by SteamPlatform).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dmtSteam', {
  unlockAchievement: (id) => ipcRenderer.send('steam:achievement', String(id)),
  setRichPresence: (text) => ipcRenderer.send('steam:presence', String(text)),
});
