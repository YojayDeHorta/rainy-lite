const { app, BrowserWindow, Menu, Tray, clipboard, dialog, globalShortcut, ipcMain, net, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const DiscordRPC = require('discord-rpc');

let chatWindow;
let avatarWindow;
let settingsWindow;
let setupWindow;
let tray;
let backendProcess;
let cursorTrackingId;
let spotifyMonitorId;
let spotifyCheckInFlight = false;
let spotifyPlaying = false;
let spotifyTitle = '';
let lastUserActivityAt = Date.now();
let currentAvatarModel = null;
let currentAvatarState = 'idle';
let discordClient = null;
let discordConnected = false;
let discordStartTimestamp = null;
let discordReconnectTimer = null;
let pendingSetupWelcomeGreeting = false;

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const BACKEND_ROOT_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked')
  : ROOT_DIR;
const PACKAGED_BACKEND_EXE = process.platform === 'win32'
  ? path.join(process.resourcesPath, 'backend', 'asuka-backend', 'asuka-backend.exe')
  : path.join(process.resourcesPath, 'backend', 'asuka-backend');
const AVATAR_MODEL_PREFS = path.join(app.getPath('userData'), 'avatar-model.json');
const AVATAR_WINDOW_PREFS = path.join(app.getPath('userData'), 'avatar-window-preferences.json');
const PROFILE_PREFS = path.join(app.getPath('userData'), 'profile.json');
const MIC_PREFS = path.join(app.getPath('userData'), 'mic-preferences.json');
const TTS_PREFS = path.join(app.getPath('userData'), 'tts-preferences.json');
const DISCORD_PREFS = path.join(app.getPath('userData'), 'discord-preferences.json');
const INTEGRATION_PREFS = path.join(app.getPath('userData'), 'integration-preferences.json');
const PERFORMANCE_PREFS = path.join(app.getPath('userData'), 'performance-preferences.json');
const DEFAULT_AVATAR_MODEL = 'ls01.vrm';
const PERSONALITY_CUSTOM_MAX = 600;
const MAX_CUSTOM_VRM_SIZE_BYTES = 120 * 1024 * 1024;
const APP_ICON_PNG = path.join(ROOT_DIR, 'assets', 'icons', 'asuka.png');

const DEFAULT_PROFILE = {
  botName: 'Asuka',
  userName: 'Usuario',
  model: DEFAULT_AVATAR_MODEL,
  setupCompleted: false,
  personalityPreset: 'calida_nocturna',
  personalityCustom: '',
  privacyAccepted: false,
  privacyAcceptedAt: '',
};

function normalizePersonalityForSave(candidate, existing = {}) {
  const preset = String(
    candidate.personalityPreset ?? existing.personalityPreset ?? DEFAULT_PROFILE.personalityPreset,
  )
    .trim()
    .toLowerCase() || DEFAULT_PROFILE.personalityPreset;
  const custom = String(candidate.personalityCustom ?? existing.personalityCustom ?? '').slice(
    0,
    PERSONALITY_CUSTOM_MAX,
  );
  if (preset === 'custom' && !custom.trim()) {
    return { ok: false, message: 'En modo personalizada describe tu tono.' };
  }
  return { ok: true, personalityPreset: preset, personalityCustom: custom };
}

const AVATAR_BASE_WINDOW = {
  width: 380,
  height: 680,
  scale: 0.85,
  cameraZ: 3.4,
};

const PERFORMANCE_PROFILES = {
  saver: {
    id: 'saver',
    label: 'Ahorrador',
    avatarFps: 24,
    idleAvatarFps: 12,
    pixelRatioCap: 1,
    cursorFps: 10,
    spotifyIntervalMs: 5000,
    spotifyInactiveIntervalMs: 15000,
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    avatarFps: 30,
    idleAvatarFps: 15,
    pixelRatioCap: 1.3,
    cursorFps: 15,
    spotifyIntervalMs: 2500,
    spotifyInactiveIntervalMs: 12000,
  },
  fluid: {
    id: 'fluid',
    label: 'Fluido',
    avatarFps: 60,
    idleAvatarFps: 20,
    pixelRatioCap: 1.5,
    cursorFps: 30,
    spotifyIntervalMs: 800,
    spotifyInactiveIntervalMs: 10000,
  },
  max: {
    id: 'max',
    label: 'Maximo rendimiento',
    avatarFps: 60,
    idleAvatarFps: 30,
    pixelRatioCap: 2,
    cursorFps: 30,
    spotifyIntervalMs: 800,
    spotifyInactiveIntervalMs: 8000,
  },
};
const DEFAULT_PERFORMANCE_PROFILE = 'fluid';
const PERFORMANCE_IDLE_AFTER_MS = 5 * 60 * 1000;

function getVenvPython(rootDir) {
  const venvPython = process.platform === 'win32'
    ? path.join(rootDir, '.venv', 'Scripts', 'python.exe')
    : path.join(rootDir, '.venv', 'bin', 'python');

  try {
    fs.accessSync(venvPython);
    return venvPython;
  } catch (_) {
    return null;
  }
}

function getPythonLaunchCandidates(rootDir) {
  const candidates = [];
  const venvPython = getVenvPython(rootDir);
  if (venvPython) candidates.push({ command: venvPython, prefixArgs: [], label: '.venv/python' });
  if (process.platform === 'win32') {
    candidates.push(
      { command: 'python', prefixArgs: [], label: 'python' },
      { command: 'py', prefixArgs: ['-3'], label: 'py -3' },
      { command: 'python3', prefixArgs: [], label: 'python3' },
    );
  } else {
    candidates.push(
      { command: 'python3', prefixArgs: [], label: 'python3' },
      { command: 'python', prefixArgs: [], label: 'python' },
    );
  }
  const unique = [];
  const seen = new Set();
  for (const item of candidates) {
    const key = `${item.command} ${item.prefixArgs.join(' ')}`.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function startBackend() {
  const userDataDir = app.getPath('userData');
  const portableEnvPath = path.join(path.dirname(process.execPath), '.env');
  const integrationPrefs = readIntegrationPreference();
  const integrationEnv = {};
  integrationEnv.WAKEWORD_ENABLED = integrationPrefs.wakewordEnabled ? '1' : '0';
  const backendEnv = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    RAINY_USER_DATA_DIR: userDataDir,
    RAINY_ENV_PATH: portableEnvPath,
    RAINY_ROOT_DIR: app.isPackaged ? process.resourcesPath : ROOT_DIR,
    ...integrationEnv,
  };

  const launchPackagedBackend = () => {
    if (!app.isPackaged) return false;
    try {
      fs.accessSync(PACKAGED_BACKEND_EXE);
    } catch (_) {
      return false;
    }

    const child = spawn(PACKAGED_BACKEND_EXE, [], {
      cwd: path.dirname(PACKAGED_BACKEND_EXE),
      env: backendEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    child.once('error', (error) => {
      console.error(`[rainy-backend] Error lanzando backend.exe: ${error.message || error}`);
      backendProcess = null;
      launchPythonBackend();
    });

    child.once('spawn', () => {
      backendProcess = child;
      console.log('[rainy-backend] iniciado con backend.exe');
    });

    child.stdout.on('data', (data) => {
      console.log(`[rainy-backend] ${data.toString().trim()}`);
    });

    child.stderr.on('data', (data) => {
      console.error(`[rainy-backend] ${data.toString().trim()}`);
    });

    child.on('exit', (code) => {
      if (backendProcess === child) {
        console.log(`[rainy-backend] backend.exe exited with code ${code}`);
        backendProcess = null;
      }
    });

    return true;
  };

  const launchPythonBackend = () => {
    const uvicornArgs = ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8765'];
    const candidates = getPythonLaunchCandidates(BACKEND_ROOT_DIR);

    const tryLaunch = (index) => {
      if (index >= candidates.length) {
        console.error('[rainy-backend] No encontre un interprete de Python para iniciar el backend.');
        return;
      }
      const candidate = candidates[index];
      const child = spawn(
        candidate.command,
        [...candidate.prefixArgs, ...uvicornArgs],
        {
          cwd: BACKEND_ROOT_DIR,
          env: backendEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      child.once('error', (error) => {
        if (error?.code === 'ENOENT') {
          console.warn(`[rainy-backend] Python no disponible con "${candidate.label}", probando siguiente...`);
          tryLaunch(index + 1);
          return;
        }
        console.error(`[rainy-backend] Error lanzando backend con "${candidate.label}": ${error.message || error}`);
        tryLaunch(index + 1);
      });

      child.once('spawn', () => {
        backendProcess = child;
        console.log(`[rainy-backend] iniciado con ${candidate.label}`);
      });

      child.stdout.on('data', (data) => {
        console.log(`[rainy-backend] ${data.toString().trim()}`);
      });

      child.stderr.on('data', (data) => {
        console.error(`[rainy-backend] ${data.toString().trim()}`);
      });

      child.on('exit', (code) => {
        if (backendProcess === child) {
          console.log(`[rainy-backend] exited with code ${code}`);
          backendProcess = null;
        }
      });
    };

    tryLaunch(0);
  };

  if (!launchPackagedBackend()) launchPythonBackend();
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
    let personalityPreset = String(
      parsed?.personalityPreset ?? DEFAULT_PROFILE.personalityPreset,
    )
      .trim()
      .toLowerCase() || DEFAULT_PROFILE.personalityPreset;
    let personalityCustom = String(parsed?.personalityCustom ?? DEFAULT_PROFILE.personalityCustom).slice(
      0,
      PERSONALITY_CUSTOM_MAX,
    );
    if (personalityPreset === 'custom' && !personalityCustom.trim()) {
      personalityPreset = DEFAULT_PROFILE.personalityPreset;
      personalityCustom = '';
    }
    return {
      botName: String(parsed?.botName || DEFAULT_PROFILE.botName).trim() || DEFAULT_PROFILE.botName,
      userName: String(parsed?.userName || DEFAULT_PROFILE.userName).trim() || DEFAULT_PROFILE.userName,
      model: String(parsed?.model || DEFAULT_PROFILE.model).trim() || DEFAULT_PROFILE.model,
      setupCompleted: Boolean(parsed?.setupCompleted),
      personalityPreset,
      personalityCustom,
      privacyAccepted: Boolean(parsed?.privacyAccepted),
      privacyAcceptedAt: String(parsed?.privacyAcceptedAt || ''),
    };
  } catch (_) {
    return { ...DEFAULT_PROFILE };
  }
}

function writeProfilePreference(profile) {
  let personalityPreset = String(
    profile?.personalityPreset ?? DEFAULT_PROFILE.personalityPreset,
  )
    .trim()
    .toLowerCase() || DEFAULT_PROFILE.personalityPreset;
  let personalityCustom = String(profile?.personalityCustom ?? DEFAULT_PROFILE.personalityCustom).slice(
    0,
    PERSONALITY_CUSTOM_MAX,
  );
  if (personalityPreset === 'custom' && !personalityCustom.trim()) {
    personalityPreset = DEFAULT_PROFILE.personalityPreset;
    personalityCustom = '';
  }
  const clean = {
    botName: String(profile?.botName || DEFAULT_PROFILE.botName).trim() || DEFAULT_PROFILE.botName,
    userName: String(profile?.userName || DEFAULT_PROFILE.userName).trim() || DEFAULT_PROFILE.userName,
    model: String(profile?.model || DEFAULT_PROFILE.model).trim() || DEFAULT_PROFILE.model,
    setupCompleted: Boolean(profile?.setupCompleted),
    personalityPreset,
    personalityCustom,
    privacyAccepted: Boolean(profile?.privacyAccepted),
    privacyAcceptedAt: profile?.privacyAccepted
      ? String(profile?.privacyAcceptedAt || new Date().toISOString())
      : '',
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

function readAvatarWindowPreference() {
  try {
    const raw = fs.readFileSync(AVATAR_WINDOW_PREFS, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      alwaysOnTop: parsed?.alwaysOnTop === undefined ? true : Boolean(parsed.alwaysOnTop),
      bounds: normalizeAvatarBounds(parsed?.bounds),
    };
  } catch (_) {
    return { alwaysOnTop: true, bounds: null };
  }
}

function writeAvatarWindowPreference(prefs = {}) {
  const prev = readAvatarWindowPreference();
  const next = {
    alwaysOnTop: prefs.alwaysOnTop !== undefined ? Boolean(prefs.alwaysOnTop) : prev.alwaysOnTop,
    bounds: prefs.bounds !== undefined ? normalizeAvatarBounds(prefs.bounds) : prev.bounds,
  };
  fs.writeFileSync(AVATAR_WINDOW_PREFS, JSON.stringify(next), 'utf8');
  return next;
}

function normalizeAvatarBounds(bounds) {
  if (!bounds) return null;
  const width = Math.max(150, Math.round(Number(bounds.width) || AVATAR_BASE_WINDOW.width));
  const height = Math.max(240, Math.round(Number(bounds.height) || AVATAR_BASE_WINDOW.height));
  const x = Math.round(Number(bounds.x));
  const y = Math.round(Number(bounds.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, width, height };
}

function getDefaultAvatarBounds() {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  return {
    x: Math.round(area.x + area.width - AVATAR_BASE_WINDOW.width - 40),
    y: Math.round(area.y + area.height - AVATAR_BASE_WINDOW.height - 30),
    width: AVATAR_BASE_WINDOW.width,
    height: AVATAR_BASE_WINDOW.height,
  };
}

function isBoundsVisible(bounds) {
  if (!bounds) return false;
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x));
    const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
    return overlapX >= 80 && overlapY >= 80;
  });
}

function resolveAvatarInitialBounds(savedBounds) {
  const bounds = normalizeAvatarBounds(savedBounds);
  return isBoundsVisible(bounds) ? bounds : getDefaultAvatarBounds();
}

function saveAvatarWindowBounds() {
  if (!avatarWindow || avatarWindow.isDestroyed()) return;
  writeAvatarWindowPreference({ bounds: avatarWindow.getBounds() });
}

function resetAvatarWindowBounds() {
  const bounds = getDefaultAvatarBounds();
  writeAvatarWindowPreference({ bounds });
  if (!avatarWindow || avatarWindow.isDestroyed()) createAvatarWindow();
  avatarWindow.setBounds(bounds, false);
  avatarWindow.show();
  return bounds;
}

function normalizePerformanceProfileId(value) {
  const id = String(value || '').trim().toLowerCase();
  return PERFORMANCE_PROFILES[id] ? id : DEFAULT_PERFORMANCE_PROFILE;
}

function readPerformancePreference() {
  const defaultProfile = normalizePerformanceProfileId(DEFAULT_PERFORMANCE_PROFILE);
  const fallback = {
    profile: defaultProfile,
    profiles: Object.values(PERFORMANCE_PROFILES),
    effective: PERFORMANCE_PROFILES[defaultProfile],
  };
  try {
    const raw = fs.readFileSync(PERFORMANCE_PREFS, 'utf8');
    const parsed = JSON.parse(raw);
    const profileId = normalizePerformanceProfileId(parsed?.profile);
    return {
      profile: profileId,
      profiles: Object.values(PERFORMANCE_PROFILES),
      effective: PERFORMANCE_PROFILES[profileId],
    };
  } catch (_) {
    return fallback;
  }
}

function writePerformancePreference(prefs = {}) {
  const profileId = normalizePerformanceProfileId(prefs.profile);
  fs.writeFileSync(PERFORMANCE_PREFS, JSON.stringify({ profile: profileId }), 'utf8');
  return readPerformancePreference();
}

function markUserActivity() {
  lastUserActivityAt = Date.now();
  sendAvatarPerformanceSettings();
}

function getEffectiveAvatarPerformance() {
  const base = readPerformancePreference().effective;
  const avatarVisible = Boolean(avatarWindow && !avatarWindow.isDestroyed() && avatarWindow.isVisible());
  const idle = Date.now() - lastUserActivityAt > PERFORMANCE_IDLE_AFTER_MS
    && currentAvatarState === 'idle'
    && !spotifyPlaying;
  return {
    ...base,
    avatarFps: idle ? base.idleAvatarFps : base.avatarFps,
    idle,
    paused: !avatarVisible,
  };
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

function readIntegrationPreference() {
  try {
    const raw = fs.readFileSync(INTEGRATION_PREFS, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      wakewordEnabled: parsed?.wakewordEnabled === undefined ? false : Boolean(parsed?.wakewordEnabled),
      spotifyActionsEnabled: parsed?.spotifyActionsEnabled === undefined ? true : Boolean(parsed?.spotifyActionsEnabled),
    };
  } catch (_) {
    return { wakewordEnabled: false, spotifyActionsEnabled: true };
  }
}

function writeIntegrationPreference(prefs = {}) {
  const prev = readIntegrationPreference();
  const next = {
    wakewordEnabled: prefs.wakewordEnabled === undefined ? prev.wakewordEnabled : Boolean(prefs.wakewordEnabled),
    spotifyActionsEnabled: prefs.spotifyActionsEnabled === undefined ? prev.spotifyActionsEnabled : Boolean(prefs.spotifyActionsEnabled),
  };
  fs.writeFileSync(INTEGRATION_PREFS, JSON.stringify(next), 'utf8');
  return next;
}

function getLaunchOnStartupPreference() {
  return app.getLoginItemSettings().openAtLogin;
}

function setLaunchOnStartupPreference(enabled) {
  const openAtLogin = Boolean(enabled);
  app.setLoginItemSettings({
    openAtLogin,
    path: process.execPath,
  });
  return { enabled: app.getLoginItemSettings().openAtLogin };
}

function readDiscordPreference() {
  try {
    const raw = fs.readFileSync(DISCORD_PREFS, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed?.enabled === undefined ? true : Boolean(parsed.enabled),
    };
  } catch (_) {
    return { enabled: true };
  }
}

function writeDiscordPreference(prefs = {}) {
  const prev = readDiscordPreference();
  const next = {
    enabled: prefs.enabled !== undefined ? Boolean(prefs.enabled) : prev.enabled,
  };
  fs.writeFileSync(DISCORD_PREFS, JSON.stringify(next), 'utf8');
  return next;
}

function readEnvValue(key) {
  const candidates = [
    path.join(path.dirname(process.execPath), '.env'),
    path.join(app.getPath('userData'), '.env'),
    path.join(ROOT_DIR, '.env'),
  ];
  for (const envPath of candidates) {
    try {
      if (!fs.existsSync(envPath)) continue;
      const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        if (trimmed.slice(0, eq).trim() !== key) continue;
        return trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      }
    } catch (_) {
    }
  }
  return process.env[key] || '';
}

function getDiscordClientId() {
  return readEnvValue('DISCORD_CLIENT_ID').trim();
}

function getDiscordStatus() {
  const prefs = readDiscordPreference();
  return { ...prefs, configured: Boolean(getDiscordClientId()), connected: discordConnected };
}

function discordPresenceText() {
  const profile = readProfilePreference();
  const botName = profile.botName || 'Asuka';
  if (spotifyPlaying) {
    return { details: `${botName} Desktop`, state: 'Bailando con Spotify' };
  }
  if (currentAvatarState === 'listening') {
    return { details: `${botName} Desktop`, state: 'Escuchando al usuario' };
  }
  if (currentAvatarState === 'thinking') {
    return { details: `${botName} Desktop`, state: 'Pensando una respuesta' };
  }
  if (currentAvatarState === 'speaking') {
    return { details: `${botName} Desktop`, state: 'Hablando con el usuario' };
  }
  return { details: `${botName} Desktop`, state: 'Acompañando en el escritorio' };
}

function updateDiscordPresence() {
  if (!discordClient || !discordConnected) return;
  const text = discordPresenceText();
  discordClient.setActivity({
    details: text.details,
    state: text.state,
    startTimestamp: discordStartTimestamp || Date.now(),
    instance: false,
  }).catch(() => {});
}

function stopDiscordPresence() {
  if (discordReconnectTimer) {
    clearTimeout(discordReconnectTimer);
    discordReconnectTimer = null;
  }
  const client = discordClient;
  discordClient = null;
  discordConnected = false;
  if (client) {
    try {
      client.clearActivity?.();
      client.destroy?.();
    } catch (_) {
    }
  }
}

function scheduleDiscordReconnect() {
  if (discordReconnectTimer) return;
  discordReconnectTimer = setTimeout(() => {
    discordReconnectTimer = null;
    startDiscordPresence();
  }, 15000);
}

function startDiscordPresence() {
  const prefs = readDiscordPreference();
  const clientId = getDiscordClientId();
  if (!prefs.enabled || !clientId) {
    stopDiscordPresence();
    return;
  }
  if (discordClient) return;

  discordStartTimestamp = discordStartTimestamp || Date.now();
  DiscordRPC.register(clientId);
  const client = new DiscordRPC.Client({ transport: 'ipc' });
  discordClient = client;

  client.on('ready', () => {
    discordConnected = true;
    updateDiscordPresence();
  });
  client.on('disconnected', () => {
    discordConnected = false;
    discordClient = null;
    scheduleDiscordReconnect();
  });

  client.login({ clientId }).catch(() => {
    if (discordClient === client) {
      discordClient = null;
      discordConnected = false;
      scheduleDiscordReconnect();
    }
  });
}

function listAvatarModels() {
  const userModelsDir = path.join(app.getPath('userData'), 'models');
  const buckets = [
    { folder: userModelsDir, urlPrefix: 'file://user-models/', source: 'user' },
    { folder: path.join(ROOT_DIR, 'assets', 'models'), urlPrefix: '../../assets/models/', source: 'assets-models' },
    { folder: path.join(ROOT_DIR, 'assets'), urlPrefix: '../../assets/', source: 'assets-root' },
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
      const absPath = path.join(bucket.folder, name);
      const url = bucket.urlPrefix === 'file://user-models/'
        ? pathToFileURL(absPath).href
        : `${bucket.urlPrefix}${name}`;
      items.push({
        id: name,
        name,
        label: path.basename(name, path.extname(name)),
        url,
        source: bucket.source,
        isCustom: bucket.source === 'user',
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

function ensureUserModelsDir() {
  const target = path.join(app.getPath('userData'), 'models');
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function sanitizeVrmBasename(inputName) {
  const raw = String(inputName || '').trim();
  const ext = path.extname(raw).toLowerCase();
  const base = path.basename(raw, ext);
  const safeBase = base
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'custom_model';
  return `${safeBase}.vrm`;
}

function copyVrmToUserModels(sourcePath) {
  const source = String(sourcePath || '');
  const ext = path.extname(source).toLowerCase();
  if (ext !== '.vrm') throw new Error('Solo puedes subir archivos .vrm');
  const stat = fs.statSync(source);
  if (!stat.isFile()) throw new Error('El archivo seleccionado no es valido.');
  if (stat.size > MAX_CUSTOM_VRM_SIZE_BYTES) throw new Error('El modelo supera 120 MB.');

  const modelsDir = ensureUserModelsDir();
  const safeName = sanitizeVrmBasename(path.basename(source));
  const parsed = path.parse(safeName);
  let finalName = `${parsed.name}${parsed.ext}`;
  let finalPath = path.join(modelsDir, finalName);
  let i = 1;
  while (fs.existsSync(finalPath)) {
    finalName = `${parsed.name}_${i}${parsed.ext}`;
    finalPath = path.join(modelsDir, finalName);
    i += 1;
  }
  fs.copyFileSync(source, finalPath);
  return { name: finalName, path: finalPath };
}

function deleteUserVrmModel(modelName) {
  const clean = String(modelName || '').trim();
  if (!clean || !clean.toLowerCase().endsWith('.vrm')) {
    throw new Error('Modelo invalido.');
  }
  const modelsDir = ensureUserModelsDir();
  const fullPath = path.join(modelsDir, path.basename(clean));
  if (!fs.existsSync(fullPath)) {
    throw new Error('Ese modelo custom no existe.');
  }
  fs.unlinkSync(fullPath);
  return { name: path.basename(clean) };
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
  const iconPath = fs.existsSync(APP_ICON_PNG) ? APP_ICON_PNG : undefined;
  return {
    transparent: true,
    frame: false,
    resizable: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    ...extra,
  };
}

function createAvatarWindow() {
  if (avatarWindow && !avatarWindow.isDestroyed()) {
    return avatarWindow;
  }
  const windowPrefs = readAvatarWindowPreference();
  const initialBounds = resolveAvatarInitialBounds(windowPrefs.bounds);
  avatarWindow = new BrowserWindow(baseWindowOptions({
    x: initialBounds.x,
    y: initialBounds.y,
    width: initialBounds.width,
    height: initialBounds.height,
    minWidth: 150,
    minHeight: 240,
    alwaysOnTop: windowPrefs.alwaysOnTop,
    skipTaskbar: false,
  }));

  avatarWindow.loadFile(path.join(__dirname, '..', 'renderer', 'avatar.html'));
  avatarWindow.webContents.once('did-finish-load', () => {
    const model = getCurrentAvatarModelEntry();
    if (model) broadcastAvatarModel(model.name);
    sendAvatarPerformanceSettings();
  });
  avatarWindow.on('show', () => {
    markUserActivity();
    startGlobalCursorTracking();
  });
  avatarWindow.on('hide', () => {
    stopGlobalCursorTracking();
    sendAvatarPerformanceSettings();
  });
  avatarWindow.on('moved', saveAvatarWindowBounds);
  avatarWindow.on('resized', saveAvatarWindowBounds);
  avatarWindow.on('closed', () => {
    stopGlobalCursorTracking();
    avatarWindow = null;
  });
  return avatarWindow;
}

function createChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    return chatWindow;
  }
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
  return chatWindow;
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.show();
    return;
  }
  settingsWindow = new BrowserWindow(baseWindowOptions({
    width: 900,
    height: 820,
    minWidth: 700,
    minHeight: 700,
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
    width: 920,
    height: 780,
    minWidth: 560,
    minHeight: 620,
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
  if (win.isVisible()) {
    win.hide();
  } else {
    win.show();
    markUserActivity();
  }
}

function showChatWindow() {
  if (!chatWindow || chatWindow.isDestroyed()) createChatWindow();
  chatWindow.show();
  chatWindow.focus();
}

function showAvatarWindow() {
  if (!avatarWindow || avatarWindow.isDestroyed()) createAvatarWindow();
  avatarWindow.show();
}

function createTray() {
  if (tray) return;
  const iconPath = fs.existsSync(APP_ICON_PNG) ? APP_ICON_PNG : undefined;
  if (!iconPath) return;

  tray = new Tray(iconPath);
  tray.setToolTip('Asuka Desktop');

  const refreshMenu = () => {
    const chatVisible = Boolean(chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible());
    const avatarVisible = Boolean(avatarWindow && !avatarWindow.isDestroyed() && avatarWindow.isVisible());
    const menu = Menu.buildFromTemplate([
      {
        label: chatVisible ? 'Ocultar chat' : 'Mostrar chat',
        click: () => toggleWindow(chatWindow || createChatWindow()),
      },
      {
        label: avatarVisible ? 'Ocultar avatar' : 'Mostrar avatar',
        click: () => toggleWindow(avatarWindow || createAvatarWindow()),
      },
      { type: 'separator' },
      {
        label: 'Abrir configuracion',
        click: () => createSettingsWindow(),
      },
      { type: 'separator' },
      {
        label: 'Salir',
        click: () => app.quit(),
      },
    ]);
    tray.setContextMenu(menu);
  };

  tray.on('click', () => showChatWindow());
  tray.on('right-click', refreshMenu);
  refreshMenu();
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
  saveAvatarWindowBounds();
}

function updateAvatarState(state) {
  if (!avatarWindow) createAvatarWindow();
  currentAvatarState = String(state || 'idle').toLowerCase();
  if (currentAvatarState !== 'idle') markUserActivity();
  updateDiscordPresence();

  const send = () => avatarWindow?.webContents.send('rainy:avatar-state', state);
  if (avatarWindow.webContents.isLoading()) {
    avatarWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
  sendAvatarPerformanceSettings();
}

function updateAvatarSpotifyPlayback(isPlaying) {
  if (!avatarWindow) createAvatarWindow();
  spotifyPlaying = Boolean(isPlaying);
  if (spotifyPlaying) markUserActivity();
  updateDiscordPresence();
  const send = () => avatarWindow?.webContents.send('rainy:spotify-playback', { isPlaying: spotifyPlaying });
  if (avatarWindow.webContents.isLoading()) {
    avatarWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function sendAvatarPerformanceSettings() {
  if (!avatarWindow || avatarWindow.isDestroyed()) return;
  const payload = getEffectiveAvatarPerformance();
  const send = () => avatarWindow?.webContents.send('rainy:performance-preferences', payload);
  if (avatarWindow.webContents.isLoading()) {
    avatarWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function stopGlobalCursorTracking() {
  if (!cursorTrackingId) return;
  clearInterval(cursorTrackingId);
  cursorTrackingId = null;
}

function startGlobalCursorTracking() {
  if (cursorTrackingId) return;
  if (!avatarWindow || avatarWindow.isDestroyed() || !avatarWindow.isVisible()) return;
  const intervalMs = Math.round(1000 / readPerformancePreference().effective.cursorFps);
  cursorTrackingId = setInterval(() => {
    if (!avatarWindow || avatarWindow.isDestroyed() || !avatarWindow.isVisible()) return;
    if (avatarWindow.webContents.isLoading()) return;

    avatarWindow.webContents.send('rainy:global-cursor', {
      cursor: screen.getCursorScreenPoint(),
      bounds: avatarWindow.getBounds(),
    });
  }, intervalMs);
}

function startSpotifyMonitor() {
  if (process.platform !== 'win32' || spotifyMonitorId) return;
  const tick = async () => {
    if (spotifyCheckInFlight) {
      spotifyMonitorId = setTimeout(tick, readPerformancePreference().effective.spotifyIntervalMs);
      return;
    }
    spotifyCheckInFlight = true;
    let nextIntervalMs = readPerformancePreference().effective.spotifyInactiveIntervalMs;
    try {
      const result = await queryWindowsSpotifyPlaying();
      nextIntervalMs = result.spotifyOpen
        ? readPerformancePreference().effective.spotifyIntervalMs
        : readPerformancePreference().effective.spotifyInactiveIntervalMs;
      if (result.playing !== spotifyPlaying) {
        updateAvatarSpotifyPlayback(result.playing);
      }
      if (result.playing && result.title && result.title !== spotifyTitle) {
        spotifyTitle = result.title;
        if (spotifyPlaying) notifyAvatarTrackChanged();
      }
      if (!result.playing) spotifyTitle = '';
    } catch (_) {
      if (spotifyPlaying) updateAvatarSpotifyPlayback(false);
    } finally {
      spotifyCheckInFlight = false;
      if (spotifyMonitorId) spotifyMonitorId = setTimeout(tick, nextIntervalMs);
    }
  };
  spotifyMonitorId = setTimeout(tick, 0);
}

function applyPerformancePreference() {
  stopGlobalCursorTracking();
  startGlobalCursorTracking();
  stopSpotifyMonitor();
  startSpotifyMonitor();
  sendAvatarPerformanceSettings();
}

setInterval(() => {
  sendAvatarPerformanceSettings();
}, 30000);

function notifyAvatarTrackChanged() {
  if (!avatarWindow || avatarWindow.isDestroyed()) return;
  if (avatarWindow.webContents.isLoading()) return;
  avatarWindow.webContents.send('rainy:spotify-track-changed');
}

function stopSpotifyMonitor() {
  if (!spotifyMonitorId) return;
  clearTimeout(spotifyMonitorId);
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
    if (!readIntegrationPreference().spotifyActionsEnabled) throw new Error('Las acciones de Spotify estan desactivadas en Integraciones.');
    if (!payload) throw new Error('Falta la busqueda de Spotify.');
    await openSpotifySearch(payload);
    return { ok: true, message: `Busqueda abierta en Spotify: ${payload}` };
  }

  if (type === 'SPOTIFY_SEARCH_AND_PLAY') {
    if (!readIntegrationPreference().spotifyActionsEnabled) throw new Error('Las acciones de Spotify estan desactivadas en Integraciones.');
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
  Write-Output "closed|"
  exit 0
}
$titles = Get-Process -Name "Spotify" -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0 } |
  Select-Object -ExpandProperty MainWindowTitle
if (-not $titles -or $titles.Count -eq 0) {
  Write-Output "open|"
  exit 0
}
$candidate = ($titles | Sort-Object Length -Descending | Select-Object -First 1).Trim()
if ($candidate -match "^(Spotify|Spotify Premium|Spotify Free)$") {
  Write-Output "open|"
  exit 0
}
Write-Output "playing|$candidate"
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
    child.on('error', () => resolve({ playing: false, title: '' }));
    child.on('exit', () => {
      const line = stdout.trim();
      const sep = line.indexOf('|');
      const status = sep >= 0 ? line.substring(0, sep) : line;
      const title = sep >= 0 ? line.substring(sep + 1).trim() : '';
      const cleanStatus = status.toLowerCase();
      resolve({ playing: cleanStatus === 'playing', spotifyOpen: cleanStatus !== 'closed', title });
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
  startDiscordPresence();
}

app.setName('Asuka Desktop');

app.whenReady().then(() => {
  startBackend();
  createTray();
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
  stopGlobalCursorTracking();
  stopSpotifyMonitor();
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  tray?.destroy();
  tray = null;
  stopDiscordPresence();
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

function sendAvatarReaction(name) {
  if (!avatarWindow) createAvatarWindow();
  const clean = String(name || '').trim();
  if (!clean) return;
  const send = () => avatarWindow?.webContents.send('rainy:avatar-reaction', clean);
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
  if (win === avatarWindow) {
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
  const existing = readProfilePreference();
  const isFirstSetupCompletion = !existing.setupCompleted;
  const personalityCandidate = {
    personalityPreset: payload?.personalityPreset ?? existing.personalityPreset,
    personalityCustom: payload?.personalityCustom ?? existing.personalityCustom,
  };
  const personalityNorm = normalizePersonalityForSave(personalityCandidate, existing);
  if (!personalityNorm.ok) {
    return personalityNorm;
  }
  const next = writeProfilePreference({
    botName: payload?.botName,
    userName: payload?.userName,
    model: selected.name,
    setupCompleted: true,
    personalityPreset: personalityNorm.personalityPreset,
    personalityCustom: personalityNorm.personalityCustom,
    privacyAccepted: Boolean(payload?.privacyAccepted),
    privacyAcceptedAt: payload?.privacyAcceptedAt || new Date().toISOString(),
  });
  try {
    writeAvatarModelPreference(selected.name);
  } catch (_) {
  }
  broadcastAvatarModel(selected.name);
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.close();
  }
  if (isFirstSetupCompletion) {
    pendingSetupWelcomeGreeting = true;
  }
  if (!avatarWindow || !chatWindow) {
    startNormalUi();
  }
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send('rainy:profile-update', next);
  }
  return { ok: true, profile: next };
});

ipcMain.handle('profile:patch', (_event, patch) => {
  const existing = readProfilePreference();
  const merged = {
    botName: existing.botName,
    userName: existing.userName,
    model: existing.model,
    setupCompleted: existing.setupCompleted,
    privacyAccepted: existing.privacyAccepted,
    privacyAcceptedAt: existing.privacyAcceptedAt,
    personalityPreset:
      patch && patch.personalityPreset !== undefined && patch.personalityPreset !== null
        ? patch.personalityPreset
        : existing.personalityPreset,
    personalityCustom:
      patch && patch.personalityCustom !== undefined && patch.personalityCustom !== null
        ? patch.personalityCustom
        : existing.personalityCustom,
  };
  const personalityNorm = normalizePersonalityForSave(merged, existing);
  if (!personalityNorm.ok) {
    return personalityNorm;
  }
  const next = writeProfilePreference({
    ...merged,
    personalityPreset: personalityNorm.personalityPreset,
    personalityCustom: personalityNorm.personalityCustom,
  });
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

ipcMain.handle('discord:get-preferences', () => getDiscordStatus());

ipcMain.handle('discord:set-preferences', (_event, patch) => {
  const prefs = writeDiscordPreference(patch || {});
  stopDiscordPresence();
  if (prefs.enabled && getDiscordClientId()) startDiscordPresence();
  return { ok: true, preferences: getDiscordStatus() };
});

ipcMain.handle('integrations:get-preferences', () => readIntegrationPreference());

ipcMain.handle('integrations:set-preferences', (_event, patch) => ({
  ok: true,
  preferences: writeIntegrationPreference(patch || {}),
}));

ipcMain.handle('performance:get-preferences', () => readPerformancePreference());

ipcMain.handle('performance:set-preferences', (_event, patch) => {
  const prefs = writePerformancePreference(patch || {});
  applyPerformancePreference();
  return { ok: true, preferences: prefs };
});

ipcMain.handle('startup:get-enabled', () => getLaunchOnStartupPreference());

ipcMain.handle('startup:set-enabled', (_event, enabled) => setLaunchOnStartupPreference(enabled));

ipcMain.handle('chat:open-session', (_event, sessionId) => {
  if (!chatWindow || chatWindow.isDestroyed()) createChatWindow();
  chatWindow.show();
  const cleanSessionId = Number(sessionId) || 0;
  const send = () => chatWindow?.webContents.send('rainy:open-chat-session', cleanSessionId);
  if (chatWindow.webContents.isLoading()) {
    chatWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
  return true;
});

ipcMain.handle('window:toggle-chat', () => {
  markUserActivity();
  if (!chatWindow) createChatWindow();
  const next = !chatWindow.isVisible();
  if (next) chatWindow.show();
  else chatWindow.hide();
  return next;
});

ipcMain.handle('window:toggle-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  if (win.isMaximized()) {
    win.unmaximize();
    return false;
  }
  win.maximize();
  return true;
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
  if (win === avatarWindow) saveAvatarWindowBounds();
});

ipcMain.handle('avatar:speak', (_event, payload) => {
  markUserActivity();
  sendToAvatar(payload);
});

ipcMain.handle('avatar:consume-startup-greeting-kind', () => {
  if (pendingSetupWelcomeGreeting) {
    pendingSetupWelcomeGreeting = false;
    return 'setup';
  }
  return 'normal';
});

ipcMain.handle('avatar:get-always-on-top', () => {
  if (!avatarWindow || avatarWindow.isDestroyed()) createAvatarWindow();
  return Boolean(avatarWindow?.isAlwaysOnTop());
});

ipcMain.handle('avatar:set-always-on-top', (_event, enabled) => {
  if (!avatarWindow || avatarWindow.isDestroyed()) createAvatarWindow();
  avatarWindow.setAlwaysOnTop(Boolean(enabled));
  writeAvatarWindowPreference({ alwaysOnTop: Boolean(enabled) });
  return { enabled: Boolean(avatarWindow.isAlwaysOnTop()) };
});

ipcMain.handle('avatar:reset-window-position', () => ({ ok: true, bounds: resetAvatarWindowBounds() }));

ipcMain.handle('avatar:wakeword-triggered', () => {
  markUserActivity();
  sendToAvatarWakeword();
  return true;
});

ipcMain.handle('avatar:reaction', (_event, name) => {
  markUserActivity();
  sendAvatarReaction(name);
  return true;
});

ipcMain.handle('avatar:interaction', () => {
  markUserActivity();
  return true;
});

ipcMain.handle('avatar:context-menu', () => {
  markUserActivity();
  const menu = Menu.buildFromTemplate([
    {
      label: 'Mostrar chat',
      click: () => showChatWindow(),
    },
    {
      label: 'Configuracion',
      click: () => createSettingsWindow(),
    },
  ]);
  menu.popup({ window: avatarWindow || undefined });
  return true;
});

ipcMain.handle('avatar:speech-status', (_event, payload) => {
  markUserActivity();
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

ipcMain.handle('avatar:upload-model', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Selecciona un modelo VRM',
    properties: ['openFile'],
    filters: [{ name: 'VRM', extensions: ['vrm'] }],
  });
  if (result.canceled || !result.filePaths.length) {
    return { ok: false, cancelled: true, message: 'Carga cancelada.' };
  }
  try {
    const copied = copyVrmToUserModels(result.filePaths[0]);
    return { ok: true, model: copied.name, message: `Modelo subido: ${copied.name}` };
  } catch (error) {
    return { ok: false, message: error.message || 'No se pudo subir el modelo.' };
  }
});

ipcMain.handle('avatar:delete-model', (_event, modelName) => {
  try {
    const deleted = deleteUserVrmModel(modelName);
    const activeName = getCurrentAvatarModel();
    if (deleted.name.toLowerCase() === String(activeName || '').toLowerCase()) {
      const fallback = resolveAvatarModelSelection(DEFAULT_AVATAR_MODEL);
      if (fallback) {
        currentAvatarModel = fallback.name;
        writeAvatarModelPreference(fallback.name);
        const profile = readProfilePreference();
        const nextProfile = writeProfilePreference({ ...profile, model: fallback.name });
        broadcastAvatarModel(fallback.name);
        if (chatWindow && !chatWindow.isDestroyed()) {
          chatWindow.webContents.send('rainy:profile-update', nextProfile);
        }
      } else {
        currentAvatarModel = null;
      }
    }
    return { ok: true, deleted: deleted.name, currentModel: getCurrentAvatarModel() };
  } catch (error) {
    return { ok: false, message: error.message || 'No se pudo eliminar el modelo.' };
  }
});

ipcMain.handle('system:execute-action', async (_event, action) => {
  try {
    return await executeAction(action);
  } catch (error) {
    return { ok: false, message: error.message || 'No se pudo ejecutar la accion.' };
  }
});
