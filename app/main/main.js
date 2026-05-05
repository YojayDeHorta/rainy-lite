const { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let chatWindow;
let avatarWindow;
let backendProcess;
let cursorTrackingId;

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
    width: 380,
    height: 680,
    minWidth: 240,
    minHeight: 360,
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

  const send = () => avatarWindow?.webContents.send('rainy:avatar-settings', settings);
  if (avatarWindow.webContents.isLoading()) {
    avatarWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
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
    const command = [
      'Add-Type -MemberDefinition \'[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);\' -Name Keyboard -Namespace Win32;',
      `[Win32.Keyboard]::keybd_event(${media.win},0,0,[UIntPtr]::Zero);`,
      `[Win32.Keyboard]::keybd_event(${media.win},0,2,[UIntPtr]::Zero);`,
    ].join(' ');
    return spawnDetached('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', command]);
  }

  if (process.platform === 'darwin') {
    return spawnDetached('osascript', ['-e', `tell application "Spotify" to ${media.mac}`]);
  }

  return spawnDetached('playerctl', [media.linux]);
}

function spawnDetached(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.unref();
    resolve();
  });
}

app.whenReady().then(() => {
  startBackend();
  createAvatarWindow();
  createChatWindow();
  startGlobalCursorTracking();

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
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
});

ipcMain.handle('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.hide();
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
