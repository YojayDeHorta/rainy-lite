import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

let scene;
let camera;
let renderer;
let pivot;
let currentVrm = null;
let containerEl = null;
let rafId = null;
let clock;
let loadToken = 0;
let previewActive = false;
let ambientLight;
let keyLight;
let rimLight;
const PREVIEW_Y_OFFSET = -0.65;
let currentSettings = {
  x: 0, y: 1.03, scale: 0.85, cameraZ: 3.4, light: 0.75, modelYawDeg: 0, modelPitchDeg: 0, armHangDeg: 0, armAbductionDeg: 0
};

function resize() {
  if (!renderer || !camera || !containerEl) return;
  const width = Math.max(1, containerEl.clientWidth);
  const height = Math.max(1, containerEl.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  if (!previewActive || !renderer || !clock) return;
  rafId = requestAnimationFrame(animate);
  const delta = clock.getDelta();
  currentVrm?.update(delta);
  renderer.render(scene, camera);
}

function teardownVrm() {
  if (currentVrm) {
    try {
      pivot?.remove(currentVrm.scene);
      currentVrm.dispose?.();
    } catch (_) {
    }
    currentVrm = null;
  }
}

export function disposeVrmPreview() {
  previewActive = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  teardownVrm();
  if (pivot && scene) {
    scene.remove(pivot);
    pivot = null;
  }
  if (renderer) {
    renderer.dispose();
    renderer.domElement?.remove();
  }
  renderer = null;
  scene = null;
  camera = null;
  containerEl = null;
  clock = null;
}

function ensureScene(container) {
  if (renderer && containerEl === container) {
    previewActive = true;
    return;
  }
  disposeVrmPreview();
  containerEl = container;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(24, 1, 0.1, 20);
  camera.position.set(0, 1.0, 4.4);
  camera.lookAt(0, 0.85, 0);

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  ambientLight = new THREE.AmbientLight(0xbfdfff, 0.55);
  scene.add(ambientLight);
  keyLight = new THREE.DirectionalLight(0xd9f0ff, 0.75);
  keyLight.position.set(1.5, 2.6, 2.8);
  scene.add(keyLight);
  rimLight = new THREE.DirectionalLight(0x96b8ff, 0.3);
  rimLight.position.set(-1.8, 1.6, -1.6);
  scene.add(rimLight);

  pivot = new THREE.Group();
  scene.add(pivot);

  clock = new THREE.Clock();
  resize();
  new ResizeObserver(resize).observe(container);
  previewActive = true;
  rafId = requestAnimationFrame(animate);
}

function loadVrm(url) {
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
          updatePreviewSettings(currentSettings);
          resolve(vrm);
        } catch (e) {
          reject(e);
        }
      },
      undefined,
      reject,
    );
  });
}

export async function setVrmPreviewUrl(container, url) {
  const next = String(url || '').trim();
  if (!container || !next) return false;
  const token = ++loadToken;
  ensureScene(container);
  teardownVrm();
  try {
    const vrm = await loadVrm(next);
    if (token !== loadToken) {
      vrm.dispose?.();
      return false;
    }
    currentVrm = vrm;
    pivot.add(vrm.scene);
    updatePreviewSettings(currentSettings);
    return true;
  } catch (_) {
    if (token === loadToken) teardownVrm();
    return false;
  }
}

export function updatePreviewSettings(settings) {
  currentSettings = { ...currentSettings, ...settings };
  
  if (ambientLight) ambientLight.intensity = 0.55 * (currentSettings.light || 1);
  if (keyLight) keyLight.intensity = 0.75 * (currentSettings.light || 1);
  if (rimLight) rimLight.intensity = 0.3 * (currentSettings.light || 1);
  
  if (camera) {
    camera.position.set(0, 1.18, currentSettings.cameraZ || 3.4);
    camera.lookAt(0, 1.05, 0);
  }
  
  if (pivot) {
    pivot.position.set(
      currentSettings.x || 0,
      (currentSettings.y || 0) + PREVIEW_Y_OFFSET,
      0,
    );
    pivot.scale.setScalar(currentSettings.scale || 1);
  }

  if (currentVrm && currentVrm.scene) {
    const s = currentVrm.scene;
    const yawBase = Math.PI + THREE.MathUtils.degToRad(currentSettings.modelYawDeg || 0);
    s.rotation.order = 'YXZ';
    s.rotation.x = THREE.MathUtils.degToRad(currentSettings.modelPitchDeg || 0);
    s.rotation.y = yawBase;
    s.rotation.z = 0;

    if (currentVrm.humanoid) {
      const leftArm = currentVrm.humanoid.getNormalizedBoneNode('leftUpperArm');
      const rightArm = currentVrm.humanoid.getNormalizedBoneNode('rightUpperArm');
      const armHangRad = THREE.MathUtils.degToRad(currentSettings.armHangDeg || 0);
      const armAbRad = THREE.MathUtils.degToRad(currentSettings.armAbductionDeg || 0);
      
      if (leftArm) {
        leftArm.rotation.x = 0.24 + armHangRad;
        leftArm.rotation.z = 1.22 - armAbRad;
      }
      if (rightArm) {
        rightArm.rotation.x = 0.24 + armHangRad;
        rightArm.rotation.z = -1.22 + armAbRad;
      }
    }
  }
}
