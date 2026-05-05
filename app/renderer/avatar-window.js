import { initAvatar, setAvatarEmotion, setAvatarLipSync, setAvatarState, updateAvatarSettings } from './avatar-vrm.js';

const API_BASE = 'http://127.0.0.1:8765';

const avatarFace = document.getElementById('avatar-face');
const mouth = document.getElementById('mouth');

let audioContext = null;

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
  audio.onplaying = () => setAvatarState('speaking');
  audio.onended = () => {
    mouth.style.transform = 'scaleY(1)';
    mouth.style.height = '8px';
    setAvatarLipSync(0);
    setEmotion('neutral');
    setAvatarState('idle');
  };
  audio.play().catch((error) => {
    setAvatarState('idle');
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
window.rainyDesktop.onAvatarState((state) => setAvatarState(state));

document.getElementById('close-button').addEventListener('click', () => window.rainyDesktop.close());
document.getElementById('pin-button').addEventListener('click', async () => {
  const active = await window.rainyDesktop.toggleAlwaysOnTop();
  document.getElementById('pin-button').textContent = active ? 'Pin' : 'Free';
});

initAvatar();
