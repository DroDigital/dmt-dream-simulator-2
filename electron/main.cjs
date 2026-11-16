// Electron main process (M6): serves the static web build in a frameless-ish window and bridges Steam.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

let steam = null;
try {
  // steamworks.js is optional: without Steam (or the Steam client) the game runs with the NullPlatform
  const steamworks = require('steamworks.js');
  const appId = Number(process.env.DMT_STEAM_APP_ID || 480);
  steam = steamworks.init(appId);
  steamworks.electronEnableSteamOverlay();
} catch (e) {
  console.warn('[steam] unavailable:', e && e.message);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1920, height: 1080, backgroundColor: '#120e16', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

ipcMain.on('steam:achievement', (_e, id) => { try { steam && steam.achievement.activate(id); } catch (err) { console.warn(err); } });
ipcMain.on('steam:presence', (_e, text) => { try { steam && steam.localplayer.setRichPresence('steam_display', String(text).slice(0, 255)); } catch (err) { console.warn(err); } });

app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
