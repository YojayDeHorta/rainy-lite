const tabs = document.querySelectorAll('.tab-button');
const contents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    contents.forEach(c => c.classList.remove('active'));
    
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

const closeButton = document.getElementById('settings-close-button');
const editProfileButton = document.getElementById('edit-profile-button');
closeButton?.addEventListener('click', () => {
  window.rainyDesktop.close();
});
editProfileButton?.addEventListener('click', () => {
  window.rainyDesktop.openSetupWindow();
  window.rainyDesktop.close();
});

const micDeviceSelect = document.getElementById('mic-device-select');
const micRefreshButton = document.getElementById('mic-refresh-button');
const micPermitButton = document.getElementById('mic-permit-button');
const micHint = document.getElementById('mic-hint');

function micDisplayLabel(device) {
  const label = String(device?.label || '').trim();
  if (label) return label;
  const id = String(device?.deviceId || '');
  if (!id) return 'Microfono';
  const tail = id.length > 12 ? `…${id.slice(-10)}` : id;
  return `Microfono (${tail})`;
}

async function populateMicSelect() {
  if (!micDeviceSelect) return;
  let saved = '';
  try {
    const prefs = await window.rainyDesktop.getMicDevice();
    saved = String(prefs?.deviceId || '').trim();
  } catch (_) {
  }

  let devices = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch (_) {
    if (micHint) micHint.textContent = 'No pude listar microfonos.';
    return;
  }

  const inputs = devices.filter((d) => d.kind === 'audioinput');
  micDeviceSelect.innerHTML = '';

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Predeterminado del sistema';
  micDeviceSelect.appendChild(defaultOpt);

  for (const d of inputs) {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = micDisplayLabel(d);
    micDeviceSelect.appendChild(opt);
  }

  const match = saved && inputs.some((d) => d.deviceId === saved);
  if (saved && !match) {
    try {
      await window.rainyDesktop.setMicDevice('');
    } catch (_) {
    }
  }
  micDeviceSelect.value = match ? saved : '';

  if (!micHint) return;
  if (!inputs.length) {
    micHint.textContent = 'No se detectaron microfonos.';
  } else {
    const unnamed = inputs.some((d) => !String(d.label || '').trim());
    micHint.textContent = unnamed
      ? 'Si los nombres aparecen vacios, pulsa «Permitir y refrescar».'
      : '';
  }
}

micDeviceSelect?.addEventListener('change', async () => {
  const value = micDeviceSelect.value || '';
  await window.rainyDesktop.setMicDevice(value);
});

micRefreshButton?.addEventListener('click', () => {
  void populateMicSelect();
});

micPermitButton?.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch (_) {
    if (micHint) micHint.textContent = 'Permiso denegado o sin microfono.';
    return;
  }
  await populateMicSelect();
});

if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    void populateMicSelect();
  });
}

void populateMicSelect();

// Theme Logic
const themeToggle = document.getElementById('theme-toggle');

function applyTheme(isDark) {
  document.body.classList.toggle('dark-theme', isDark);
}

const isDark = localStorage.getItem('rainy-dark-theme') === 'true';
themeToggle.checked = isDark;
applyTheme(isDark);

themeToggle.addEventListener('change', () => {
  const dark = themeToggle.checked;
  localStorage.setItem('rainy-dark-theme', dark);
  applyTheme(dark);
  window.rainyDesktop.updateTheme(dark);
});

// Avatar Settings Logic
const AVATAR_SETTINGS_KEY = 'rainy-avatar-settings-v1';
const DEFAULT_AVATAR_SETTINGS = {
  x: 0,
  y: 1.03,
  scale: 0.85,
  cameraZ: 3.4,
  light: 0.75,
  motion: 1.0,
};

const avatarControls = {
  x: document.getElementById('avatar-x'),
  y: document.getElementById('avatar-y'),
  scale: document.getElementById('avatar-scale'),
  cameraZ: document.getElementById('avatar-camera'),
  light: document.getElementById('avatar-light'),
  motion: document.getElementById('avatar-motion'),
};

const avatarValueLabels = {
  x: document.getElementById('avatar-x-value'),
  y: document.getElementById('avatar-y-value'),
  scale: document.getElementById('avatar-scale-value'),
  cameraZ: document.getElementById('avatar-camera-value'),
  light: document.getElementById('avatar-light-value'),
  motion: document.getElementById('avatar-motion-value'),
};
const avatarModelSelect = document.getElementById('avatar-model-select');
const avatarModelApplyButton = document.getElementById('avatar-model-apply-button');
const avatarModelStatus = document.getElementById('avatar-model-status');
let loadedAvatarModel = '';

function loadAvatarSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AVATAR_SETTINGS_KEY) || '{}');
    return { ...DEFAULT_AVATAR_SETTINGS, ...parsed };
  } catch (_) {
    return { ...DEFAULT_AVATAR_SETTINGS };
  }
}

function saveAvatarSettings(settings) {
  localStorage.setItem(AVATAR_SETTINGS_KEY, JSON.stringify(settings));
}

function syncAvatarSettingsUI(settings) {
  for (const [key, control] of Object.entries(avatarControls)) {
    control.value = String(settings[key]);
    avatarValueLabels[key].textContent = Number(settings[key]).toFixed(2);
  }
}

function currentAvatarSettingsFromUI() {
  return {
    x: Number(avatarControls.x.value),
    y: Number(avatarControls.y.value),
    scale: Number(avatarControls.scale.value),
    cameraZ: Number(avatarControls.cameraZ.value),
    light: Number(avatarControls.light.value),
    motion: Number(avatarControls.motion.value),
  };
}

function applyAvatarSettings(settings) {
  syncAvatarSettingsUI(settings);
  saveAvatarSettings(settings);
  window.rainyDesktop.updateAvatarSettings(settings);
}

function setModelStatus(text) {
  avatarModelStatus.textContent = text || '';
}

function renderModelOptions(models, currentModel) {
  avatarModelSelect.innerHTML = '';
  for (const model of models) {
    const option = document.createElement('option');
    option.value = model.name;
    option.textContent = model.label || model.name;
    avatarModelSelect.appendChild(option);
  }
  if (currentModel) avatarModelSelect.value = currentModel;
  loadedAvatarModel = avatarModelSelect.value || '';
}

async function initAvatarModelSelector() {
  try {
    const response = await window.rainyDesktop.listAvatarModels();
    const models = response?.models || [];
    const current = response?.current || '';
    if (!models.length) {
      avatarModelApplyButton.disabled = true;
      setModelStatus('No se encontraron modelos .vrm en assets/models ni assets.');
      return;
    }
    renderModelOptions(models, current);
    setModelStatus('');
  } catch (_) {
    avatarModelApplyButton.disabled = true;
    setModelStatus('No pude cargar los modelos.');
  }
}

// Init Avatar Settings UI
const initialSettings = loadAvatarSettings();
syncAvatarSettingsUI(initialSettings);

for (const control of Object.values(avatarControls)) {
  control.addEventListener('input', () => applyAvatarSettings(currentAvatarSettingsFromUI()));
}

document.getElementById('avatar-reset-button').addEventListener('click', () => {
  applyAvatarSettings({ ...DEFAULT_AVATAR_SETTINGS });
});

avatarModelApplyButton?.addEventListener('click', async () => {
  const selected = avatarModelSelect?.value || '';
  if (!selected || selected === loadedAvatarModel) {
    setModelStatus('Sin cambios por aplicar.');
    return;
  }
  setModelStatus('Aplicando modelo...');
  const result = await window.rainyDesktop.setCurrentAvatarModel(selected);
  if (result?.ok) {
    loadedAvatarModel = result.model;
    setModelStatus('Modelo aplicado.');
  } else {
    setModelStatus(result?.message || 'No se pudo aplicar el modelo.');
  }
});

void initAvatarModelSelector();
