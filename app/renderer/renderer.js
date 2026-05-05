const API_BASE = 'http://127.0.0.1:8765';

const chatLog = document.getElementById('chat-log');
const input = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const voiceButton = document.getElementById('voice-button');
const subtitle = document.getElementById('subtitle');
const statusDot = document.getElementById('status-dot');
const settingsPanel = document.getElementById('avatar-settings');
const settingsButton = document.getElementById('settings-button');
const avatarResetButton = document.getElementById('avatar-reset-button');

const AVATAR_SETTINGS_KEY = 'rainy-avatar-settings-v1';
const DEFAULT_AVATAR_SETTINGS = {
  x: 0,
  y: -0.45,
  scale: 1.0,
  cameraZ: 3.4,
  light: 0.65,
  motion: 1.0,
};

const avatarControls = {
  x: document.getElementById('avatar-x'),
  y: document.getElementById('avatar-y'),
  scale: document.getElementById('avatar-scale'),
  cameraZ: document.getElementById('avatar-camera'),
  light: document.getElementById('avatar-light'),
  motion: document.getElementById('avatar-motion'),
};

const avatarValueLabels = {
  x: document.getElementById('avatar-x-value'),
  y: document.getElementById('avatar-y-value'),
  scale: document.getElementById('avatar-scale-value'),
  cameraZ: document.getElementById('avatar-camera-value'),
  light: document.getElementById('avatar-light-value'),
  motion: document.getElementById('avatar-motion-value'),
};

let mediaRecorder = null;
let chunks = [];
let isRecording = false;

function loadAvatarSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AVATAR_SETTINGS_KEY) || '{}');
    return { ...DEFAULT_AVATAR_SETTINGS, ...parsed };
  } catch (_) {
    return { ...DEFAULT_AVATAR_SETTINGS };
  }
}

function saveAvatarSettings(settings) {
  localStorage.setItem(AVATAR_SETTINGS_KEY, JSON.stringify(settings));
}

function syncAvatarSettingsUI(settings) {
  for (const [key, control] of Object.entries(avatarControls)) {
    control.value = String(settings[key]);
    avatarValueLabels[key].textContent = Number(settings[key]).toFixed(2);
  }
}

function currentAvatarSettingsFromUI() {
  return {
    x: Number(avatarControls.x.value),
    y: Number(avatarControls.y.value),
    scale: Number(avatarControls.scale.value),
    cameraZ: Number(avatarControls.cameraZ.value),
    light: Number(avatarControls.light.value),
    motion: Number(avatarControls.motion.value),
  };
}

function applyAvatarSettings(settings) {
  syncAvatarSettingsUI(settings);
  saveAvatarSettings(settings);
  window.rainyDesktop.updateAvatarSettings(settings);
}

function setAvatarState(state) {
  window.rainyDesktop.setAvatarState(state);
}

function initAvatarSettings() {
  const settings = loadAvatarSettings();
  syncAvatarSettingsUI(settings);
  window.rainyDesktop.updateAvatarSettings(settings);

  for (const control of Object.values(avatarControls)) {
    control.addEventListener('input', () => applyAvatarSettings(currentAvatarSettingsFromUI()));
  }

  settingsButton.addEventListener('click', () => settingsPanel.classList.toggle('hidden'));
  avatarResetButton.addEventListener('click', () => applyAvatarSettings({ ...DEFAULT_AVATAR_SETTINGS }));
}

function addMessage(role, text) {
  const el = document.createElement('div');
  el.className = `message ${role}`;
  el.textContent = stripTags(text);
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function parseAction(text) {
  const match = (text || '').match(/\[ACTION:\s*(\w+)(?:\s+"([\s\S]*?)")?\]/i);
  if (!match) return null;
  return {
    type: match[1].toUpperCase(),
    payload: match[2] || '',
  };
}

function actionLabel(action) {
  const labels = {
    OPEN_URL: 'Abrir URL',
    OPEN_APP: 'Abrir app',
    OPEN_FOLDER: 'Abrir carpeta',
    COPY_TEXT: 'Copiar texto',
    MEDIA_PLAY_PAUSE: 'Play/Pause',
    MEDIA_NEXT: 'Siguiente cancion',
    MEDIA_PREVIOUS: 'Cancion anterior',
    SPOTIFY_SEARCH: 'Buscar en Spotify',
    SPOTIFY_SEARCH_AND_PLAY: 'Buscar y reproducir en Spotify',
    SHOW_AVATAR: 'Mostrar avatar',
    HIDE_AVATAR: 'Ocultar avatar',
  };
  return labels[action.type] || action.type;
}

async function executeAction(action) {
  const card = document.createElement('div');
  card.className = 'action-card running';

  const title = document.createElement('div');
  title.className = 'action-title';
  title.textContent = `Accion: ${actionLabel(action)}`;

  const payload = document.createElement('div');
  payload.className = 'action-payload';
  payload.textContent = action.payload || '(sin parametros)';

  const result = document.createElement('div');
  result.className = 'action-result';
  result.textContent = 'Ejecutando...';

  card.append(title, payload, result);
  chatLog.appendChild(card);
  chatLog.scrollTop = chatLog.scrollHeight;

  const response = await window.rainyDesktop.executeAction(action);
  card.classList.remove('running');
  card.classList.toggle('failed', !response.ok);
  result.textContent = response.message || (response.ok ? 'Accion completada.' : 'No se pudo ejecutar.');
}

function stripTags(text) {
  return (text || '')
    .replace(/^\[(NEUTRAL|HAPPY|SAD|SURPRISED|THINKING|SHY)\]\s*/i, '')
    .replace(/\[ACTION:\s*[^\]]+\]/gi, '')
    .trim();
}

function parseEmotion(text) {
  const match = (text || '').match(/^\[(NEUTRAL|HAPPY|SAD|SURPRISED|THINKING|SHY)\]/i);
  return match ? match[1].toLowerCase() : 'neutral';
}

async function waitForBackend() {
  for (let i = 0; i < 30; i += 1) {
    try {
      const res = await fetch(`${API_BASE}/api/health`);
      if (res.ok) {
        statusDot.classList.add('online');
        return true;
      }
    } catch (_) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  subtitle.textContent = 'No pude conectar con el backend local.';
  return false;
}

async function sendMessage(text) {
  const message = text.trim();
  if (!message) return;

  addMessage('user', message);
  input.value = '';
  subtitle.textContent = 'Rainy esta pensando...';
  setAvatarState('thinking');

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    const reply = data.response || '[NEUTRAL] Me quede sin palabras por un segundo.';
    const emotion = parseEmotion(reply);
    const action = parseAction(reply);
    const clean = stripTags(reply);
    subtitle.textContent = clean;
    addMessage('assistant', reply);
    if (action) await executeAction(action);
    await window.rainyDesktop.speakOnAvatar({ text: clean, emotion });
  } catch (error) {
    subtitle.textContent = 'Algo fallo hablando con mi backend local.';
    setAvatarState('idle');
    console.error(error);
  }
}

async function toggleRecording() {
  if (isRecording) {
    mediaRecorder?.stop();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (event) => chunks.push(event.data);
    mediaRecorder.onstop = async () => {
      isRecording = false;
      voiceButton.classList.remove('recording');
      stream.getTracks().forEach((track) => track.stop());
      subtitle.textContent = 'Transcribiendo...';
      setAvatarState('thinking');
      await transcribeAndSend(new Blob(chunks, { type: 'audio/webm' }));
    };

    mediaRecorder.start();
    isRecording = true;
    voiceButton.classList.add('recording');
    subtitle.textContent = 'Te escucho... pulsa otra vez para terminar.';
    setAvatarState('listening');
  } catch (error) {
    subtitle.textContent = 'No pude acceder al microfono.';
    setAvatarState('idle');
    console.error(error);
  }
}

async function transcribeAndSend(blob) {
  const formData = new FormData();
  formData.append('file', blob, 'recording.webm');

  try {
    const res = await fetch(`${API_BASE}/api/stt`, { method: 'POST', body: formData });
    if (!res.ok) {
      subtitle.textContent = 'STT no esta configurado. Puedes escribir por ahora.';
      setAvatarState('idle');
      return;
    }
    const data = await res.json();
    if (data.text) await sendMessage(data.text);
    else setAvatarState('idle');
  } catch (error) {
    subtitle.textContent = 'No pude transcribir el audio.';
    setAvatarState('idle');
    console.error(error);
  }
}

sendButton.addEventListener('click', () => sendMessage(input.value));
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') sendMessage(input.value);
});
voiceButton.addEventListener('click', toggleRecording);

document.getElementById('min-button').addEventListener('click', () => window.rainyDesktop.minimize());
document.getElementById('close-button').addEventListener('click', () => window.rainyDesktop.close());
document.getElementById('pin-button').addEventListener('click', async () => {
  const active = await window.rainyDesktop.toggleAlwaysOnTop();
  document.getElementById('pin-button').textContent = active ? 'Pin' : 'Free';
});

window.rainyDesktop.onToggleVoice(() => toggleRecording());

initAvatarSettings();
setAvatarState('idle');
waitForBackend();
