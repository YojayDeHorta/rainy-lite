import {
  initAvatar,
  setAvatarModel,
  setAvatarState,
  triggerAvatarReaction,
  updateAvatarSettings,
  updatePerformanceSettings,
} from './avatar-vrm.js';

const status = document.getElementById('party-status');
const closeButton = document.getElementById('party-close-button');
const shell = document.querySelector('.party-shell');

let spotifyPlaying = false;
let reactionTimer = null;
let teleportTimer = null;
let currentSpotIndex = -1;

const partyAvatarSettings = {
  x: 0,
  y: 0.85,
  scale: 0.92,
  cameraZ: 3.75,
  light: 0.86,
  motion: 1.48,
  modelYawDeg: 0,
  modelPitchDeg: 0,
};

const partyPerformanceSettings = {
  avatarFps: 120,
  pixelRatioCap: 2,
  paused: false,
};

const partySpots = [
  { x: -0.72, y: 0.82, scale: 0.82, cameraZ: 4.05, beatX: '35vw', beatY: '62vh' },
  { x: 0.72, y: 0.82, scale: 0.82, cameraZ: 4.05, beatX: '66vw', beatY: '58vh' },
  { x: 0, y: 0.9, scale: 1.04, cameraZ: 3.55, beatX: '50vw', beatY: '54vh' },
  { x: -0.36, y: 0.78, scale: 0.94, cameraZ: 3.78, beatX: '43vw', beatY: '72vh' },
  { x: 0.4, y: 0.78, scale: 0.94, cameraZ: 3.78, beatX: '60vw', beatY: '72vh' },
  { x: -0.12, y: 0.94, scale: 1.16, cameraZ: 3.35, beatX: '48vw', beatY: '48vh' },
  { x: 0.16, y: 0.72, scale: 0.74, cameraZ: 4.35, beatX: '56vw', beatY: '76vh' },
];

function movePartyAvatar(force = false) {
  if (!spotifyPlaying && !force) {
    updateAvatarSettings(partyAvatarSettings);
    return;
  }

  let nextIndex = currentSpotIndex;
  while (nextIndex === currentSpotIndex && partySpots.length > 1) {
    nextIndex = Math.floor(Math.random() * partySpots.length);
  }
  currentSpotIndex = nextIndex;
  const spot = partySpots[currentSpotIndex] || partySpots[0];
  updateAvatarSettings({
    ...partyAvatarSettings,
    x: spot.x,
    y: spot.y,
    scale: spot.scale,
    cameraZ: spot.cameraZ,
  });
  shell?.style.setProperty('--beat-x', spot.beatX);
  shell?.style.setProperty('--beat-y', spot.beatY);
}

function syncTeleportTimer() {
  if (teleportTimer) {
    clearInterval(teleportTimer);
    teleportTimer = null;
  }
  if (!spotifyPlaying) {
    movePartyAvatar();
    return;
  }
  movePartyAvatar(true);
  teleportTimer = setInterval(() => movePartyAvatar(true), 6500);
}

function applyPartyState() {
  document.body.classList.toggle('is-dancing', spotifyPlaying);
  if (status) {
    status.textContent = spotifyPlaying ? 'Musica detectada. Baile activado.' : 'Esperando musica...';
  }
  setAvatarState(spotifyPlaying ? 'dancing' : 'idle');
  syncTeleportTimer();
}

function schedulePartyReactions() {
  if (reactionTimer) clearInterval(reactionTimer);
  reactionTimer = setInterval(() => {
    if (spotifyPlaying) return;
    const reactions = ['success', 'confused', 'wakeword'];
    void triggerAvatarReaction(reactions[Math.floor(Math.random() * reactions.length)]);
  }, 9000);
}

async function initParty() {
  updatePerformanceSettings(partyPerformanceSettings);
  updateAvatarSettings(partyAvatarSettings);

  const ok = await initAvatar();
  if (!ok) return;
  updatePerformanceSettings(partyPerformanceSettings);
  updateAvatarSettings(partyAvatarSettings);
  applyPartyState();
  schedulePartyReactions();
}

window.rainyDesktop.onAvatarModel(async (payload) => {
  await setAvatarModel(payload);
  updateAvatarSettings(partyAvatarSettings);
});

window.rainyDesktop.onSpotifyPlayback((payload) => {
  spotifyPlaying = Boolean(payload?.isPlaying);
  applyPartyState();
});

window.rainyDesktop.onSpotifyTrackChanged(() => {
  if (!spotifyPlaying) return;
  setAvatarState('idle');
  setAvatarState('dancing');
});

window.rainyDesktop.onPerformancePreferences(() => {
  updatePerformanceSettings(partyPerformanceSettings);
});

closeButton?.addEventListener('click', () => window.rainyDesktop.close());

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.rainyDesktop.close();
});

window.addEventListener('beforeunload', () => {
  if (reactionTimer) clearInterval(reactionTimer);
  if (teleportTimer) clearInterval(teleportTimer);
});

void initParty();
