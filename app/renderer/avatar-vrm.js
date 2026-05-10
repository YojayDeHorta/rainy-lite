import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const MODEL_URL = '../../assets/models/asuka.vrm';
let activeModelUrl = MODEL_URL;

let scene;
let camera;
let renderer;
let ambientLight;
let keyLight;
let rimLight;
let currentVrm = null;
let animationFrame = null;
let clock;
let targetLip = 0;
let currentLip = 0;
let activeExpression = 'neutral';
let avatarState = 'idle';
let blinkUntil = 0;
let nextBlinkAt = 0;
let nextMicroExpressionAt = 0;
let microExpressionUntil = 0;
let pointer = { x: 0, y: 0, active: false };
let drag = {
  pointerId: null,
  startClientX: 0,
  startClientY: 0,
  lastScreenX: 0,
  lastScreenY: 0,
  lastMoveAt: 0,
  startWindowX: 0,
  startWindowY: 0,
  dragging: false,
};
let dragFx = {
  root: null,
  isDragging: false,
  targetTiltX: 0,
  targetTiltZ: 0,
  tiltX: 0,
  tiltZ: 0,
  velocityX: 0,
  velocityY: 0,
  trailX: 0,
  trailY: 0,
  trailPower: 0,
};
let look = { x: 0, y: 0 };
let saccade = { x: 0, y: 0, nextAt: 0 };
let currentDanceIndex = 0;

const danceRoutines = [
  function sway(t) {
    const side = Math.sin(t * 2.75 + Math.PI * 0.25);
    return {
      head: Math.sin(t * 3.2 + 0.6) * 0.024,
      headZ: side * 0.078 * 0.6,
      spine: side * 0.078,
      chest: Math.sin(t * 3.25 + 0.9) * 0.022,
      armSwing: Math.sin(t * 3.05 + 0.6) * 0.075,
      forearm: Math.sin(t * 3.2 + 2.1) * 0.04,
      hipsY: 0,
      hipsZ: 0,
      handZ: 0,
    };
  },
  function bounce(t) {
    const beat = Math.sin(t * 4.2);
    const halfBeat = Math.sin(t * 8.4);
    const offbeat = Math.sin(t * 4.2 + Math.PI);
    const groove = Math.sin(t * 2.1 + 0.4);
    return {
      head: beat * 0.045 + halfBeat * 0.015,
      headZ: groove * 0.03,
      spine: groove * 0.11 + offbeat * 0.025,
      chest: beat * 0.04 + Math.sin(t * 6.3 + 1.2) * 0.012,
      armSwing: beat * 0.13 + offbeat * 0.04,
      forearm: -Math.abs(beat) * 0.09 + halfBeat * 0.025,
      hipsY: Math.abs(beat) * 0.045 + halfBeat * 0.012,
      hipsZ: groove * 0.04,
      handZ: Math.sin(t * 4.2 + 1.8) * 0.06,
    };
  },
  function groove(t) {
    const wave1 = Math.sin(t * 2.8);
    const wave2 = Math.sin(t * 2.8 + 0.7);
    const wave3 = Math.sin(t * 2.8 + 1.4);
    const wave4 = Math.sin(t * 2.8 + 2.1);
    const accent = Math.sin(t * 5.6 + 0.3);
    const slide = Math.sin(t * 1.4 + 0.5);
    return {
      head: wave4 * 0.035 + accent * 0.012,
      headZ: wave4 * 0.05 + slide * 0.02,
      spine: wave2 * 0.1 + slide * 0.04,
      chest: wave3 * 0.035 + accent * 0.015,
      armSwing: wave2 * 0.06 + Math.sin(t * 3.5 + 2.0) * 0.055,
      forearm: wave3 * 0.05 + accent * 0.03,
      hipsY: Math.abs(wave1) * 0.025 + Math.abs(accent) * 0.01,
      hipsZ: wave1 * 0.06 + slide * 0.03,
      handZ: Math.sin(t * 3.5 + 1.0) * 0.07,
    };
  },
];
let avatarSettings = {
  x: 0,
  y: -0.45,
  scale: 1.0,
  cameraZ: 3.4,
  light: 0.65,
  motion: 1.0,
  modelYawDeg: 0,
  modelPitchDeg: 0,
  armHangDeg: 0,
  armAbductionDeg: 0,
};
const reactionProfiles = [
  {
    id: 'head_nod',
    type: 'head',
    weight: 1.45,
    duration: 0.72,
    expression: 'happy',
    headPitch: 0.12,
    headRoll: 0.04,
    neckPitch: 0.07,
    frequency: 2.4,
  },
  {
    id: 'head_tilt_shy',
    type: 'head',
    weight: 1.2,
    duration: 0.82,
    expression: 'shy',
    headPitch: 0.06,
    headRoll: 0.13,
    neckPitch: 0.03,
    frequency: 1.8,
  },
  {
    id: 'head_micro_shake',
    type: 'head',
    weight: 0.9,
    duration: 0.7,
    expression: 'surprised',
    headPitch: 0.03,
    headRoll: 0.07,
    neckPitch: 0.02,
    frequency: 4.2,
  },
  {
    id: 'body_bounce',
    type: 'body',
    weight: 1.15,
    duration: 0.78,
    expression: 'happy',
    bodyLift: 0.055,
    bodySway: 0.045,
    chestPitch: 0.028,
    frequency: 2.2,
  },
  {
    id: 'body_sway',
    type: 'body',
    weight: 1.0,
    duration: 0.95,
    expression: 'thinking',
    bodyLift: 0.018,
    bodySway: 0.08,
    chestPitch: 0.018,
    frequency: 1.6,
  },
  {
    id: 'combo_nod_bounce',
    type: 'combo',
    weight: 1.1,
    duration: 0.92,
    expression: 'happy',
    headPitch: 0.11,
    headRoll: 0.08,
    neckPitch: 0.06,
    bodyLift: 0.04,
    bodySway: 0.05,
    chestPitch: 0.025,
    frequency: 2.8,
  },
  {
    id: 'combo_shy_sway',
    type: 'combo',
    weight: 0.85,
    duration: 1.02,
    expression: 'shy',
    headPitch: 0.055,
    headRoll: 0.11,
    neckPitch: 0.04,
    bodyLift: 0.02,
    bodySway: 0.07,
    chestPitch: 0.015,
    frequency: 1.95,
  },
  {
    id: 'spin_360',
    type: 'combo',
    weight: 1.25,
    duration: 0.62,
    expression: 'surprised',
    headPitch: 0.03,
    headRoll: 0.12,
    neckPitch: 0.02,
    bodyLift: 0.02,
    bodySway: 0.05,
    chestPitch: 0.012,
    frequency: 4.1,
    spinTurns: 1,
  },
  {
    id: 'super_jump',
    type: 'combo',
    weight: 0.7,
    duration: 0.45,
    expression: 'surprised',
    bodyLift: 0.18,
    bodySway: 0.02,
    frequency: 2.8,
  },
  {
    id: 'dizzy_wobble',
    type: 'combo',
    weight: 0.9,
    duration: 1.2,
    expression: 'surprised',
    headRoll: 0.28,
    neckPitch: 0.08,
    bodySway: 0.18,
    frequency: 7.0,
  },
  {
    id: 'spin_720',
    type: 'combo',
    weight: 0.6,
    duration: 0.75,
    expression: 'happy',
    bodyLift: 0.08,
    frequency: 4.5,
    spinTurns: 2,
  },
  {
    id: 'cute_wiggle',
    type: 'combo',
    weight: 1.1,
    duration: 0.85,
    expression: 'happy',
    headRoll: 0.15,
    bodySway: 0.12,
    bodyLift: 0.03,
    chestPitch: 0.05,
    frequency: 5.5,
  },
  {
    id: 'reverse_spin_720',
    type: 'combo',
    weight: 0.6,
    duration: 0.75,
    expression: 'happy',
    bodyLift: 0.08,
    frequency: 4.5,
    spinTurns: -2,
  },
  {
    id: 'headbang',
    type: 'head',
    weight: 0.5,
    duration: 1.5,
    expression: 'surprised',
    headPitch: 0.35,
    neckPitch: 0.15,
    frequency: 6.5,
  },
  {
    id: 'shy_hide',
    type: 'combo',
    weight: 0.8,
    duration: 1.0,
    expression: 'shy',
    headRoll: 0.2,
    headPitch: 0.1,
    bodyLift: -0.06,
    bodySway: 0.08,
    chestPitch: 0.05,
    frequency: 1.0,
  },
  {
    id: 'float_away',
    type: 'combo',
    weight: 0.4,
    duration: 1.8,
    expression: 'surprised',
    bodyLift: 0.45,
    bodySway: 0.04,
    frequency: 1.5,
  },
];

const contextualReactions = {
  greet: { id: 'greet_wave', duration: 1.15, expression: 'happy', headPitch: 0.1, headRoll: 0.08, bodyLift: 0.035, bodySway: 0.08, chestPitch: 0.025, frequency: 2.4 },
  listen: { id: 'listen_bow', duration: 0.85, expression: 'surprised', headPitch: 0.16, neckPitch: 0.08, chestPitch: 0.035, frequency: 1.6 },
  think: { id: 'think_glance', duration: 0.9, expression: 'thinking', headRoll: 0.12, bodySway: 0.045, frequency: 1.3 },
  speak: { id: 'speak_focus', duration: 0.7, expression: 'happy', headPitch: 0.06, neckPitch: 0.04, chestPitch: 0.025, frequency: 1.8 },
  success: { id: 'success_nod', duration: 0.72, expression: 'happy', headPitch: 0.13, headRoll: 0.04, neckPitch: 0.08, frequency: 2.5 },
  confused: { id: 'confused_tilt', duration: 0.9, expression: 'thinking', headRoll: 0.18, headPitch: 0.03, bodySway: 0.05, frequency: 1.7 },
  reset: { id: 'reset_shake', duration: 0.75, expression: 'surprised', headRoll: 0.12, bodySway: 0.05, frequency: 4.4 },
  wakeword: { id: 'wakeword_attention', duration: 0.75, expression: 'surprised', headPitch: 0.1, bodyLift: 0.035, chestPitch: 0.03, frequency: 2.6 },
};
let reactionFx = {
  profile: null,
  startAt: 0,
  endAt: 0,
  intensity: 0,
  headPitch: 0,
  headRoll: 0,
  neckPitch: 0,
  spineRoll: 0,
  chestPitch: 0,
  hipsLift: 0,
  modelYaw: 0,
};

const expressionMap = {
  neutral: 'neutral',
  happy: 'happy',
  sad: 'sad',
  surprised: 'surprised',
  thinking: 'relaxed',
  shy: 'happy',
};

export async function initAvatar() {
  const container = document.getElementById('vrm-layer');
  const root = document.getElementById('avatar-root');
  if (!container || renderer) return false;
  dragFx.root = root;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(24, 1, 0.1, 20);
  applyCameraSettings();

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  bindAvatarInteraction(container);

  ambientLight = new THREE.AmbientLight(0xbfdfff, 0.7);
  scene.add(ambientLight);

  keyLight = new THREE.DirectionalLight(0xd9f0ff, 0.85);
  keyLight.position.set(1.5, 2.6, 2.8);
  scene.add(keyLight);

  rimLight = new THREE.DirectionalLight(0x96b8ff, 0.35);
  rimLight.position.set(-1.8, 1.6, -1.6);
  scene.add(rimLight);
  applyLightingSettings();

  const resize = () => resizeRenderer(container);
  resize();
  new ResizeObserver(resize).observe(container);

  try {
    const preferredModel = await window.rainyDesktop?.getCurrentAvatarModel?.();
    if (preferredModel?.url) activeModelUrl = preferredModel.url;
    try {
      await loadVRM(activeModelUrl);
    } catch (preferredError) {
      // If the saved model path is stale (e.g. deleted custom model), recover with bundled default.
      if (activeModelUrl !== MODEL_URL) {
        console.warn('No pude cargar el modelo preferido, pruebo fallback por defecto.', preferredError);
        activeModelUrl = MODEL_URL;
        await loadVRM(activeModelUrl);
      } else {
        throw preferredError;
      }
    }
    root?.classList.add('vrm-loaded');
    clock = new THREE.Clock();
    
    updateIdlePose(0);
    currentVrm.scene.updateMatrixWorld(true);
    if (currentVrm.springBoneManager) currentVrm.springBoneManager.reset();
    
    scheduleBlink();
    scheduleMicroExpression();
    animate();
    return true;
  } catch (error) {
    console.warn('Asuka VRM not loaded. Keeping placeholder and waiting model updates.', error);
    return false;
  }
}

export async function setAvatarModel(modelPayload) {
  const nextUrl = String(modelPayload?.url || '').trim();
  if (!nextUrl) return false;
  if (nextUrl === activeModelUrl) return true;
  const previousVrm = currentVrm;
  const previousUrl = activeModelUrl;
  activeModelUrl = nextUrl;
  try {
    const nextVrm = await loadVRM(activeModelUrl);
    if (previousVrm?.scene) scene.remove(previousVrm.scene);
    currentVrm = nextVrm;
    scene.add(currentVrm.scene);
    applyModelSettings();
    applyExpressions();
    
    updateIdlePose(clock ? clock.elapsedTime : 0);
    currentVrm.scene.updateMatrixWorld(true);
    if (currentVrm.springBoneManager) currentVrm.springBoneManager.reset();
    
    return true;
  } catch (error) {
    activeModelUrl = previousUrl;
    if (previousVrm && !scene.children.includes(previousVrm.scene)) {
      scene.add(previousVrm.scene);
      currentVrm = previousVrm;
    }
    console.warn('No pude cambiar el modelo VRM.', error);
    return false;
  }
}

export function setAvatarEmotion(emotion) {
  activeExpression = (emotion || 'neutral').toLowerCase();
  applyExpressions();
}

export function setAvatarState(state) {
  const prev = avatarState;
  const next = String(state || 'idle').toLowerCase();
  avatarState = ['idle', 'listening', 'thinking', 'speaking', 'dancing'].includes(next) ? next : 'idle';
  if (avatarState === 'dancing' && prev !== 'dancing') {
    currentDanceIndex = (currentDanceIndex + 1) % danceRoutines.length;
  }
  if (avatarState === 'listening') activeExpression = 'surprised';
  if (avatarState === 'thinking') activeExpression = 'thinking';
  if (avatarState === 'dancing') activeExpression = 'happy';
  applyExpressions();
  if (prev !== avatarState) {
    if (avatarState === 'listening') triggerAvatarReaction('listen');
    if (avatarState === 'thinking') triggerAvatarReaction('think');
    if (avatarState === 'speaking') triggerAvatarReaction('speak');
  }
}

export function triggerAvatarReaction(name) {
  if (!clock) return;
  const profile = contextualReactions[String(name || '').toLowerCase()];
  if (!profile) return;
  startReaction(profile, clock.elapsedTime);
}

export function setAvatarLipSync(value) {
  targetLip = Math.max(0, Math.min(1, Number(value) || 0));
}

export function updateAvatarSettings(settings = {}) {
  avatarSettings = {
    ...avatarSettings,
    ...normalizeSettings(settings),
  };
  applyCameraSettings();
  applyModelSettings();
  applyLightingSettings();
}

export function updateGlobalCursor(payload = {}) {
  if (drag.pointerId !== null) return;
  const cursor = payload.cursor;
  const bounds = payload.bounds;
  if (!cursor || !bounds || !bounds.width || !bounds.height) return;

  const rawX = ((cursor.x - bounds.x) / bounds.width - 0.5) * 2;
  const rawY = -(((cursor.y - bounds.y) / bounds.height - 0.5) * 2);
  pointer.x = clampNumber(rawX, -1.6, 1.6, 0);
  pointer.y = clampNumber(rawY, -1.4, 1.4, 0);
  pointer.active = true;
}

function normalizeSettings(settings) {
  return {
    x: clampNumber(settings.x, -1.5, 1.5, avatarSettings.x),
    y: clampNumber(settings.y, -2.0, 1.5, avatarSettings.y),
    scale: clampNumber(settings.scale, 0.4, 2.0, avatarSettings.scale),
    cameraZ: clampNumber(settings.cameraZ, 1.7, 6.0, avatarSettings.cameraZ),
    light: clampNumber(settings.light, 0.15, 1.4, avatarSettings.light),
    motion: clampNumber(settings.motion, 0, 2, avatarSettings.motion),
    modelYawDeg: clampNumber(settings.modelYawDeg, -180, 180, avatarSettings.modelYawDeg),
    modelPitchDeg: clampNumber(settings.modelPitchDeg, -35, 35, avatarSettings.modelPitchDeg),
    armHangDeg: resolveArmHangDeg(settings),
    armAbductionDeg: clampNumber(settings.armAbductionDeg, -35, 140, avatarSettings.armAbductionDeg),
  };
}

function resolveArmHangDeg(settings) {
  const fallback = avatarSettings.armHangDeg;
  if (settings.armHangDeg !== undefined && settings.armHangDeg !== null) {
    return clampNumber(settings.armHangDeg, 0, 85, fallback);
  }
  if (settings.armRaiseDeg !== undefined && settings.armRaiseDeg !== null) {
    return clampNumber(-Number(settings.armRaiseDeg), 0, 85, fallback);
  }
  return fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function applyCameraSettings() {
  if (!camera) return;
  camera.position.set(0, 1.18, avatarSettings.cameraZ);
  camera.lookAt(0, 1.05, 0);
  camera.updateProjectionMatrix();
}

function syncVrmSceneRotation() {
  if (!currentVrm?.scene) return;
  const s = currentVrm.scene;
  const yawBase = Math.PI + THREE.MathUtils.degToRad(avatarSettings.modelYawDeg || 0);
  const reactYaw = Number(reactionFx.modelYaw) || 0;
  s.rotation.order = 'YXZ';
  s.rotation.x = THREE.MathUtils.degToRad(avatarSettings.modelPitchDeg || 0);
  s.rotation.y = yawBase + reactYaw;
  s.rotation.z = 0;
}

function applyModelSettings() {
  if (!currentVrm?.scene) return;
  currentVrm.scene.position.set(avatarSettings.x, avatarSettings.y, 0);
  currentVrm.scene.scale.setScalar(avatarSettings.scale);
  syncVrmSceneRotation();
}

function applyLightingSettings() {
  const light = avatarSettings.light;
  if (ambientLight) ambientLight.intensity = 0.55 * light;
  if (keyLight) keyLight.intensity = 0.75 * light;
  if (rimLight) rimLight.intensity = 0.28 * light;
}

function resizeRenderer(container) {
  if (!renderer || !camera || !container) return;
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function bindAvatarInteraction(target) {
  target.addEventListener('pointermove', (event) => {
    const rect = target.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    pointer.y = -(((event.clientY - rect.top) / rect.height - 0.5) * 2);
    pointer.active = true;

    if (drag.pointerId === event.pointerId) {
      const dx = event.screenX - drag.startClientX;
      const dy = event.screenY - drag.startClientY;
      const distance = Math.hypot(dx, dy);
      if (distance > 6) drag.dragging = true;
      if (drag.dragging) {
        const now = performance.now();
        const dt = Math.max(1, now - drag.lastMoveAt);
        const frameDx = event.screenX - drag.lastScreenX;
        const frameDy = event.screenY - drag.lastScreenY;
        const speedX = frameDx / dt;
        const speedY = frameDy / dt;
        dragFx.velocityX += (speedX - dragFx.velocityX) * 0.35;
        dragFx.velocityY += (speedY - dragFx.velocityY) * 0.35;
        dragFx.targetTiltZ = clampNumber(-dragFx.velocityX * 0.35, -0.22, 0.22, 0);
        dragFx.targetTiltX = clampNumber(dragFx.velocityY * 0.22, -0.14, 0.14, 0);
        dragFx.trailX += ((-frameDx * 1.4) - dragFx.trailX) * 0.3;
        dragFx.trailY += ((-frameDy * 1.4) - dragFx.trailY) * 0.3;
        dragFx.trailPower = Math.min(1, Math.hypot(dragFx.velocityX, dragFx.velocityY) * 10);
        setDraggingVisual(true);

        window.rainyDesktop?.setWindowPosition({
          x: drag.startWindowX + dx,
          y: drag.startWindowY + dy,
        });
      }
      drag.lastScreenX = event.screenX;
      drag.lastScreenY = event.screenY;
      drag.lastMoveAt = performance.now();
    }
  }, { passive: true });

  target.addEventListener('pointerleave', () => {
    if (drag.pointerId === null) pointer.active = false;
  }, { passive: true });

  target.addEventListener('pointerdown', async (event) => {
    if (event.button !== 0) return;
    const position = await window.rainyDesktop?.getWindowPosition?.() || { x: 0, y: 0 };
    drag = {
      pointerId: event.pointerId,
      startClientX: event.screenX,
      startClientY: event.screenY,
      lastScreenX: event.screenX,
      lastScreenY: event.screenY,
      lastMoveAt: performance.now(),
      startWindowX: position.x,
      startWindowY: position.y,
      dragging: false,
    };
    target.setPointerCapture?.(event.pointerId);
  });

  target.addEventListener('pointerup', (event) => {
    if (drag.pointerId !== event.pointerId) return;
    const wasDragging = drag.dragging;
    drag.pointerId = null;
    drag.dragging = false;
    setDraggingVisual(false);
    target.releasePointerCapture?.(event.pointerId);
    if (!wasDragging) triggerReaction();
  });

  target.addEventListener('pointercancel', (event) => {
    if (drag.pointerId !== event.pointerId) return;
    drag.pointerId = null;
    drag.dragging = false;
    setDraggingVisual(false);
    target.releasePointerCapture?.(event.pointerId);
  });
}

function setDraggingVisual(active) {
  dragFx.isDragging = active;
  if (!active) {
    dragFx.targetTiltX = 0;
    dragFx.targetTiltZ = 0;
  }
  if (dragFx.root) {
    dragFx.root.classList.toggle('dragging', active);
  }
}

function triggerReaction() {
  if (!clock) return;
  startReaction(pickReactionProfile(), clock.elapsedTime);
}

function pickReactionProfile() {
  const totalWeight = reactionProfiles.reduce((sum, profile) => sum + profile.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const profile of reactionProfiles) {
    roll -= profile.weight;
    if (roll <= 0) return profile;
  }
  return reactionProfiles[0];
}

function startReaction(profile, now) {
  if (!profile) return;
  reactionFx.profile = profile;
  reactionFx.startAt = now;
  reactionFx.endAt = now + profile.duration;
  activeExpression = profile.expression || 'happy';
  applyExpressions();
}

function loadVRM(url) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(
      url,
      (gltf) => {
        try {
          VRMUtils.removeUnnecessaryVertices(gltf.scene);
          VRMUtils.removeUnnecessaryJoints(gltf.scene);

          const vrm = gltf.userData.vrm;
          if (!vrm) throw new Error('File loaded, but no VRM data was found.');
          if (!currentVrm) {
            currentVrm = vrm;
            applyModelSettings();
            scene.add(vrm.scene);
            resolve(currentVrm);
            return;
          }
          resolve(vrm);
        } catch (error) {
          reject(error);
        }
      },
      undefined,
      reject,
    );
  });
}

function animate() {
  animationFrame = requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const elapsed = clock.elapsedTime;

  updateReaction(elapsed, delta);
  updateIdlePose(elapsed);
  updateAutoExpression(elapsed);
  updateBlink(elapsed);
  updateLip(delta);
  updateDragVisuals(delta);
  currentVrm?.update(delta);
  renderer.render(scene, camera);
}

function updateIdlePose(elapsed) {
  if (!currentVrm?.humanoid) return;
  const stateMotion = avatarState === 'speaking' ? 1.35 : avatarState === 'listening' ? 1.15 : avatarState === 'thinking' ? 0.65 : avatarState === 'dancing' ? 1.55 : 1;
  const motion = avatarSettings.motion * stateMotion;
  updateLookTarget(elapsed, motion);

  const head = getBone('head');
  const neck = getBone('neck');
  const spine = getBone('spine');
  const chest = getBone('chest');
  const leftUpperArm = getBone('leftUpperArm');
  const rightUpperArm = getBone('rightUpperArm');
  const leftLowerArm = getBone('leftLowerArm');
  const rightLowerArm = getBone('rightLowerArm');
  const leftHand = getBone('leftHand');
  const rightHand = getBone('rightHand');
  const hips = getBone('hips');

  const reactionPulse = reactionFx.intensity;
  const reactionHeadPitch = reactionFx.headPitch;
  const reactionHeadRoll = reactionFx.headRoll;
  const reactionNeckPitch = reactionFx.neckPitch;
  const reactionSpineRoll = reactionFx.spineRoll;
  const reactionChestPitch = reactionFx.chestPitch;
  const reactionHipsLift = reactionFx.hipsLift;
  const speakingPulse = avatarState === 'speaking' ? currentLip : 0;
  const listeningTilt = avatarState === 'listening' ? 0.035 : 0;
  const dancing = avatarState === 'dancing' ? 1 : 0;
  const d = dancing ? danceRoutines[currentDanceIndex](elapsed) : { head: 0, headZ: 0, spine: 0, chest: 0, armSwing: 0, forearm: 0, hipsY: 0, hipsZ: 0, handZ: 0 };
  const danceHead = d.head * dancing;
  const danceSpine = d.spine * dancing;
  const danceChest = d.chest * dancing;
  const danceArmSwing = d.armSwing * dancing;
  const danceForearm = d.forearm * dancing;
  const danceHipsY = d.hipsY * dancing;
  const danceHipsZ = d.hipsZ * dancing;
  const danceHeadZ = d.headZ * dancing;
  const danceHandZ = d.handZ * dancing;
  const dragTiltX = dragFx.tiltX;
  const dragTiltZ = dragFx.tiltZ;
  const armHangRad = THREE.MathUtils.degToRad(avatarSettings.armHangDeg || 0);
  const armAbRad = THREE.MathUtils.degToRad(avatarSettings.armAbductionDeg || 0);

  if (head) {
    head.rotation.y = look.x * 0.42 + Math.sin(elapsed * 0.62) * 0.035 * motion;
    head.rotation.x = look.y * 0.25 + Math.sin(elapsed * 0.88) * 0.018 * motion - reactionPulse * 0.03 + reactionHeadPitch + dragTiltX * 0.55 + danceHead;
    head.rotation.z = listeningTilt + Math.sin(elapsed * 0.48) * 0.024 * motion + reactionHeadRoll + dragTiltZ * 0.6 + danceHeadZ;
  }
  if (neck) neck.rotation.x = look.y * 0.18 + Math.sin(elapsed * 0.76) * 0.012 * motion + speakingPulse * 0.025 + reactionNeckPitch + dragTiltX * 0.4;
  if (spine) spine.rotation.z = Math.sin(elapsed * 0.54) * 0.018 * motion + reactionSpineRoll + dragTiltZ * 0.45 + danceSpine;
  if (chest) chest.rotation.x = Math.sin(elapsed * 1.25) * 0.01 * motion + speakingPulse * 0.018 + reactionChestPitch + danceChest;
  if (hips) {
    hips.position.y = Math.sin(elapsed * 1.15) * 0.008 * motion + reactionHipsLift + danceHipsY;
    hips.rotation.z = danceHipsZ;
  }
  if (leftUpperArm) {
    leftUpperArm.rotation.x = 0.24 + armHangRad + Math.sin(elapsed * 0.64) * 0.012 * motion;
    leftUpperArm.rotation.z = 1.22 - armAbRad + Math.sin(elapsed * 0.76) * 0.02 * motion + reactionPulse * 0.045 + danceArmSwing;
    leftUpperArm.rotation.y = -0.02 + Math.sin(elapsed * 0.52 + 0.35) * 0.012 * motion;
  }
  if (rightUpperArm) {
    rightUpperArm.rotation.x = 0.24 + armHangRad + Math.sin(elapsed * 0.64 + 0.4) * 0.012 * motion;
    rightUpperArm.rotation.z = -1.22 + armAbRad - Math.sin(elapsed * 0.76) * 0.02 * motion - reactionPulse * 0.045 - danceArmSwing;
    rightUpperArm.rotation.y = 0.02 - Math.sin(elapsed * 0.52 + 0.35) * 0.012 * motion;
  }
  if (leftLowerArm) {
    leftLowerArm.rotation.x = -0.62 + Math.sin(elapsed * 0.9 + 0.55) * 0.014 * motion + danceForearm;
    leftLowerArm.rotation.y = 0.04 + Math.sin(elapsed * 0.7 + 0.3) * 0.01 * motion;
  }
  if (rightLowerArm) {
    rightLowerArm.rotation.x = -0.62 + Math.sin(elapsed * 0.9 + 1.9) * 0.014 * motion - danceForearm;
    rightLowerArm.rotation.y = -0.04 - Math.sin(elapsed * 0.7 + 0.3) * 0.01 * motion;
  }
  if (leftHand) {
    leftHand.rotation.x = -0.22 + Math.sin(elapsed * 0.92 + 0.5) * 0.01 * motion;
    leftHand.rotation.y = 0.07 + Math.sin(elapsed * 0.62 + 0.9) * 0.006 * motion;
    leftHand.rotation.z = 0.05 + Math.sin(elapsed * 0.58 + 0.2) * 0.008 * motion + danceHandZ;
  }
  if (rightHand) {
    rightHand.rotation.x = -0.22 + Math.sin(elapsed * 0.92 + 1.6) * 0.01 * motion;
    rightHand.rotation.y = -0.07 - Math.sin(elapsed * 0.62 + 0.9) * 0.006 * motion;
    rightHand.rotation.z = -0.05 - Math.sin(elapsed * 0.58 + 0.2) * 0.008 * motion - danceHandZ;
  }
  applyRelaxedFingers(elapsed, motion);
}

function applyRelaxedFingers(elapsed, motion) {
  const curlWave = 1 + Math.sin(elapsed * 0.86) * 0.05 * motion;
  const fingerCurl = -0.32 * curlWave;
  const thumbCurl = 0.2 * curlWave;
  const fingerNames = ['Index', 'Middle', 'Ring', 'Little'];
  const segments = ['Proximal', 'Intermediate'];
  for (const side of ['left', 'right']) {
    for (const name of fingerNames) {
      for (const segment of segments) {
        const bone = getBone(`${side}${name}${segment}`);
        if (!bone) continue;
        bone.rotation.x = fingerCurl;
      }
    }
    const thumbProximal = getBone(`${side}ThumbProximal`);
    const thumbIntermediate = getBone(`${side}ThumbIntermediate`);
    if (thumbProximal) {
      thumbProximal.rotation.y = side === 'left' ? thumbCurl : -thumbCurl;
      thumbProximal.rotation.z = side === 'left' ? -thumbCurl * 0.35 : thumbCurl * 0.35;
    }
    if (thumbIntermediate) {
      thumbIntermediate.rotation.y = side === 'left' ? thumbCurl * 0.5 : -thumbCurl * 0.5;
    }
  }
}

function updateLookTarget(elapsed, motion) {
  if (avatarState === 'dancing') {
    look.x += (0 - look.x) * 0.12;
    look.y += (0 - look.y) * 0.12;
    return;
  }

  if (elapsed > saccade.nextAt) {
    saccade.x = (Math.random() - 0.5) * 0.16 * motion;
    saccade.y = (Math.random() - 0.5) * 0.08 * motion;
    saccade.nextAt = elapsed + 1.8 + Math.random() * 3.2;
  }

  const targetX = (pointer.active ? pointer.x * 0.32 : 0) + saccade.x;
  const targetY = (pointer.active ? pointer.y * 0.22 : 0) + saccade.y;
  look.x += (targetX - look.x) * 0.08;
  look.y += (targetY - look.y) * 0.08;
}

function updateAutoExpression(elapsed) {
  if (reactionFx.profile || avatarState !== 'idle') return;

  if (microExpressionUntil && elapsed > microExpressionUntil) {
    microExpressionUntil = 0;
    activeExpression = 'neutral';
    applyExpressions();
  }

  if (!microExpressionUntil && elapsed > nextMicroExpressionAt) {
    const expressions = ['happy', 'shy', 'thinking'];
    activeExpression = expressions[Math.floor(Math.random() * expressions.length)];
    microExpressionUntil = elapsed + 0.85 + Math.random() * 0.75;
    scheduleMicroExpression(elapsed);
    applyExpressions();
  }
}

function updateReaction(elapsed, delta) {
  const blendIn = Math.min(1, delta * 18);
  const blendOut = Math.min(1, delta * 8);
  if (!reactionFx.profile) {
    reactionFx.intensity += (0 - reactionFx.intensity) * blendOut;
    reactionFx.headPitch += (0 - reactionFx.headPitch) * blendOut;
    reactionFx.headRoll += (0 - reactionFx.headRoll) * blendOut;
    reactionFx.neckPitch += (0 - reactionFx.neckPitch) * blendOut;
    reactionFx.spineRoll += (0 - reactionFx.spineRoll) * blendOut;
    reactionFx.chestPitch += (0 - reactionFx.chestPitch) * blendOut;
    reactionFx.hipsLift += (0 - reactionFx.hipsLift) * blendOut;
    reactionFx.modelYaw += (0 - reactionFx.modelYaw) * blendOut;
    syncVrmSceneRotation();
    return;
  }

  const profile = reactionFx.profile;
  const progress = clampNumber((elapsed - reactionFx.startAt) / Math.max(0.001, profile.duration), 0, 1, 1);
  const envelope = Math.sin(progress * Math.PI);
  const phase = elapsed * profile.frequency * Math.PI * 2;
  const headWave = Math.sin(phase);
  const bodyWave = Math.sin(phase + Math.PI * 0.5);
  const swayWave = Math.sin(phase * 0.7 + Math.PI * 0.25);
  const targetIntensity = envelope;
  const easedProgress = 0.5 - 0.5 * Math.cos(progress * Math.PI);

  const headPitch = (profile.headPitch || 0) * Math.max(-0.5, headWave);
  const headRoll = (profile.headRoll || 0) * swayWave;
  const neckPitch = (profile.neckPitch || 0) * Math.max(-0.45, headWave);
  const spineRoll = (profile.bodySway || 0) * swayWave * 0.65;
  const chestPitch = (profile.chestPitch || 0) * bodyWave;
  const hipsLift = (profile.bodyLift || 0) * Math.max(0, bodyWave);
  const spinTurns = Number(profile.spinTurns) || 0;
  const targetYaw = spinTurns ? spinTurns * Math.PI * 2 * easedProgress : 0;

  reactionFx.intensity += (targetIntensity - reactionFx.intensity) * blendIn;
  reactionFx.headPitch += (headPitch * envelope - reactionFx.headPitch) * blendIn;
  reactionFx.headRoll += (headRoll * envelope - reactionFx.headRoll) * blendIn;
  reactionFx.neckPitch += (neckPitch * envelope - reactionFx.neckPitch) * blendIn;
  reactionFx.spineRoll += (spineRoll * envelope - reactionFx.spineRoll) * blendIn;
  reactionFx.chestPitch += (chestPitch * envelope - reactionFx.chestPitch) * blendIn;
  reactionFx.hipsLift += (hipsLift * envelope - reactionFx.hipsLift) * blendIn;
  reactionFx.modelYaw += (targetYaw - reactionFx.modelYaw) * Math.min(1, delta * 22);
  syncVrmSceneRotation();

  if (elapsed >= reactionFx.endAt) {
    reactionFx.profile = null;
    reactionFx.modelYaw = 0;
    syncVrmSceneRotation();
    if (avatarState === 'idle') {
      activeExpression = 'neutral';
      applyExpressions();
    }
  }
}

function updateLip(delta) {
  currentLip += (targetLip - currentLip) * Math.min(1, delta * 18);
  setExpressionValue('aa', currentLip);
}

function updateDragVisuals(delta) {
  const tiltSmoothing = Math.min(1, delta * 14);
  const releaseSmoothing = Math.min(1, delta * 5);
  dragFx.tiltX += (dragFx.targetTiltX - dragFx.tiltX) * tiltSmoothing;
  dragFx.tiltZ += (dragFx.targetTiltZ - dragFx.tiltZ) * tiltSmoothing;

  if (!dragFx.isDragging) {
    dragFx.velocityX += (0 - dragFx.velocityX) * releaseSmoothing;
    dragFx.velocityY += (0 - dragFx.velocityY) * releaseSmoothing;
    dragFx.trailX += (0 - dragFx.trailX) * releaseSmoothing;
    dragFx.trailY += (0 - dragFx.trailY) * releaseSmoothing;
    dragFx.trailPower += (0 - dragFx.trailPower) * releaseSmoothing;
  }

  if (dragFx.root) {
    dragFx.root.style.setProperty('--drag-trail-x', `${dragFx.trailX.toFixed(1)}px`);
    dragFx.root.style.setProperty('--drag-trail-y', `${dragFx.trailY.toFixed(1)}px`);
    dragFx.root.style.setProperty('--drag-trail-opacity', `${(dragFx.trailPower * 0.42).toFixed(3)}`);
  }
}

function updateBlink(elapsed) {
  if (avatarState === 'dancing') {
    setExpressionValue('blink', 0);
    return;
  }

  if (elapsed > nextBlinkAt) {
    blinkUntil = elapsed + 0.12;
    scheduleBlink(elapsed);
  }
  const blinkValue = elapsed < blinkUntil ? 1 : 0;
  setExpressionValue('blink', blinkValue);
}

function scheduleBlink(now = 0) {
  const base = avatarState === 'speaking' ? 1.8 : avatarState === 'listening' ? 1.6 : 2.2;
  nextBlinkAt = now + base + Math.random() * 3.0;
}

function scheduleMicroExpression(now = 0) {
  nextMicroExpressionAt = now + 5.0 + Math.random() * 7.0;
}

function applyExpressions() {
  if (!currentVrm?.expressionManager) return;
  for (const name of ['happy', 'sad', 'angry', 'surprised', 'relaxed']) {
    setExpressionValue(name, 0);
  }

  const expression = expressionMap[activeExpression] || 'neutral';
  if (expression !== 'neutral') {
    const amount = expression === 'relaxed' ? 0.38 : avatarState === 'speaking' ? 0.55 : 0.72;
    setExpressionValue(expression, amount);
  }
}

function setExpressionValue(name, value) {
  try {
    currentVrm?.expressionManager?.setValue(name, value);
  } catch (_) {
    // VRM models do not always expose the same expression presets.
  }
}

function getBone(name) {
  try {
    return currentVrm?.humanoid?.getNormalizedBoneNode(name) || null;
  } catch (_) {
    return null;
  }
}

export function disposeAvatar() {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  renderer?.dispose();
}
