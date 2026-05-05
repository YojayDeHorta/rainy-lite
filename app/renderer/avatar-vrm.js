import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const MODEL_URL = '../../assets/rainy.vrm';

let scene;
let camera;
let renderer;
let currentVrm = null;
let animationFrame = null;
let clock;
let targetLip = 0;
let currentLip = 0;
let activeExpression = 'neutral';
let blinkUntil = 0;
let nextBlinkAt = 0;

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
  camera = new THREE.PerspectiveCamera(22, 1, 0.1, 20);
  camera.position.set(0, 1.2, 2.15);
  camera.lookAt(0, 1.12, 0);

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xbfdfff, 1.6));

  const key = new THREE.DirectionalLight(0xd9f0ff, 2.0);
  key.position.set(1.5, 2.6, 2.8);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x96b8ff, 1.2);
  rim.position.set(-1.8, 1.6, -1.6);
  scene.add(rim);

  const resize = () => resizeRenderer(container);
  resize();
  new ResizeObserver(resize).observe(container);

  try {
    await loadVRM(MODEL_URL);
    root?.classList.add('vrm-loaded');
    clock = new THREE.Clock();
    scheduleBlink();
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

export function setAvatarLipSync(value) {
  targetLip = Math.max(0, Math.min(1, Number(value) || 0));
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
          currentVrm.scene.position.set(0, 0.02, 0);
          currentVrm.scene.scale.setScalar(1.25);
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
  updateBlink(elapsed);
  updateLip(delta);
  currentVrm?.update(delta);
  renderer.render(scene, camera);
}

function updateIdlePose(elapsed) {
  if (!currentVrm?.humanoid) return;
  const head = getBone('head');
  const neck = getBone('neck');
  const spine = getBone('spine');
  const leftUpperArm = getBone('leftUpperArm');
  const rightUpperArm = getBone('rightUpperArm');

  if (head) {
    head.rotation.y = Math.sin(elapsed * 0.62) * 0.035;
    head.rotation.x = Math.sin(elapsed * 0.88) * 0.018;
    head.rotation.z = Math.sin(elapsed * 0.48) * 0.025;
  }
  if (neck) neck.rotation.x = Math.sin(elapsed * 0.76) * 0.012;
  if (spine) spine.rotation.z = Math.sin(elapsed * 0.54) * 0.018;
  if (leftUpperArm) leftUpperArm.rotation.z = 1.15 + Math.sin(elapsed * 0.8) * 0.025;
  if (rightUpperArm) rightUpperArm.rotation.z = -1.15 - Math.sin(elapsed * 0.8) * 0.025;
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
  nextBlinkAt = now + 2.2 + Math.random() * 3.5;
}

function applyExpressions() {
  if (!currentVrm?.expressionManager) return;
  for (const name of ['happy', 'sad', 'angry', 'surprised', 'relaxed']) {
    setExpressionValue(name, 0);
  }

  const expression = expressionMap[activeExpression] || 'neutral';
  if (expression !== 'neutral') setExpressionValue(expression, expression === 'relaxed' ? 0.45 : 0.75);
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
