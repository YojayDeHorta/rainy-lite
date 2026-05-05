const { app, BrowserWindow, clipboard, globalShortcut, ipcMain, net, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let chatWindow;
let avatarWindow;
let backendProcess;
let cursorTrackingId;
let spotifyMonitorId;
let spotifyCheckInFlight = false;
let spotifyPlaying = false;

const AVATAR_BASE_WINDOW = {
  width: 380,
  height: 680,
  scale: 0.85,
  cameraZ: 3.4,
};

function getPythonCommand(rootDir) {
  const venvPython = process.platform === 'win32'
    ? path.join(rootDir, '.venv', 'Scripts', 'python.exe')
    : path.join(rootDir, '.venv', 'bin', 'python');

  try {
    fs.accessSync(venvPython);
    return venvPython;
  } catch (_) {
    return process.platform === 'win32' ? 'python' : 'python3';
  }
}

function startBackend() {
  const rootDir = path.resolve(__dirname, '..', '..');
  backendProcess = spawn(
    getPythonCommand(rootDir),
    ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8765'],
    {
      cwd: rootDir,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  backendProcess.stdout.on('data', (data) => {
    console.log(`[rainy-backend] ${data.toString().trim()}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`[rainy-backend] ${data.toString().trim()}`);
  });

  backendProcess.on('exit', (code) => {
    console.log(`[rainy-backend] exited with code ${code}`);
    backendProcess = null;
  });
}

function baseWindowOptions(extra = {}) {
  return {
    transparent: true,
    frame: false,
    resizable: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    ...extra,
  };
}

function createAvatarWindow() {
  avatarWindow = new BrowserWindow(baseWindowOptions({
    width: AVATAR_BASE_WINDOW.width,
    height: AVATAR_BASE_WINDOW.height,
    minWidth: 150,
    minHeight: 240,
    alwaysOnTop: true,
    skipTaskbar: false,
  }));

  avatarWindow.loadFile(path.join(__dirname, '..', 'renderer', 'avatar.html'));
  avatarWindow.on('closed', () => {
    avatarWindow = null;
  });
}

function createChatWindow() {
  chatWindow = new BrowserWindow(baseWindowOptions({
    width: 540,
    height: 720,
    minWidth: 420,
    minHeight: 520,
    transparent: false,
    show: false,
    hasShadow: true,
    backgroundColor: '#070b13',
    alwaysOnTop: false,
  }));

  chatWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  chatWindow.on('closed', () => {
    chatWindow = null;
  });
}

function toggleWindow(win) {
  if (!win) return;
  win.isVisible() ? win.hide() : win.show();
}

function sendToAvatar(payload) {
  if (!avatarWindow) createAvatarWindow();
  if (!avatarWindow.isVisible()) avatarWindow.show();

  const send = () => avatarWindow?.webContents.send('rainy:avatar-speak', payload);
  if (avatarWindow.webContents.isLoading()) {
    avatarWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function updateAvatarSettings(settings) {
  if (!avatarWindow) createAvatarWindow();
  applyAvatarWindowScale(settings);

  const send = () => avatarWindow?.webContents.send('rainy:avatar-settings', settings);
  if (avatarWindow.webContents.isLoading()) {
    avatarWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function applyAvatarWindowScale(settings) {
  if (!avatarWindow || avatarWindow.isDestroyed()) return;
  const numericScale = Number(settings?.scale);
  if (!Number.isFinite(numericScale)) return;
  const numericCameraZ = Number(settings?.cameraZ);
  const cameraZ = Number.isFinite(numericCameraZ) ? numericCameraZ : AVATAR_BASE_WINDOW.cameraZ;

  const scaleRatio = numericScale / AVATAR_BASE_WINDOW.scale;
  const cameraRatio = AVATAR_BASE_WINDOW.cameraZ / Math.max(0.2, cameraZ);
  const visualRatio = scaleRatio * Math.pow(cameraRatio, 0.9);

  // Big avatars need extra breathing room in every direction.
  const largeBoost = visualRatio > 1 ? 1 + (visualRatio - 1) * 0.24 : 1;
  // Small avatars benefit from tighter framing to remove empty space.
  const smallTighten = visualRatio < 1 ? 1 - (1 - visualRatio) * 0.15 : 1;
  const tunedRatio = visualRatio * largeBoost * smallTighten;

  const widthFactor = visualRatio > 1 ? 1.14 : 0.96;
  const heightFactor = visualRatio > 1 ? 1.22 : 0.93;
  const nextWidth = Math.max(150, Math.round(AVATAR_BASE_WINDOW.width * tunedRatio * widthFactor));
  const nextHeight = Math.max(240, Math.round(AVATAR_BASE_WINDOW.height * tunedRatio * heightFactor));

  const [x, y] = avatarWindow.getPosition();
  const [currentWidth, currentHeight] = avatarWindow.getSize();
  if (currentWidth === nextWidth && currentHeight === nextHeight) return;

  const centerX = x + currentWidth / 2;
  const centerY = y + currentHeight / 2;
  const nextX = Math.round(centerX - nextWidth / 2);
  const nextY = Math.round(centerY - nextHeight / 2);

  avatarWindow.setBounds({ x: nextX, y: nextY, width: nextWidth, height: nextHeight }, false);
}

function updateAvatarState(state) {
  if (!avatarWindow) createAvatarWindow();

  const send = () => avatarWindow?.webContents.send('rainy:avatar-state', state);
  if (avatarWindow.webContents.isLoading()) {
    avatarWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function updateAvatarSpotifyPlayback(isPlaying) {
  if (!avatarWindow) createAvatarWindow();
  spotifyPlaying = Boolean(isPlaying);
  const send = () => avatarWindow?.webContents.send('rainy:spotify-playback', { isPlaying: spotifyPlaying });
  if (avatarWindow.webContents.isLoading()) {
    avatarWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function startGlobalCursorTracking() {
  if (cursorTrackingId) return;
  cursorTrackingId = setInterval(() => {
    if (!avatarWindow || avatarWindow.isDestroyed() || !avatarWindow.isVisible()) return;
    if (avatarWindow.webContents.isLoading()) return;

    avatarWindow.webContents.send('rainy:global-cursor', {
      cursor: screen.getCursorScreenPoint(),
      bounds: avatarWindow.getBounds(),
    });
  }, 33);
}

function startSpotifyMonitor() {
  if (process.platform !== 'win32' || spotifyMonitorId) return;
  spotifyMonitorId = setInterval(async () => {
    if (spotifyCheckInFlight) return;
    spotifyCheckInFlight = true;
    try {
      const next = await queryWindowsSpotifyPlaying();
      if (next !== spotifyPlaying) {
        updateAvatarSpotifyPlayback(next);
      }
    } catch (_) {
      if (spotifyPlaying) updateAvatarSpotifyPlayback(false);
    } finally {
      spotifyCheckInFlight = false;
    }
  }, 800);
}

function stopSpotifyMonitor() {
  if (!spotifyMonitorId) return;
  clearInterval(spotifyMonitorId);
  spotifyMonitorId = null;
}

const APP_COMMANDS = {
  win32: {
    notepad: 'notepad.exe',
    calculator: 'calc.exe',
    calc: 'calc.exe',
    explorer: 'explorer.exe',
    chrome: 'chrome.exe',
    edge: 'msedge.exe',
    vscode: 'code.cmd',
    code: 'code.cmd',
    spotify: 'spotify',
  },
  linux: {
    files: 'xdg-open',
    explorer: 'xdg-open',
    firefox: 'firefox',
    chrome: 'google-chrome',
    chromium: 'chromium-browser',
    vscode: 'code',
    code: 'code',
    calculator: 'gnome-calculator',
    calc: 'gnome-calculator',
    spotify: 'spotify',
  },
  darwin: {
    finder: 'Finder',
    safari: 'Safari',
    chrome: 'Google Chrome',
    vscode: 'Visual Studio Code',
    code: 'Visual Studio Code',
    calculator: 'Calculator',
    spotify: 'Spotify',
  },
};

const MEDIA_KEYS = {
  MEDIA_PREVIOUS: { win: '0xB1', linux: 'previous', mac: 'previous track' },
  MEDIA_PLAY_PAUSE: { win: '0xB3', linux: 'play-pause', mac: 'playpause' },
  MEDIA_NEXT: { win: '0xB0', linux: 'next', mac: 'next track' },
};

function normalizeAction(action) {
  return {
    type: String(action?.type || '').trim().toUpperCase(),
    payload: String(action?.payload || '').trim(),
  };
}

async function executeAction(action) {
  const { type, payload } = normalizeAction(action);

  if (MEDIA_KEYS[type]) {
    await executeMediaKey(type);
    return { ok: true, message: mediaActionMessage(type) };
  }

  if (type === 'OPEN_URL') {
    const url = new URL(payload);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Solo se permiten URLs http/https.');
    await shell.openExternal(url.toString());
    return { ok: true, message: `URL abierta: ${url.toString()}` };
  }

  if (type === 'SPOTIFY_SEARCH') {
    if (!payload) throw new Error('Falta la busqueda de Spotify.');
    await openSpotifySearch(payload);
    return { ok: true, message: `Busqueda abierta en Spotify: ${payload}` };
  }

  if (type === 'SPOTIFY_SEARCH_AND_PLAY') {
    if (!payload) throw new Error('Falta la busqueda de Spotify.');
    const track = await searchSpotifyTrack(payload);
    await shell.openExternal(track.uri);
    return { ok: true, message: `Reproduciendo en Spotify: ${track.name} - ${track.artists}` };
  }

  if (type === 'OPEN_FOLDER') {
    if (!payload) throw new Error('Falta la ruta de carpeta.');
    const result = await shell.openPath(payload);
    if (result) throw new Error(result);
    return { ok: true, message: `Carpeta abierta: ${payload}` };
  }

  if (type === 'COPY_TEXT') {
    clipboard.writeText(payload);
    return { ok: true, message: 'Texto copiado al portapapeles.' };
  }

  if (type === 'SHOW_AVATAR') {
    if (!avatarWindow) createAvatarWindow();
    avatarWindow.show();
    return { ok: true, message: 'Avatar mostrado.' };
  }

  if (type === 'HIDE_AVATAR') {
    avatarWindow?.hide();
    return { ok: true, message: 'Avatar ocultado.' };
  }

  if (type === 'OPEN_APP') {
    const appKey = payload.toLowerCase().replace(/\.exe$/i, '').trim();
    if (appKey === 'spotify') {
      await shell.openExternal('spotify:');
      return { ok: true, message: 'Spotify abierto.' };
    }

    const platformMap = APP_COMMANDS[process.platform] || APP_COMMANDS.linux;
    const command = platformMap[appKey];
    if (!command) throw new Error(`App no permitida todavia: ${payload}`);

    if (process.platform === 'darwin') {
      spawn('open', ['-a', command], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'linux' && command === 'xdg-open') {
      spawn(command, [app.getPath('home')], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn(command, [], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref();
    }
    return { ok: true, message: `App abierta: ${payload}` };
  }

  throw new Error(`Accion no soportada: ${type}`);
}

function mediaActionMessage(type) {
  if (type === 'MEDIA_PLAY_PAUSE') return 'Play/Pause enviado.';
  if (type === 'MEDIA_NEXT') return 'Siguiente cancion enviada.';
  if (type === 'MEDIA_PREVIOUS') return 'Cancion anterior enviada.';
  return 'Control multimedia enviado.';
}

function executeMediaKey(type) {
  const media = MEDIA_KEYS[type];
  if (!media) throw new Error(`Control multimedia no soportado: ${type}`);

  if (process.platform === 'win32') {
    return executeWindowsMediaKey(media.win);
  }

  if (process.platform === 'darwin') {
    return spawnAndWait('osascript', ['-e', `tell application "Spotify" to ${media.mac}`]);
  }

  return spawnAndWait('playerctl', [media.linux]);
}

function executeWindowsMediaKey(virtualKey) {
  const script = `
$code = @"
using System;
using System.Runtime.InteropServices;
public class RainyKeyboard {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
Add-Type -TypeDefinition $code
[RainyKeyboard]::keybd_event([byte]${virtualKey}, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[RainyKeyboard]::keybd_event([byte]${virtualKey}, 0, 2, [UIntPtr]::Zero)
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return spawnAndWait('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-EncodedCommand', encoded,
  ], { windowsHide: true });
}

function queryWindowsSpotifyPlaying() {
  const script = `
$ErrorActionPreference = "SilentlyContinue"
if (-not (Get-Process -Name "Spotify" -ErrorAction SilentlyContinue)) {
  Write-Output "paused"
  exit 0
}
$titles = Get-Process -Name "Spotify" -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0 } |
  Select-Object -ExpandProperty MainWindowTitle
if (-not $titles -or $titles.Count -eq 0) {
  Write-Output "paused"
  exit 0
}
$candidate = ($titles | Sort-Object Length -Descending | Select-Object -First 1).Trim()
if ($candidate -match "^(Spotify|Spotify Premium|Spotify Free)$") {
  Write-Output "paused"
  exit 0
}
Write-Output "playing"
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-WindowStyle', 'Hidden',
      '-EncodedCommand', encoded,
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.on('error', () => resolve(false));
    child.on('exit', () => {
      resolve(stdout.trim().toLowerCase().includes('playing'));
    });
  });
}

function openSpotifySearch(query) {
  const encodedQuery = encodeURIComponent(query).replace(/%20/g, '+');
  return shell.openExternal(`spotify:search:${encodedQuery}`);
}

function searchSpotifyTrack(query) {
  return new Promise((resolve, reject) => {
    const request = net.request({
      url: `http://127.0.0.1:8765/api/spotify/search?q=${encodeURIComponent(query)}&limit=1`,
    });
    let body = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => { body += chunk.toString(); });
      response.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.tracks && data.tracks.length > 0) {
            resolve(data.tracks[0]);
          } else {
            reject(new Error(`No encontre "${query}" en Spotify.`));
          }
        } catch (e) {
          reject(new Error(body || 'Error al buscar en Spotify.'));
        }
      });
    });
    request.on('error', (err) => reject(new Error(`Spotify API error: ${err.message}`)));
    request.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnAndWait(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: false,
      windowsHide: true,
      ...options,
    });
    let stderr = '';
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} salio con codigo ${code}`));
    });
  });
}

app.whenReady().then(() => {
  startBackend();
  createAvatarWindow();
  createChatWindow();
  startGlobalCursorTracking();
  startSpotifyMonitor();

  globalShortcut.register('CommandOrControl+Shift+R', () => {
    if (!chatWindow) return;
    if (!chatWindow.isVisible()) chatWindow.show();
    chatWindow.webContents.send('rainy:toggle-voice');
  });

  globalShortcut.register('CommandOrControl+Shift+H', () => toggleWindow(chatWindow));
  globalShortcut.register('CommandOrControl+Shift+A', () => toggleWindow(avatarWindow));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (cursorTrackingId) {
    clearInterval(cursorTrackingId);
    cursorTrackingId = null;
  }
  stopSpotifyMonitor();
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
});

ipcMain.handle('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

function sendToAvatarWakeword() {
  if (!avatarWindow) createAvatarWindow();
  const send = () => avatarWindow?.webContents.send('rainy:avatar-wakeword-triggered', { at: Date.now() });
  if (avatarWindow.webContents.isLoading()) {
    avatarWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

ipcMain.handle('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.hide();
});

ipcMain.handle('window:toggle-chat', () => {
  if (!chatWindow) createChatWindow();
  const next = !chatWindow.isVisible();
  if (next) chatWindow.show();
  else chatWindow.hide();
  return next;
});

ipcMain.handle('window:toggle-always-on-top', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  const next = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(next);
  return next;
});

ipcMain.handle('window:get-position', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { x: 0, y: 0 };
  const [x, y] = win.getPosition();
  return { x, y };
});

ipcMain.handle('window:set-position', (event, position) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const x = Math.round(Number(position?.x) || 0);
  const y = Math.round(Number(position?.y) || 0);
  win.setPosition(x, y, false);
});

ipcMain.handle('avatar:speak', (_event, payload) => {
  sendToAvatar(payload);
});

ipcMain.handle('avatar:wakeword-triggered', () => {
  sendToAvatarWakeword();
  return true;
});

ipcMain.handle('avatar:update-settings', (_event, settings) => {
  updateAvatarSettings(settings);
});

ipcMain.handle('avatar:set-state', (_event, state) => {
  updateAvatarState(state);
});

ipcMain.handle('system:execute-action', async (_event, action) => {
  try {
    return await executeAction(action);
  } catch (error) {
    return { ok: false, message: error.message || 'No se pudo ejecutar la accion.' };
  }
});
