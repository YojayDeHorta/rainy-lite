const API_BASE = 'http://127.0.0.1:8765';

const chatLog = document.getElementById('chat-log');
const input = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const voiceButton = document.getElementById('voice-button');
const subtitle = document.getElementById('subtitle');
const statusDot = document.getElementById('status-dot');

let mediaRecorder = null;
let chunks = [];
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
    const emotion = parseEmotion(reply);
    const clean = stripTags(reply);
    subtitle.textContent = clean;
    addMessage('assistant', reply);
    await window.rainyDesktop.speakOnAvatar({ text: clean, emotion });
  } catch (error) {
    subtitle.textContent = 'Algo fallo hablando con mi backend local.';
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

waitForBackend();
