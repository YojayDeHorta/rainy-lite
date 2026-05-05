const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let backendProcess;
let isAlwaysOnTop = true;

function getPythonCommand(rootDir) {
  const venvPython = process.platform === 'win32'
    ? path.join(rootDir, '.venv', 'Scripts', 'python.exe')
    : path.join(rootDir, '.venv', 'bin', 'python');

  try {
    require('fs').accessSync(venvPython);
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
    }
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 680,
    minWidth: 320,
    minHeight: 520,
    transparent: true,
    frame: false,
    resizable: true,
    alwaysOnTop: isAlwaysOnTop,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startBackend();
  createWindow();

  globalShortcut.register('CommandOrControl+Shift+R', () => {
    if (!mainWindow) return;
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.webContents.send('rainy:toggle-voice');
  });

  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
});

ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window:close', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle('window:toggle-always-on-top', () => {
  if (!mainWindow) return false;
  isAlwaysOnTop = !isAlwaysOnTop;
  mainWindow.setAlwaysOnTop(isAlwaysOnTop);
  return isAlwaysOnTop;
});
