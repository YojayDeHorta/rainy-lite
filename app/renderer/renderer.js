import { initAvatar, setAvatarEmotion, setAvatarLipSync } from './avatar-vrm.js';

const API_BASE = 'http://127.0.0.1:8765';

const chatLog = document.getElementById('chat-log');
const input = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const voiceButton = document.getElementById('voice-button');
const subtitle = document.getElementById('subtitle');
const statusDot = document.getElementById('status-dot');
const avatarFace = document.getElementById('avatar-face');
const mouth = document.getElementById('mouth');

let mediaRecorder = null;
let chunks = [];
let audioContext = null;
let analyser = null;
let isRecording = false;

function addMessage(role, text) {
  const el = document.createElement('div');
  el.className = `message ${role}`;
  el.textContent = stripTags(text);
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
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

function setEmotion(emotion) {
  avatarFace.className = 'avatar-face';
  if (emotion === 'happy') avatarFace.classList.add('happy');
  if (emotion === 'sad') avatarFace.classList.add('sad');
  if (emotion === 'surprised') avatarFace.classList.add('surprised');
  setAvatarEmotion(emotion);
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

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    const reply = data.response || '[NEUTRAL] Me quede sin palabras por un segundo.';
    setEmotion(parseEmotion(reply));
    const clean = stripTags(reply);
    subtitle.textContent = clean;
    addMessage('assistant', reply);
    await speak(clean);
  } catch (error) {
    subtitle.textContent = 'Algo fallo hablando con mi backend local.';
    console.error(error);
  }
}

async function speak(text) {
  if (!text) return;
  try {
    const res = await fetch(`${API_BASE}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
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
  analyser = audioContext.createAnalyser();
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
  audio.onended = () => {
    mouth.style.transform = 'scaleY(1)';
    mouth.style.height = '8px';
    setAvatarLipSync(0);
    setEmotion('neutral');
  };
  audio.play().catch(console.error);
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
      await transcribeAndSend(new Blob(chunks, { type: 'audio/webm' }));
    };

    mediaRecorder.start();
    isRecording = true;
    voiceButton.classList.add('recording');
    subtitle.textContent = 'Te escucho... pulsa otra vez para terminar.';
  } catch (error) {
    subtitle.textContent = 'No pude acceder al microfono.';
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
      return;
    }
    const data = await res.json();
    if (data.text) await sendMessage(data.text);
  } catch (error) {
    subtitle.textContent = 'No pude transcribir el audio.';
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

initAvatar();
waitForBackend();
