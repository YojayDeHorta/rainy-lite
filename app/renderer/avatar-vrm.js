import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const MODEL_URL = '../../assets/rainy.vrm';

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
let reactionUntil = 0;
let reactionKind = 'none';
let pointer = { x: 0, y: 0, active: false };
let drag = {
  pointerId: null,
  startClientX: 0,
  startClientY: 0,
  startWindowX: 0,
  startWindowY: 0,
  dragging: false,
};
let look = { x: 0, y: 0 };
let saccade = { x: 0, y: 0, nextAt: 0 };
let avatarSettings = {
  x: 0,
  y: -0.45,
  scale: 1.0,
  cameraZ: 3.4,
  light: 0.65,
  motion: 1.0,
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
    await loadVRM(MODEL_URL);
    root?.classList.add('vrm-loaded');
    clock = new THREE.Clock();
    scheduleBlink();
    scheduleMicroExpression();
    animate();
    return true;
  } catch (error) {
    console.warn('Rainy VRM not loaded. Using CSS placeholder.', error);
    container.remove();
    return false;
  }
}

export function setAvatarEmotion(emotion) {
  activeExpression = (emotion || 'neutral').toLowerCase();
  applyExpressions();
}

export function setAvatarState(state) {
  const next = String(state || 'idle').toLowerCase();
  avatarState = ['idle', 'listening', 'thinking', 'speaking'].includes(next) ? next : 'idle';
  if (avatarState === 'listening') activeExpression = 'surprised';
  if (avatarState === 'thinking') activeExpression = 'thinking';
  applyExpressions();
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
  };
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

function applyModelSettings() {
  if (!currentVrm?.scene) return;
  currentVrm.scene.position.set(avatarSettings.x, avatarSettings.y, 0);
  currentVrm.scene.scale.setScalar(avatarSettings.scale);
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
        window.rainyDesktop?.setWindowPosition({
          x: drag.startWindowX + dx,
          y: drag.startWindowY + dy,
        });
      }
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
    target.releasePointerCapture?.(event.pointerId);
    if (!wasDragging) triggerReaction();
  });

  target.addEventListener('pointercancel', (event) => {
    if (drag.pointerId !== event.pointerId) return;
    drag.pointerId = null;
    drag.dragging = false;
    target.releasePointerCapture?.(event.pointerId);
  });
}

function triggerReaction() {
  if (!clock) return;
  reactionUntil = clock.elapsedTime + 0.75;
  reactionKind = Math.random() > 0.35 ? 'bounce' : 'shy';
  activeExpression = reactionKind === 'shy' ? 'shy' : 'happy';
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

          currentVrm = gltf.userData.vrm;
          if (!currentVrm) throw new Error('File loaded, but no VRM data was found.');
          currentVrm.scene.rotation.y = Math.PI;
          applyModelSettings();
          scene.add(currentVrm.scene);
          resolve(currentVrm);
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

  updateIdlePose(elapsed);
  updateAutoExpression(elapsed);
  updateBlink(elapsed);
  updateLip(delta);
  currentVrm?.update(delta);
  renderer.render(scene, camera);
}

function updateIdlePose(elapsed) {
  if (!currentVrm?.humanoid) return;
  const stateMotion = avatarState === 'speaking' ? 1.35 : avatarState === 'listening' ? 1.15 : avatarState === 'thinking' ? 0.65 : 1;
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
  const hips = getBone('hips');

  const reaction = Math.max(0, reactionUntil - elapsed);
  const reactionPulse = reaction > 0 ? Math.sin((0.75 - reaction) * Math.PI * 3.2) * reaction : 0;
  const speakingPulse = avatarState === 'speaking' ? currentLip : 0;
  const listeningTilt = avatarState === 'listening' ? 0.035 : 0;

  if (head) {
    head.rotation.y = look.x * 0.42 + Math.sin(elapsed * 0.62) * 0.035 * motion;
    head.rotation.x = look.y * 0.25 + Math.sin(elapsed * 0.88) * 0.018 * motion - reactionPulse * 0.05;
    head.rotation.z = listeningTilt + Math.sin(elapsed * 0.48) * 0.024 * motion + reactionPulse * 0.08;
  }
  if (neck) neck.rotation.x = look.y * 0.18 + Math.sin(elapsed * 0.76) * 0.012 * motion + speakingPulse * 0.025;
  if (spine) spine.rotation.z = Math.sin(elapsed * 0.54) * 0.018 * motion + reactionPulse * 0.025;
  if (chest) chest.rotation.x = Math.sin(elapsed * 1.25) * 0.01 * motion + speakingPulse * 0.018;
  if (hips) hips.position.y = Math.sin(elapsed * 1.15) * 0.008 * motion + Math.max(0, reactionPulse) * 0.04;
  if (leftUpperArm) leftUpperArm.rotation.z = 1.15 + Math.sin(elapsed * 0.8) * 0.035 * motion + reactionPulse * 0.08;
  if (rightUpperArm) rightUpperArm.rotation.z = -1.15 - Math.sin(elapsed * 0.8) * 0.035 * motion - reactionPulse * 0.08;
  if (leftLowerArm) leftLowerArm.rotation.x = Math.sin(elapsed * 0.9 + 0.8) * 0.025 * motion;
  if (rightLowerArm) rightLowerArm.rotation.x = Math.sin(elapsed * 0.9 + 2.2) * 0.025 * motion;
}

function updateLookTarget(elapsed, motion) {
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
  if (reactionUntil > elapsed || avatarState !== 'idle') return;

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

function updateLip(delta) {
  currentLip += (targetLip - currentLip) * Math.min(1, delta * 18);
  setExpressionValue('aa', currentLip);
}

function updateBlink(elapsed) {
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
