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
  if (pivot) pivot.rotation.y += delta * 0.35;
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

  const ambient = new THREE.AmbientLight(0xbfdfff, 0.55);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xd9f0ff, 0.75);
  key.position.set(1.5, 2.6, 2.8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x96b8ff, 0.3);
  rim.position.set(-1.8, 1.6, -1.6);
  scene.add(rim);

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
          if (!vrm) throw new Error('No VRM');
          vrm.scene.rotation.y = Math.PI;
          vrm.scene.position.set(0, 0.0, 0);
          vrm.scene.scale.setScalar(1);

          if (vrm.humanoid) {
            const leftArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
            const rightArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
            if (leftArm) {
              leftArm.rotation.z = 1.2;
              leftArm.rotation.x = 0.1;
            }
            if (rightArm) {
              rightArm.rotation.z = -1.2;
              rightArm.rotation.x = 0.1;
            }
          }

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
    return true;
  } catch (_) {
    if (token === loadToken) teardownVrm();
    return false;
  }
}
