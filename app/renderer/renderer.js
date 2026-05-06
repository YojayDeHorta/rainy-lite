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
  y: 1.03,
  scale: 0.85,
  cameraZ: 3.4,
  light: 0.75,
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
let isAssistantBusy = false;
let wakewordPollingId = null;
let wakewordEnabled = false;
let wakewordReady = false;
let wakewordCooldownUntil = 0;
let conversationSessionActive = false;
let conversationAwaitingSpeechEnd = false;
let conversationAutoListenTimer = null;
let conversationLastActivityAt = 0;
let conversationSource = 'manual';
let endpointAudioContext = null;
let endpointAnalyser = null;
let endpointSource = null;
let endpointIntervalId = null;
let endpointSilenceMs = 0;
let endpointLastTick = 0;
let endpointStartedAt = 0;
let endpointSpeechStarted = false;
let endpointStopCallback = null;

const ENDPOINT_RMS_THRESHOLD = 0.028;
const ENDPOINT_SILENCE_MS = 1000;
const ENDPOINT_GRACE_MS = 650;
const ENDPOINT_MAX_MS = 15000;
const ENDPOINT_TICK_MS = 50;
const CONVERSATION_REOPEN_DELAY_MS = 550;
const CONVERSATION_IDLE_TIMEOUT_MS = 30000;
const GOODBYE_RE = /\b(adios|adiós|chao|hasta luego|nos vemos|bye|gracias(,)? eso es todo)\b/i;

function updateConversationActivity() {
  conversationLastActivityAt = Date.now();
}

function stopConversationSession() {
  conversationSessionActive = false;
  conversationAwaitingSpeechEnd = false;
  conversationSource = 'manual';
  if (conversationAutoListenTimer) {
    clearTimeout(conversationAutoListenTimer);
    conversationAutoListenTimer = null;
  }
}

function scheduleConversationAutorecord() {
  if (!conversationSessionActive || !conversationAwaitingSpeechEnd) return;
  if (isRecording || isAssistantBusy) return;
  if (Date.now() - conversationLastActivityAt > CONVERSATION_IDLE_TIMEOUT_MS) {
    stopConversationSession();
    return;
  }
  if (conversationAutoListenTimer) clearTimeout(conversationAutoListenTimer);
  conversationAutoListenTimer = setTimeout(async () => {
    conversationAutoListenTimer = null;
    if (!conversationSessionActive || !conversationAwaitingSpeechEnd || isRecording || isAssistantBusy) return;
    conversationAwaitingSpeechEnd = false;
    subtitle.textContent = 'Sigo aqui, te escucho...';
    await toggleRecording({ source: 'conversation' });
  }, CONVERSATION_REOPEN_DELAY_MS);
}

function normalizeConversationMeta(data) {
  const meta = data?.conversation || {};
  const reason = String(meta.reason || 'uncertain').toLowerCase();
  return {
    continue: Boolean(meta.continue),
    reason: ['followup', 'goodbye', 'one_shot', 'uncertain'].includes(reason) ? reason : 'uncertain',
  };
}

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

  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    const isDark = localStorage.getItem('rainy-dark-theme') === 'true';
    themeToggle.checked = isDark;
    document.body.classList.toggle('dark-theme', isDark);

    themeToggle.addEventListener('change', () => {
      const dark = themeToggle.checked;
      localStorage.setItem('rainy-dark-theme', dark);
      document.body.classList.toggle('dark-theme', dark);
    });
  }
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
        await fetchWakewordStatus();
        startWakewordPolling();
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
  subtitle.textContent = 'Asuka esta pensando...';
  setAvatarState('thinking');
  isAssistantBusy = true;
  updateConversationActivity();

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    const reply = data.response || '[NEUTRAL] Me quede sin palabras por un segundo.';
    const conversation = normalizeConversationMeta(data);
    const emotion = parseEmotion(reply);
    const action = parseAction(reply);
    const clean = stripTags(reply);
    subtitle.textContent = clean;
    addMessage('assistant', reply);
    if (action) await executeAction(action);
    await window.rainyDesktop.speakOnAvatar({ text: clean, emotion });
    if (conversation.continue && conversation.reason === 'followup' && !action) {
      conversationSessionActive = true;
      conversationAwaitingSpeechEnd = true;
    } else {
      stopConversationSession();
    }
  } catch (error) {
    subtitle.textContent = 'Algo fallo hablando con mi backend local.';
    setAvatarState('idle');
    stopConversationSession();
    console.error(error);
  } finally {
    isAssistantBusy = false;
  }
}

async function toggleRecording(options = {}) {
  const source = String(options?.source || 'manual');
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
      stopSpeechEndpointing();
      isRecording = false;
      isAssistantBusy = true;
      voiceButton.classList.remove('recording');
      stream.getTracks().forEach((track) => track.stop());
      subtitle.textContent = 'Transcribiendo...';
      setAvatarState('thinking');
      await transcribeAndSend(new Blob(chunks, { type: 'audio/webm' }));
    };

    mediaRecorder.start();
    startSpeechEndpointing(stream, () => {
      if (mediaRecorder?.state === 'recording') {
        subtitle.textContent = 'Entendido, procesando...';
        mediaRecorder.stop();
      }
    });
    isRecording = true;
    voiceButton.classList.add('recording');
    subtitle.textContent = 'Te escucho... pulsa otra vez para terminar.';
    setAvatarState('listening');
    conversationSource = source;
    updateConversationActivity();
  } catch (error) {
    stopSpeechEndpointing();
    subtitle.textContent = 'No pude acceder al microfono.';
    setAvatarState('idle');
    if (source === 'conversation') stopConversationSession();
    console.error(error);
  }
}

function startSpeechEndpointing(stream, onEndSpeech) {
  stopSpeechEndpointing();
  endpointStopCallback = onEndSpeech;
  endpointAudioContext = new AudioContext();
  endpointSource = endpointAudioContext.createMediaStreamSource(stream);
  endpointAnalyser = endpointAudioContext.createAnalyser();
  endpointAnalyser.fftSize = 1024;
  endpointAnalyser.smoothingTimeConstant = 0.35;
  endpointSource.connect(endpointAnalyser);
  endpointSilenceMs = 0;
  endpointLastTick = performance.now();
  endpointStartedAt = performance.now();
  endpointSpeechStarted = false;
  const data = new Float32Array(endpointAnalyser.fftSize);

  const tick = () => {
    if (!endpointAnalyser || !isRecording) return;
    endpointAnalyser.getFloatTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i += 1) {
      sumSquares += data[i] * data[i];
    }
    const rms = Math.sqrt(sumSquares / data.length);
    const now = performance.now();
    const dt = now - endpointLastTick;
    endpointLastTick = now;
    const elapsed = now - endpointStartedAt;

    if (rms >= ENDPOINT_RMS_THRESHOLD) {
      endpointSpeechStarted = true;
      endpointSilenceMs = 0;
    } else if (endpointSpeechStarted && elapsed > ENDPOINT_GRACE_MS) {
      endpointSilenceMs += dt;
    }

    if (elapsed >= ENDPOINT_MAX_MS) {
      endpointStopCallback?.();
      return;
    }

    if (endpointSpeechStarted && endpointSilenceMs >= ENDPOINT_SILENCE_MS) {
      endpointStopCallback?.();
    }
  };

  endpointIntervalId = setInterval(tick, ENDPOINT_TICK_MS);
}

function stopSpeechEndpointing() {
  if (endpointIntervalId) clearInterval(endpointIntervalId);
  endpointIntervalId = null;
  endpointStopCallback = null;
  try {
    endpointSource?.disconnect();
    endpointAnalyser?.disconnect();
  } catch (_) {
    // no-op
  }
  endpointSource = null;
  endpointAnalyser = null;
  if (endpointAudioContext) {
    endpointAudioContext.close().catch(() => {});
  }
  endpointAudioContext = null;
  endpointSilenceMs = 0;
  endpointSpeechStarted = false;
}

async function fetchWakewordStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/wakeword/status`);
    if (!res.ok) return;
    const data = await res.json();
    wakewordEnabled = Boolean(data.enabled);
    wakewordReady = Boolean(data.ready);
  } catch (_) {
    wakewordEnabled = false;
    wakewordReady = false;
  }
}

async function pollWakewordTrigger() {
  if (!wakewordEnabled) return;
  try {
    const res = await fetch(`${API_BASE}/api/wakeword/consume`, { method: 'POST' });
    if (!res.ok) return;
    const data = await res.json();
    wakewordEnabled = Boolean(data.enabled);
    wakewordReady = Boolean(data.ready);
    if (!wakewordReady) return;
    if (!data.triggered) return;
    if (Date.now() < wakewordCooldownUntil) return;
    if (isRecording) return;
    wakewordCooldownUntil = Date.now() + 3000;
    conversationSessionActive = true;
    conversationAwaitingSpeechEnd = false;
    conversationSource = 'wakeword';
    updateConversationActivity();
    try {
      window.rainyDesktop?.notifyWakewordTriggered?.();
    } catch (_) {
      // ignore
    }
    subtitle.textContent = 'Wake word detectada. Te escucho...';
    await toggleRecording({ source: 'wakeword' });
  } catch (_) {
    // ignore transient wakeword polling errors
  }
}

function startWakewordPolling() {
  if (wakewordPollingId) return;
  wakewordPollingId = setInterval(() => {
    if (!wakewordEnabled) {
      void fetchWakewordStatus();
      return;
    }
    void pollWakewordTrigger();
  }, 400);
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
    const transcript = String(data.text || '').trim();
    if (!transcript) {
      setAvatarState('idle');
      stopConversationSession();
      return;
    }
    if (GOODBYE_RE.test(transcript)) {
      subtitle.textContent = 'Entendido, cierro la conversacion por voz.';
      setAvatarState('idle');
      stopConversationSession();
      return;
    }
    updateConversationActivity();
    await sendMessage(transcript);
  } catch (error) {
    subtitle.textContent = 'No pude transcribir el audio.';
    setAvatarState('idle');
    stopConversationSession();
    console.error(error);
  } finally {
    isAssistantBusy = false;
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
window.rainyDesktop.onAvatarSpeechStatus((payload) => {
  const event = String(payload?.event || '').toLowerCase();
  if (event === 'start') {
    updateConversationActivity();
    return;
  }
  if (event === 'end') {
    updateConversationActivity();
    scheduleConversationAutorecord();
  }
});

initAvatarSettings();
setAvatarState('idle');
waitForBackend();
