import { setVrmPreviewUrl, disposeVrmPreview, updatePreviewSettings } from './setup-vrm-preview.js';

const tabs = document.querySelectorAll('.tab-button');
const contents = document.querySelectorAll('.tab-content');
const settingsSectionTitle = document.getElementById('settings-section-title');

const tabTitles = {
  general: 'General',
  personality: 'Personalidad',
  memory: 'Memoria e historial',
  avatar: 'Ajustes del Avatar',
  voice: 'Voz (Edge TTS)',
};

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    contents.forEach(c => c.classList.remove('active'));
    
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    if (settingsSectionTitle) settingsSectionTitle.textContent = tabTitles[tab.dataset.tab] || tab.textContent.trim();
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
  modelYawDeg: 0,
  modelPitchDeg: 0,
  armHangDeg: 0,
  armAbductionDeg: 0,
};

function migrateAvatarSettingsRaw(parsed) {
  const base = { ...DEFAULT_AVATAR_SETTINGS, ...parsed };
  if (base.armHangDeg === undefined && base.armRaiseDeg != null && base.armRaiseDeg !== '') {
    base.armHangDeg = Math.max(0, Math.min(85, -Number(base.armRaiseDeg)));
  }
  return base;
}

const avatarControls = {
  modelYawDeg: document.getElementById('avatar-model-yaw'),
  modelPitchDeg: document.getElementById('avatar-model-pitch'),
  armHangDeg: document.getElementById('avatar-arm-hang'),
  armAbductionDeg: document.getElementById('avatar-arm-abduction'),
  x: document.getElementById('avatar-x'),
  y: document.getElementById('avatar-y'),
  scale: document.getElementById('avatar-scale'),
  cameraZ: document.getElementById('avatar-camera'),
  light: document.getElementById('avatar-light'),
  motion: document.getElementById('avatar-motion'),
};

const avatarValueLabels = {
  modelYawDeg: document.getElementById('avatar-model-yaw-value'),
  modelPitchDeg: document.getElementById('avatar-model-pitch-value'),
  armHangDeg: document.getElementById('avatar-arm-hang-value'),
  armAbductionDeg: document.getElementById('avatar-arm-abduction-value'),
  x: document.getElementById('avatar-x-value'),
  y: document.getElementById('avatar-y-value'),
  scale: document.getElementById('avatar-scale-value'),
  cameraZ: document.getElementById('avatar-camera-value'),
  light: document.getElementById('avatar-light-value'),
  motion: document.getElementById('avatar-motion-value'),
};
const avatarModelSelect = document.getElementById('avatar-model-select');
const avatarModelUploadButton = document.getElementById('avatar-model-upload-button');
const avatarModelDeleteButton = document.getElementById('avatar-model-delete-button');
const avatarModelStatus = document.getElementById('avatar-model-status');
let loadedAvatarModel = '';
let avatarModelsCache = [];

function loadAvatarSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AVATAR_SETTINGS_KEY) || '{}');
    return migrateAvatarSettingsRaw(parsed);
  } catch (_) {
    return { ...DEFAULT_AVATAR_SETTINGS };
  }
}

function saveAvatarSettings(settings) {
  localStorage.setItem(AVATAR_SETTINGS_KEY, JSON.stringify(settings));
}

function formatAvatarValueLabel(key, value) {
  if (key === 'modelYawDeg' || key === 'modelPitchDeg' || key === 'armHangDeg' || key === 'armAbductionDeg') {
    return `${Math.round(Number(value))}°`;
  }
  return Number(value).toFixed(2);
}

function syncAvatarSettingsUI(settings) {
  for (const [key, control] of Object.entries(avatarControls)) {
    if (!control || !avatarValueLabels[key]) continue;
    control.value = String(settings[key]);
    avatarValueLabels[key].textContent = formatAvatarValueLabel(key, settings[key]);
  }
}

function currentAvatarSettingsFromUI() {
  return {
    modelYawDeg: Number(avatarControls.modelYawDeg.value),
    modelPitchDeg: Number(avatarControls.modelPitchDeg.value),
    armHangDeg: Number(avatarControls.armHangDeg.value),
    armAbductionDeg: Number(avatarControls.armAbductionDeg.value),
    x: Number(avatarControls.x.value),
    y: Number(avatarControls.y.value),
    scale: Number(avatarControls.scale.value),
    cameraZ: Number(avatarControls.cameraZ.value),
    light: Number(avatarControls.light.value),
    motion: Number(avatarControls.motion.value),
  };
}

function applyAvatarSettings(settings) {
  saveAvatarSettings(settings);
  window.rainyDesktop.updateAvatarSettings(settings);
}

function setModelStatus(text) {
  avatarModelStatus.textContent = text || '';
}

function renderModelOptions(models, currentModel) {
  avatarModelsCache = Array.isArray(models) ? models : [];
  avatarModelSelect.innerHTML = '';
  for (const model of avatarModelsCache) {
    const option = document.createElement('option');
    option.value = model.name;
    const baseLabel = model.label || model.name;
    option.textContent = model.isCustom ? `${baseLabel} [Custom]` : baseLabel;
    avatarModelSelect.appendChild(option);
  }
  if (currentModel) avatarModelSelect.value = currentModel;
  loadedAvatarModel = avatarModelSelect.value || '';
  const selected = avatarModelsCache.find((m) => m.name === avatarModelSelect.value);
  avatarModelDeleteButton.disabled = !selected?.isCustom;
  updateSettingsPreview();
}

async function updateSettingsPreview() {
  const container = document.getElementById('vrm-settings-preview');
  const status = document.getElementById('settings-preview-status');
  const spinner = document.getElementById('settings-preview-spinner');
  
  if (!container) return;
  const selected = avatarModelsCache.find((m) => m.name === avatarModelSelect.value);
  if (selected && selected.url) {
    if (status) status.hidden = true;
    if (spinner) spinner.hidden = false;
    
    const ok = await setVrmPreviewUrl(container, selected.url);
    
    if (spinner) spinner.hidden = true;
    
    if (status) {
      if (ok) {
        status.hidden = true;
        updatePreviewSettings(currentAvatarSettingsFromUI());
      }
      else {
        status.textContent = 'Error al cargar preview';
        status.hidden = false;
      }
    }
  } else {
    disposeVrmPreview();
    if (status) status.hidden = true;
    if (spinner) spinner.hidden = true;
  }
}

async function initAvatarModelSelector() {
  try {
    const response = await window.rainyDesktop.listAvatarModels();
    const models = response?.models || [];
    const current = response?.current || '';
    if (!models.length) {
      avatarModelDeleteButton.disabled = true;
      setModelStatus('No se encontraron modelos .vrm en assets/models ni assets.');
      return;
    }
    renderModelOptions(models, current);
    setModelStatus('');
  } catch (_) {
    avatarModelDeleteButton.disabled = true;
    setModelStatus('No pude cargar los modelos.');
  }
}

async function refreshAndSelectAvatarModel(nameToSelect = '') {
  const response = await window.rainyDesktop.listAvatarModels();
  const models = response?.models || [];
  const current = response?.current || '';
  renderModelOptions(models, current);
  if (nameToSelect && models.some((m) => m.name === nameToSelect)) {
    avatarModelSelect.value = nameToSelect;
  }
}

// Init Avatar Settings UI
const initialSettings = loadAvatarSettings();
syncAvatarSettingsUI(initialSettings);

for (const control of Object.values(avatarControls)) {
  control.addEventListener('input', () => {
    const s = currentAvatarSettingsFromUI();
    syncAvatarSettingsUI(s);
    updatePreviewSettings(s);
  });
}

document.getElementById('avatar-save-button').addEventListener('click', async () => {
  const s = currentAvatarSettingsFromUI();
  applyAvatarSettings(s);
  
  const selectedModel = avatarModelSelect?.value || '';
  if (selectedModel && selectedModel !== loadedAvatarModel) {
    setModelStatus('Guardando...');
    const result = await window.rainyDesktop.setCurrentAvatarModel(selectedModel);
    if (result?.ok) {
      loadedAvatarModel = result.model;
      setModelStatus('Ajustes, postura y modelo guardados.');
    } else {
      setModelStatus(result?.message || 'Ajustes guardados, pero falló el modelo.');
    }
  } else {
    setModelStatus('Ajustes y postura guardados.');
  }

  setTimeout(() => setModelStatus(''), 3000);
});

document.getElementById('avatar-reset-button').addEventListener('click', () => {
  const s = { ...DEFAULT_AVATAR_SETTINGS };
  syncAvatarSettingsUI(s);
  updatePreviewSettings(s);
});

avatarModelUploadButton?.addEventListener('click', async () => {
  setModelStatus('Selecciona un .vrm para subir...');
  avatarModelUploadButton.disabled = true;
  try {
    const upload = await window.rainyDesktop.uploadAvatarModel();
    if (!upload?.ok) {
      if (!upload?.cancelled) setModelStatus(upload?.message || 'No se pudo subir el modelo.');
      else setModelStatus('');
      return;
    }
    await refreshAndSelectAvatarModel(upload.model);
    setModelStatus('Modelo subido. Pulsa "Aplicar modelo" para usarlo.');
  } catch (_) {
    setModelStatus('No se pudo subir el modelo.');
  } finally {
    avatarModelUploadButton.disabled = false;
  }
});

avatarModelSelect?.addEventListener('change', () => {
  const selected = avatarModelsCache.find((m) => m.name === avatarModelSelect.value);
  avatarModelDeleteButton.disabled = !selected?.isCustom;
  updateSettingsPreview();
});

avatarModelDeleteButton?.addEventListener('click', async () => {
  const selectedName = avatarModelSelect?.value || '';
  if (!selectedName) {
    setModelStatus('Selecciona un modelo para eliminar.');
    return;
  }
  const selected = avatarModelsCache.find((m) => m.name === selectedName);
  if (!selected?.isCustom) {
    setModelStatus('Solo se pueden eliminar modelos custom.');
    return;
  }
  const ok = window.confirm(`Eliminar modelo custom "${selected.label || selected.name}"?`);
  if (!ok) return;

  avatarModelDeleteButton.disabled = true;
  setModelStatus('Eliminando modelo custom...');
  try {
    const result = await window.rainyDesktop.deleteAvatarModel(selectedName);
    if (!result?.ok) {
      setModelStatus(result?.message || 'No se pudo eliminar el modelo.');
      return;
    }
    await refreshAndSelectAvatarModel(result.currentModel || '');
    loadedAvatarModel = result.currentModel || loadedAvatarModel;
    setModelStatus('Modelo custom eliminado.');
  } catch (_) {
    setModelStatus('No se pudo eliminar el modelo.');
  } finally {
    const currentSel = avatarModelsCache.find((m) => m.name === (avatarModelSelect?.value || ''));
    avatarModelDeleteButton.disabled = !currentSel?.isCustom;
  }
});

const API_BASE_TTS = 'http://127.0.0.1:8765';
let ttsEnvDefaults = null;
let ttsVoicesCache = [];

const ttsVoiceSelect = document.getElementById('tts-voice-select');
const ttsFilterEs = document.getElementById('tts-filter-es');
const ttsRate = document.getElementById('tts-rate');
const ttsPitch = document.getElementById('tts-pitch');
const ttsVolume = document.getElementById('tts-volume');
const ttsRateValue = document.getElementById('tts-rate-value');
const ttsPitchValue = document.getElementById('tts-pitch-value');
const ttsVolumeValue = document.getElementById('tts-volume-value');
const ttsStatus = document.getElementById('tts-status');
const ttsResetButton = document.getElementById('tts-reset-button');

function parsePercent(str) {
  const m = String(str || '').trim().match(/^([+-]?\d+(?:\.\d+)?)%$/);
  if (!m) return 0;
  return Math.round(Number(m[1]));
}

function formatPercent(n) {
  const v = Math.max(-50, Math.min(100, Number(n) || 0));
  return `${v >= 0 ? '+' : ''}${v}%`;
}

function parseHz(str) {
  const m = String(str || '').trim().match(/^([+-]?\d+(?:\.\d+)?)\s*Hz$/i);
  if (!m) return 0;
  return Math.round(Number(m[1]));
}

function formatHz(n) {
  const v = Math.max(-50, Math.min(50, Number(n) || 0));
  return `${v >= 0 ? '+' : ''}${v}Hz`;
}

function setTtsStatus(msg) {
  if (ttsStatus) ttsStatus.textContent = msg || '';
}

async function waitBackendTts() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${API_BASE_TTS}/api/health`);
      if (res.ok) return true;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

function filteredVoices() {
  const all = ttsVoicesCache || [];
  if (!ttsFilterEs?.checked) return all;
  return all.filter((v) => String(v.locale || '').toLowerCase().startsWith('es'));
}

function renderTtsVoiceOptions(selectedShortName) {
  if (!ttsVoiceSelect) return;
  const list = filteredVoices();
  const want = selectedShortName || '';
  ttsVoiceSelect.innerHTML = '';
  for (const v of list) {
    const opt = document.createElement('option');
    opt.value = v.short_name;
    const label = v.friendly_name || v.short_name;
    opt.textContent = `${label} (${v.locale})`;
    ttsVoiceSelect.appendChild(opt);
  }
  if (want && !list.some((x) => x.short_name === want)) {
    const opt = document.createElement('option');
    opt.value = want;
    opt.textContent = want;
    ttsVoiceSelect.appendChild(opt);
  }
  if (want && [...ttsVoiceSelect.options].some((o) => o.value === want)) {
    ttsVoiceSelect.value = want;
  } else if (list[0]) {
    ttsVoiceSelect.value = list[0].short_name;
  }
}

function applyTtsSliders(rateStr, pitchStr, volumeStr) {
  const rv = parsePercent(rateStr);
  const pv = parseHz(pitchStr);
  const vv = parsePercent(volumeStr);
  if (ttsRate) ttsRate.value = String(rv);
  if (ttsPitch) ttsPitch.value = String(pv);
  if (ttsVolume) ttsVolume.value = String(vv);
  if (ttsRateValue) ttsRateValue.textContent = formatPercent(rv);
  if (ttsPitchValue) ttsPitchValue.textContent = formatHz(pv);
  if (ttsVolumeValue) ttsVolumeValue.textContent = formatPercent(vv);
}

function readTtsControlsPayload() {
  return {
    voice: ttsVoiceSelect?.value || '',
    rate: formatPercent(ttsRate?.value || 0),
    pitch: formatHz(ttsPitch?.value || 0),
    volume: formatPercent(ttsVolume?.value || 0),
  };
}

async function persistTtsFromControls() {
  const p = readTtsControlsPayload();
  await window.rainyDesktop.setTtsPreferences({
    voice: p.voice,
    rate: p.rate,
    pitch: p.pitch,
    volume: p.volume,
  });
  setTtsStatus('Guardado.');
}

function mergeTtsEffective(saved, baseline) {
  return {
    voice: (saved?.voice && String(saved.voice).trim()) ? saved.voice : baseline.voice,
    rate: (saved?.rate && String(saved.rate).trim()) ? saved.rate : baseline.rate,
    pitch: (saved?.pitch && String(saved.pitch).trim()) ? saved.pitch : baseline.pitch,
    volume: (saved?.volume && String(saved.volume).trim()) ? saved.volume : baseline.volume,
  };
}

async function initVoiceTab() {
  if (!ttsVoiceSelect) return;
  setTtsStatus('Cargando...');
  const backendOk = await waitBackendTts();
  if (!backendOk) {
    setTtsStatus('Backend no disponible.');
    return;
  }
  try {
    const [defRes, voRes] = await Promise.all([
      fetch(`${API_BASE_TTS}/api/tts/defaults`),
      fetch(`${API_BASE_TTS}/api/tts/voices`),
    ]);
    if (!defRes.ok || !voRes.ok) throw new Error('fetch');
    ttsEnvDefaults = await defRes.json();
    const voJson = await voRes.json();
    ttsVoicesCache = voJson.voices || [];
  } catch (_) {
    setTtsStatus('No pude cargar voces ni valores por defecto.');
    return;
  }

  let saved = {};
  try {
    saved = await window.rainyDesktop.getTtsPreferences();
  } catch (_) {}
  const effective = mergeTtsEffective(saved, ttsEnvDefaults);
  renderTtsVoiceOptions(effective.voice);
  applyTtsSliders(effective.rate, effective.pitch, effective.volume);
  setTtsStatus('');

  ttsFilterEs?.addEventListener('change', () => {
    const cur = ttsVoiceSelect?.value || '';
    renderTtsVoiceOptions(cur);
    void persistTtsFromControls();
  });

  ttsVoiceSelect.addEventListener('change', () => {
    void persistTtsFromControls();
  });

  ttsRate?.addEventListener('input', () => {
    if (ttsRateValue) ttsRateValue.textContent = formatPercent(ttsRate.value);
  });
  ttsRate?.addEventListener('change', () => void persistTtsFromControls());

  ttsPitch?.addEventListener('input', () => {
    if (ttsPitchValue) ttsPitchValue.textContent = formatHz(ttsPitch.value);
  });
  ttsPitch?.addEventListener('change', () => void persistTtsFromControls());

  ttsVolume?.addEventListener('input', () => {
    if (ttsVolumeValue) ttsVolumeValue.textContent = formatPercent(ttsVolume.value);
  });
  ttsVolume?.addEventListener('change', () => void persistTtsFromControls());

  ttsResetButton?.addEventListener('click', async () => {
    try {
      const res = await fetch(`${API_BASE_TTS}/api/tts/defaults`);
      if (!res.ok) throw new Error('defaults');
      ttsEnvDefaults = await res.json();
      await window.rainyDesktop.setTtsPreferences({
        voice: ttsEnvDefaults.voice,
        rate: ttsEnvDefaults.rate,
        pitch: ttsEnvDefaults.pitch,
        volume: ttsEnvDefaults.volume,
      });
      renderTtsVoiceOptions(ttsEnvDefaults.voice);
      applyTtsSliders(ttsEnvDefaults.rate, ttsEnvDefaults.pitch, ttsEnvDefaults.volume);
      setTtsStatus('Reseteado correctamente.');
    } catch (_) {
      setTtsStatus('No pude aplicar reset.');
    }
  });
}

void initVoiceTab();

const PERSONALITY_CUSTOM_MAX = 600;

const settingsPersonalityPreset = document.getElementById('settings-personality-preset');
const settingsPersonalityCustomField = document.getElementById('settings-personality-custom-field');
const settingsPersonalityCustom = document.getElementById('settings-personality-custom');
const settingsPersonalityCustomCount = document.getElementById('settings-personality-custom-count');
const settingsPersonalitySave = document.getElementById('settings-personality-save');
const settingsPersonalityStatus = document.getElementById('settings-personality-status');

function fallbackPersonalityPresetsSettings() {
  return [
    { id: 'calida_nocturna', label: 'Calida nocturna (por defecto)' },
    { id: 'energica', label: 'Energetica y positiva' },
    { id: 'serena', label: 'Serena y pausada' },
    { id: 'formal', label: 'Formal y cordial' },
    { id: 'juguetona', label: 'Juguetona con humor suave' },
    { id: 'custom', label: 'Personalizada (escribe abajo)' },
  ];
}

async function fetchPersonalityPresetsSettings() {
  try {
    const res = await fetch(`${API_BASE_TTS}/api/personality/presets`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.presets) ? data.presets : [];
  } catch (_) {
    return [];
  }
}

function populateSettingsPersonalitySelect(presets) {
  if (!settingsPersonalityPreset) return;
  settingsPersonalityPreset.innerHTML = '';
  for (const item of presets) {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.label || item.id;
    settingsPersonalityPreset.appendChild(opt);
  }
}

function syncSettingsPersonalityCustomVisibility() {
  if (!settingsPersonalityCustomField || !settingsPersonalityPreset || !settingsPersonalityCustom) return;
  const isCustom = settingsPersonalityPreset.value === 'custom';
  settingsPersonalityCustomField.hidden = !isCustom;
}

function updateSettingsPersonalityCharCount() {
  if (!settingsPersonalityCustom || !settingsPersonalityCustomCount) return;
  settingsPersonalityCustomCount.textContent = `${settingsPersonalityCustom.value.length}/${PERSONALITY_CUSTOM_MAX}`;
}

function setPersonalitySettingsStatus(text) {
  if (settingsPersonalityStatus) settingsPersonalityStatus.textContent = text || '';
}

async function initPersonalityTab() {
  if (!settingsPersonalityPreset) return;

  const apiPresets = await fetchPersonalityPresetsSettings();
  const presets = apiPresets.length ? apiPresets : fallbackPersonalityPresetsSettings();
  populateSettingsPersonalitySelect(presets);

  let profile = {};
  try {
    profile = await window.rainyDesktop.getProfile();
  } catch (_) {
  }

  const presetId = String(profile?.personalityPreset || 'calida_nocturna').trim().toLowerCase();
  if ([...settingsPersonalityPreset.options].some((o) => o.value === presetId)) {
    settingsPersonalityPreset.value = presetId;
  }
  settingsPersonalityCustom.value = String(profile?.personalityCustom || '').slice(0, PERSONALITY_CUSTOM_MAX);
  syncSettingsPersonalityCustomVisibility();
  updateSettingsPersonalityCharCount();

  settingsPersonalityPreset.addEventListener('change', () => {
    syncSettingsPersonalityCustomVisibility();
    setPersonalitySettingsStatus('');
  });

  settingsPersonalityCustom?.addEventListener('input', () => {
    if (settingsPersonalityCustom.value.length > PERSONALITY_CUSTOM_MAX) {
      settingsPersonalityCustom.value = settingsPersonalityCustom.value.slice(0, PERSONALITY_CUSTOM_MAX);
    }
    updateSettingsPersonalityCharCount();
    setPersonalitySettingsStatus('');
  });

  settingsPersonalitySave?.addEventListener('click', async () => {
    const preset = settingsPersonalityPreset.value || 'calida_nocturna';
    const custom = settingsPersonalityCustom?.value.trim() || '';
    if (preset === 'custom' && !custom) {
      setPersonalitySettingsStatus('Escribe como debe sonar tu asistente.');
      return;
    }
    setPersonalitySettingsStatus('Guardando...');
    try {
      const result = await window.rainyDesktop.patchProfile({
        personalityPreset: preset,
        personalityCustom: custom,
      });
      if (result?.ok) {
        setPersonalitySettingsStatus('Guardado.');
      } else {
        setPersonalitySettingsStatus(result?.message || 'No se pudo guardar.');
      }
    } catch (_) {
      setPersonalitySettingsStatus('No se pudo guardar.');
    }
  });
}

void initPersonalityTab();

const sessionsList = document.getElementById('sessions-list');
const sessionsRefreshButton = document.getElementById('sessions-refresh-button');
const sessionsStatus = document.getElementById('sessions-status');
const memoriesList = document.getElementById('memories-list');
const memoriesRefreshButton = document.getElementById('memories-refresh-button');
const memoriesClearButton = document.getElementById('memories-clear-button');
const memoriesStatus = document.getElementById('memories-status');

function setSessionsStatus(text) {
  if (sessionsStatus) sessionsStatus.textContent = text || '';
}

function setMemoriesStatus(text) {
  if (memoriesStatus) memoriesStatus.textContent = text || '';
}

function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

function emptyRow(text) {
  const row = document.createElement('div');
  row.className = 'memory-row';
  const body = document.createElement('div');
  body.className = 'memory-meta';
  body.textContent = text;
  row.appendChild(body);
  return row;
}

async function loadSessionsPanel() {
  if (!sessionsList) return;
  setSessionsStatus('Cargando...');
  sessionsList.innerHTML = '';
  try {
    const res = await fetch(`${API_BASE_TTS}/api/chat/sessions`);
    if (!res.ok) throw new Error('sessions');
    const data = await res.json();
    const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
    if (!sessions.length) {
      sessionsList.appendChild(emptyRow('No hay conversaciones guardadas todavia.'));
      setSessionsStatus('');
      return;
    }
    for (const session of sessions) {
      const row = document.createElement('div');
      row.className = 'memory-row';
      const body = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'memory-title';
      title.textContent = session.title || `Conversación #${session.id}`;
      const meta = document.createElement('div');
      meta.className = 'memory-meta';
      meta.textContent = `Actualizada: ${formatDateTime(session.updated_at)}`;
      const summary = document.createElement('div');
      summary.className = 'memory-summary';
      summary.textContent = session.summary || 'Sin resumen todavía.';
      body.append(title, meta, summary);

      const actions = document.createElement('div');
      actions.className = 'model-actions';
      actions.style.marginTop = '0';

      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'btn-secondary';
      openButton.textContent = 'Abrir';
      openButton.addEventListener('click', async () => {
        setSessionsStatus('Abriendo...');
        const active = await fetch(`${API_BASE_TTS}/api/chat/sessions/${session.id}/activate`, { method: 'POST' });
        if (!active.ok) {
          setSessionsStatus('No se pudo abrir.');
          return;
        }
        await window.rainyDesktop.openChatSession(session.id);
        setSessionsStatus('Conversación abierta en el chat.');
        await loadSessionsPanel();
      });

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'btn-secondary';
      deleteButton.textContent = 'Borrar';
      deleteButton.addEventListener('click', async () => {
        if (!window.confirm('¿Borrar esta conversación?')) return;
        setSessionsStatus('Borrando...');
        const del = await fetch(`${API_BASE_TTS}/api/chat/sessions/${session.id}`, { method: 'DELETE' });
        if (!del.ok) {
          setSessionsStatus('No se pudo borrar.');
          return;
        }
        await loadSessionsPanel();
      });

      actions.append(openButton, deleteButton);
      row.append(body, actions);
      sessionsList.appendChild(row);
    }
    setSessionsStatus('');
  } catch (_) {
    sessionsList.appendChild(emptyRow('No pude cargar conversaciones.'));
    setSessionsStatus('');
  }
}

async function loadMemoriesPanel() {
  if (!memoriesList) return;
  setMemoriesStatus('Cargando...');
  memoriesList.innerHTML = '';
  try {
    const res = await fetch(`${API_BASE_TTS}/api/memory`);
    if (!res.ok) throw new Error('memories');
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) {
      memoriesList.appendChild(emptyRow('No hay memorias persistentes guardadas.'));
      setMemoriesStatus('');
      return;
    }
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'memory-row';
      const body = document.createElement('div');
      const content = document.createElement('div');
      content.className = 'memory-title';
      content.textContent = item.content || '';
      const meta = document.createElement('div');
      meta.className = 'memory-meta';
      meta.textContent = item.created_at ? `Guardada: ${formatDateTime(item.created_at)}` : '';
      body.append(content, meta);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'btn-secondary';
      deleteButton.textContent = 'Borrar';
      deleteButton.addEventListener('click', async () => {
        setMemoriesStatus('Borrando...');
        const del = await fetch(`${API_BASE_TTS}/api/memory/${item.id}`, { method: 'DELETE' });
        if (!del.ok) {
          setMemoriesStatus('No se pudo borrar.');
          return;
        }
        await loadMemoriesPanel();
      });

      row.append(body, deleteButton);
      memoriesList.appendChild(row);
    }
    setMemoriesStatus('');
  } catch (_) {
    memoriesList.appendChild(emptyRow('No pude cargar memorias.'));
    setMemoriesStatus('');
  }
}

sessionsRefreshButton?.addEventListener('click', () => void loadSessionsPanel());
memoriesRefreshButton?.addEventListener('click', () => void loadMemoriesPanel());
memoriesClearButton?.addEventListener('click', async () => {
  if (!window.confirm('¿Borrar todas las memorias persistentes?')) return;
  setMemoriesStatus('Borrando...');
  try {
    const res = await fetch(`${API_BASE_TTS}/api/memory`, { method: 'DELETE' });
    if (!res.ok) throw new Error('clear');
    await loadMemoriesPanel();
  } catch (_) {
    setMemoriesStatus('No se pudieron borrar las memorias.');
  }
});

void loadSessionsPanel();
void loadMemoriesPanel();

void initAvatarModelSelector();
