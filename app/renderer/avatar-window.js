import { initAvatar, setAvatarEmotion, setAvatarLipSync, setAvatarModel, setAvatarState, triggerAvatarReaction, updateAvatarSettings, updateGlobalCursor, updatePerformanceSettings } from './avatar-vrm.js';

const API_BASE = 'http://127.0.0.1:8765';

const avatarFace = document.getElementById('avatar-face');
const mouth = document.getElementById('mouth');
const wakewordIndicator = document.getElementById('wakeword-indicator');
const chatToggleButton = document.getElementById('chat-toggle-button');

let audioContext = null;
let beepContext = null;
let isSpeaking = false;
let spotifyPlaying = false;
let requestedState = 'idle';
let appliedState = 'idle';
let wakewordIndicatorActive = false;
let wakewordBeepPending = false;

function playWakewordBeep() {
  try {
    if (!beepContext) beepContext = new AudioContext();
    if (beepContext.state === 'suspended') void beepContext.resume();
    const osc = beepContext.createOscillator();
    const gain = beepContext.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(beepContext.destination);
    const t = beepContext.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.start(t);
    osc.stop(t + 0.16);
  } catch (_) {
    // ignore
  }
}

function setWakewordIndicatorActive(active) {
  wakewordIndicatorActive = Boolean(active);
  if (!wakewordIndicator) return;
  if (wakewordIndicatorActive) {
    wakewordIndicator.classList.add('active');
  } else {
    wakewordIndicator.classList.remove('active');
    wakewordIndicator.classList.remove('listening', 'thinking');
  }
}

function setWakewordIndicatorMode(mode) {
  if (!wakewordIndicator) return;
  wakewordIndicator.classList.toggle('listening', mode === 'listening');
  wakewordIndicator.classList.toggle('thinking', mode === 'thinking');
}

function syncWakewordIndicator() {
  if (isSpeaking) {
    wakewordBeepPending = false;
    setWakewordIndicatorActive(false);
    return;
  }
  if (requestedState === 'listening' || requestedState === 'thinking') {
    if (!wakewordIndicatorActive) {
      wakewordIndicator.classList.add('active');
      wakewordIndicatorActive = true;
    }
    setWakewordIndicatorMode(requestedState === 'listening' ? 'listening' : 'thinking');
    if (requestedState === 'listening' && wakewordBeepPending) {
      playWakewordBeep();
      wakewordBeepPending = false;
    }
    return;
  }
  wakewordBeepPending = false;
  setWakewordIndicatorActive(false);
}

function resolveAvatarState() {
  let next = 'idle';
  if (isSpeaking) next = 'speaking';
  else if (requestedState === 'listening' || requestedState === 'thinking') next = requestedState;
  else if (spotifyPlaying) next = 'dancing';
  if (next !== appliedState) {
    appliedState = next;
    setAvatarState(next);
  }
}

function setFallbackEmotion(emotion) {
  avatarFace.className = 'avatar-face';
  if (emotion === 'happy') avatarFace.classList.add('happy');
  if (emotion === 'sad') avatarFace.classList.add('sad');
  if (emotion === 'surprised') avatarFace.classList.add('surprised');
}

function setEmotion(emotion) {
  const clean = (emotion || 'neutral').toLowerCase();
  setFallbackEmotion(clean);
  setAvatarEmotion(clean);
}

async function speak(text) {
  if (!text) return;
  try {
    let prefs = {};
    try {
      prefs = await window.rainyDesktop.getTtsPreferences();
    } catch (_) {
    }
    const payload = { text };
    if (prefs?.voice) payload.voice = prefs.voice;
    if (prefs?.rate) payload.rate = prefs.rate;
    if (prefs?.pitch) payload.pitch = prefs.pitch;
    if (prefs?.volume) payload.volume = prefs.volume;
    const res = await fetch(`${API_BASE}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.url) playWithLipSync(`${API_BASE}${data.url}`);
  } catch (error) {
    console.error(error);
  }
}

function playWithLipSync(url) {
  const audio = new Audio(url);
  audio.crossOrigin = 'anonymous';

  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === 'suspended') audioContext.resume();

  const source = audioContext.createMediaElementSource(audio);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  analyser.connect(audioContext.destination);

  const data = new Uint8Array(analyser.frequencyBinCount);

  function tick() {
    if (audio.paused || audio.ended) return;
    analyser.getByteFrequencyData(data);
    const avg = data.slice(2, 18).reduce((sum, value) => sum + value, 0) / 16;
    const lipValue = Math.min(1, Math.max(0, avg / 120));
    const scale = Math.min(1.9, 0.65 + avg / 110);
    mouth.style.transform = `scaleY(${scale})`;
    mouth.style.height = `${Math.max(8, Math.min(24, avg / 7))}px`;
    setAvatarLipSync(lipValue);
    requestAnimationFrame(tick);
  }

  audio.onplay = tick;
  audio.onplaying = () => {
    isSpeaking = true;
    requestedState = 'idle';
    window.rainyDesktop?.notifyAvatarSpeechStatus?.({ event: 'start' });
    syncWakewordIndicator();
    resolveAvatarState();
  };
  audio.onended = () => {
    mouth.style.transform = 'scaleY(1)';
    mouth.style.height = '8px';
    setAvatarLipSync(0);
    setEmotion('neutral');
    isSpeaking = false;
    window.rainyDesktop?.notifyAvatarSpeechStatus?.({ event: 'end' });
    syncWakewordIndicator();
    resolveAvatarState();
  };
  audio.play().catch((error) => {
    isSpeaking = false;
    window.rainyDesktop?.notifyAvatarSpeechStatus?.({ event: 'end' });
    syncWakewordIndicator();
    resolveAvatarState();
    console.error(error);
  });
}

window.rainyDesktop.onAvatarSpeak((payload) => {
  const text = payload?.text || '';
  const emotion = payload?.emotion || 'neutral';
  setEmotion(emotion);
  speak(text);
});

window.rainyDesktop.onAvatarSettings((settings) => updateAvatarSettings(settings));
window.rainyDesktop.onPerformancePreferences((settings) => updatePerformanceSettings(settings));
window.rainyDesktop.onAvatarState((state) => {
  requestedState = String(state || 'idle').toLowerCase();
  syncWakewordIndicator();
  resolveAvatarState();
});
window.rainyDesktop.onSpotifyPlayback((payload) => {
  spotifyPlaying = Boolean(payload?.isPlaying);
  resolveAvatarState();
});
window.rainyDesktop.onSpotifyTrackChanged(() => {
  if (appliedState === 'dancing') {
    setAvatarState('idle');
    setAvatarState('dancing');
  }
});
window.rainyDesktop.onGlobalCursor((payload) => updateGlobalCursor(payload));

window.rainyDesktop.onAvatarWakewordTriggered(() => {
  wakewordBeepPending = true;
  triggerAvatarReaction('wakeword');
});
window.rainyDesktop.onAvatarReaction((name) => {
  triggerAvatarReaction(name);
});
window.rainyDesktop.onAvatarModel(async (payload) => {
  await setAvatarModel(payload);
});

document.getElementById('close-button').addEventListener('click', () => window.rainyDesktop.close());
chatToggleButton?.addEventListener('click', async () => {
  const next = await window.rainyDesktop.toggleChat();
  chatToggleButton.title = next ? 'Cerrar chat' : 'Abrir chat';
});

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.rainyDesktop.openAvatarContextMenu?.();
});

window.rainyDesktop.getPerformancePreferences?.().then((prefs) => {
  updatePerformanceSettings(prefs?.effective || prefs);
}).catch(() => {});

initAvatar().then((ok) => {
  if (ok) setTimeout(() => triggerAvatarReaction('greet'), 450);
});
