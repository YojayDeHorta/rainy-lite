const { app, BrowserWindow, clipboard, globalShortcut, ipcMain, net, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let chatWindow;
let avatarWindow;
let settingsWindow;
let setupWindow;
let backendProcess;
let cursorTrackingId;
let spotifyMonitorId;
let spotifyCheckInFlight = false;
let spotifyPlaying = false;
let currentAvatarModel = null;

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const AVATAR_MODEL_PREFS = path.join(app.getPath('userData'), 'avatar-model.json');
const PROFILE_PREFS = path.join(app.getPath('userData'), 'profile.json');
const MIC_PREFS = path.join(app.getPath('userData'), 'mic-preferences.json');
const TTS_PREFS = path.join(app.getPath('userData'), 'tts-preferences.json');
const DEFAULT_AVATAR_MODEL = 'rainy.vrm';
const DEFAULT_PROFILE = {
  botName: 'Asuka',
  userName: 'Usuario',
  model: DEFAULT_AVATAR_MODEL,
  setupCompleted: false,
};

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
  backendProcess = spawn(
    getPythonCommand(ROOT_DIR),
    ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8765'],
    {
      cwd: ROOT_DIR,
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

function readAvatarModelPreference() {
  try {
    const raw = fs.readFileSync(AVATAR_MODEL_PREFS, 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed?.model === 'string' ? parsed.model : null;
  } catch (_) {
    return null;
  }
}

function readProfilePreference() {
  try {
    const raw = fs.readFileSync(PROFILE_PREFS, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      botName: String(parsed?.botName || DEFAULT_PROFILE.botName).trim() || DEFAULT_PROFILE.botName,
      userName: String(parsed?.userName || DEFAULT_PROFILE.userName).trim() || DEFAULT_PROFILE.userName,
      model: String(parsed?.model || DEFAULT_PROFILE.model).trim() || DEFAULT_PROFILE.model,
      setupCompleted: Boolean(parsed?.setupCompleted),
    };
  } catch (_) {
    return { ...DEFAULT_PROFILE };
  }
}

function writeProfilePreference(profile) {
  const clean = {
    botName: String(profile?.botName || DEFAULT_PROFILE.botName).trim() || DEFAULT_PROFILE.botName,
    userName: String(profile?.userName || DEFAULT_PROFILE.userName).trim() || DEFAULT_PROFILE.userName,
    model: String(profile?.model || DEFAULT_PROFILE.model).trim() || DEFAULT_PROFILE.model,
    setupCompleted: Boolean(profile?.setupCompleted),
  };
  fs.writeFileSync(PROFILE_PREFS, JSON.stringify(clean), 'utf8');
  return clean;
}

function isSetupCompleted() {
  const profile = readProfilePreference();
  return Boolean(profile.setupCompleted && profile.botName && profile.userName);
}

function writeAvatarModelPreference(model) {
  fs.writeFileSync(AVATAR_MODEL_PREFS, JSON.stringify({ model }), 'utf8');
}

function readMicPreference() {
  try {
    const raw = fs.readFileSync(MIC_PREFS, 'utf8');
    const parsed = JSON.parse(raw);
    const deviceId = typeof parsed?.deviceId === 'string' ? parsed.deviceId.trim() : '';
    return { deviceId };
  } catch (_) {
    return { deviceId: '' };
  }
}

function writeMicPreference(deviceId) {
  const clean = String(deviceId || '').trim();
  fs.writeFileSync(MIC_PREFS, JSON.stringify({ deviceId: clean }), 'utf8');
  return { deviceId: clean };
}

function listAvatarModels() {
  const buckets = [
    { folder: path.join(ROOT_DIR, 'assets', 'models'), urlPrefix: '../../assets/models/' },
    { folder: path.join(ROOT_DIR, 'assets'), urlPrefix: '../../assets/' },
  ];
  const items = [];
  const seen = new Set();

  for (const bucket of buckets) {
    if (!fs.existsSync(bucket.folder)) continue;
    const names = fs.readdirSync(bucket.folder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.vrm'))
      .map((entry) => entry.name);

    for (const name of names) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: name,
        name,
        label: path.basename(name, path.extname(name)),
        url: `${bucket.urlPrefix}${name}`,
      });
    }
  }

  return items.sort((a, b) => a.label.localeCompare(b.label));
}

function resolveAvatarModelSelection(name) {
  const models = listAvatarModels();
  if (models.length === 0) return null;
  const requested = String(name || '').trim().toLowerCase();
  const preferred = models.find((item) => item.name.toLowerCase() === requested);
  if (preferred) return preferred;
  const fallbackDefault = models.find((item) => item.name.toLowerCase() === DEFAULT_AVATAR_MODEL);
  return fallbackDefault || models[0];
}

function getCurrentAvatarModel() {
  if (currentAvatarModel) return currentAvatarModel;
  const profilePreferred = readProfilePreference().model;
  const preferred = profilePreferred || readAvatarModelPreference();
  const selected = resolveAvatarModelSelection(preferred);
  currentAvatarModel = selected?.name || null;
  return currentAvatarModel;
}

function getCurrentAvatarModelEntry() {
  return resolveAvatarModelSelection(getCurrentAvatarModel());
}

function broadcastAvatarModel(modelName) {
  const model = resolveAvatarModelSelection(modelName);
  if (!model) return;
  if (!avatarWindow) createAvatarWindow();
  const payload = { model: model.name, url: model.url };
  const send = () => avatarWindow?.webContents.send('rainy:avatar-model', payload);
  if (avatarWindow.webContents.isLoading()) avatarWindow.webContents.once('did-finish-load', send);
  else send();
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
  avatarWindow.webContents.once('did-finish-load', () => {
    const model = getCurrentAvatarModelEntry();
    if (model) broadcastAvatarModel(model.name);
  });
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
  chatWindow.webContents.once('did-finish-load', () => {
    chatWindow?.webContents.send('rainy:profile-update', readProfilePreference());
  });
  chatWindow.on('closed', () => {
    chatWindow = null;
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.show();
    return;
  }
  settingsWindow = new BrowserWindow(baseWindowOptions({
    width: 720,
    height: 700,
    minWidth: 520,
    minHeight: 520,
    transparent: false,
    show: true,
    hasShadow: true,
    backgroundColor: '#ffffff',
    alwaysOnTop: false,
  }));
  settingsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function createSetupWindow() {
  if (setupWindow) {
    setupWindow.show();
    return;
  }
  setupWindow = new BrowserWindow(baseWindowOptions({
    width: 900,
    height: 680,
    minWidth: 560,
    minHeight: 580,
    transparent: false,
    show: true,
    hasShadow: true,
    backgroundColor: '#ffffff',
    alwaysOnTop: false,
  }));
  setupWindow.loadFile(path.join(__dirname, '..', 'renderer', 'setup.html'));
  setupWindow.on('closed', () => {
    setupWindow = null;
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

function startNormalUi() {
  createAvatarWindow();
  createChatWindow();
  startGlobalCursorTracking();
  startSpotifyMonitor();
}

app.whenReady().then(() => {
  startBackend();
  if (isSetupCompleted()) startNormalUi();
  else createSetupWindow();

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
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win === setupWindow) {
    app.quit();
    return;
  }
  if (win === settingsWindow) {
    win.close();
  } else {
    win?.hide();
  }
});

ipcMain.handle('window:open-settings', () => {
  createSettingsWindow();
});

ipcMain.handle('window:open-setup', () => {
  createSetupWindow();
});

ipcMain.handle('profile:get', () => {
  const profile = readProfilePreference();
  return {
    ...profile,
    model: getCurrentAvatarModel(),
  };
});

ipcMain.handle('profile:save', (_event, payload) => {
  const selected = resolveAvatarModelSelection(payload?.model);
  if (!selected) {
    return { ok: false, message: 'No se encontro un modelo VRM valido.' };
  }
  currentAvatarModel = selected.name;
  const next = writeProfilePreference({
    botName: payload?.botName,
    userName: payload?.userName,
    model: selected.name,
    setupCompleted: true,
  });
  try {
    writeAvatarModelPreference(selected.name);
  } catch (_) {
  }
  broadcastAvatarModel(selected.name);
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.close();
  }
  if (!avatarWindow || !chatWindow) {
    startNormalUi();
  }
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send('rainy:profile-update', next);
  }
  return { ok: true, profile: next };
});

ipcMain.handle('settings:update-theme', (_event, isDark) => {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send('rainy:theme-update', isDark);
  }
});

ipcMain.handle('audio:get-mic-device', () => readMicPreference());

ipcMain.handle('audio:set-mic-device', (_event, deviceId) => writeMicPreference(deviceId));

function readTtsPreference() {
  try {
    const raw = fs.readFileSync(TTS_PREFS, 'utf8');
    const p = JSON.parse(raw);
    return {
      voice: typeof p.voice === 'string' ? p.voice : '',
      rate: typeof p.rate === 'string' ? p.rate : '',
      pitch: typeof p.pitch === 'string' ? p.pitch : '',
      volume: typeof p.volume === 'string' ? p.volume : '',
    };
  } catch (_) {
    return { voice: '', rate: '', pitch: '', volume: '' };
  }
}

function writeTtsPreference(patch) {
  const prev = readTtsPreference();
  const next = {
    voice: patch?.voice !== undefined ? String(patch.voice ?? '').trim() : prev.voice,
    rate: patch?.rate !== undefined ? String(patch.rate ?? '').trim() : prev.rate,
    pitch: patch?.pitch !== undefined ? String(patch.pitch ?? '').trim() : prev.pitch,
    volume: patch?.volume !== undefined ? String(patch.volume ?? '').trim() : prev.volume,
  };
  fs.writeFileSync(TTS_PREFS, JSON.stringify(next), 'utf8');
  return next;
}

ipcMain.handle('tts:get-preferences', () => readTtsPreference());

ipcMain.handle('tts:set-preferences', (_event, patch) => ({
  ok: true,
  preferences: writeTtsPreference(patch || {}),
}));

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

ipcMain.handle('avatar:speech-status', (_event, payload) => {
  if (!chatWindow || chatWindow.isDestroyed()) return false;
  const send = () => chatWindow?.webContents.send('rainy:avatar-speech-status', payload || {});
  if (chatWindow.webContents.isLoading()) {
    chatWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
  return true;
});

ipcMain.handle('avatar:update-settings', (_event, settings) => {
  updateAvatarSettings(settings);
});

ipcMain.handle('avatar:set-state', (_event, state) => {
  updateAvatarState(state);
});

ipcMain.handle('avatar:list-models', () => {
  const models = listAvatarModels();
  const current = getCurrentAvatarModelEntry();
  return { models, current: current?.name || null, currentUrl: current?.url || null };
});

ipcMain.handle('avatar:get-model', () => {
  const current = getCurrentAvatarModelEntry();
  return current ? { model: current.name, url: current.url } : null;
});

ipcMain.handle('avatar:set-model', (_event, modelName) => {
  const selected = resolveAvatarModelSelection(modelName);
  if (!selected) return { ok: false, message: 'No encontre modelos VRM en assets/models ni assets.' };
  currentAvatarModel = selected.name;
  try {
    writeAvatarModelPreference(currentAvatarModel);
    const profile = readProfilePreference();
    writeProfilePreference({ ...profile, model: currentAvatarModel });
  } catch (error) {
    return { ok: false, message: error.message || 'No pude guardar el modelo seleccionado.' };
  }
  broadcastAvatarModel(currentAvatarModel);
  return { ok: true, model: currentAvatarModel };
});

ipcMain.handle('system:execute-action', async (_event, action) => {
  try {
    return await executeAction(action);
  } catch (error) {
    return { ok: false, message: error.message || 'No se pudo ejecutar la accion.' };
  }
});
