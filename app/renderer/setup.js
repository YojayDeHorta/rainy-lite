import { disposeVrmPreview, setVrmPreviewUrl } from './setup-vrm-preview.js';

const API_BASE = 'http://127.0.0.1:8765';
const PERSONALITY_CUSTOM_MAX = 600;

const botNameInput = document.getElementById('bot-name-input');
const userNameInput = document.getElementById('user-name-input');
const personalityPresetSelect = document.getElementById('personality-preset');
const personalityCustomField = document.getElementById('personality-custom-field');
const personalityCustomInput = document.getElementById('personality-custom');
const personalityCustomCount = document.getElementById('personality-custom-count');
const modelSelect = document.getElementById('model-select');
const continueButton = document.getElementById('continue-button');
const statusEl = document.getElementById('status');
const rollButton = document.getElementById('bot-name-roll');
const previewEl = document.getElementById('vrm-preview');
const previewStatusEl = document.getElementById('preview-status');

const BOT_NAME_POOL = [
  'Luna', 'Yuki', 'Hana', 'Mika', 'Neko', 'Sora', 'Kira', 'Mio', 'Rin', 'Aoi',
  'Nana', 'Yui', 'Kai', 'Ren', 'Hoshi', 'Momo', 'Koko', 'Lila', 'Nia', 'Zoe',
  'Iris', 'Vega', 'Nova', 'Sky', 'Miel', 'Cielo', 'Astra', 'Nami', 'Umi', 'Hikari',
  'Asuka', 'Rei', 'Miku', 'Kana', 'Saki', 'Tomo', 'Yuna', 'Emi', 'Chi', 'Ruri',
];

let modelsList = [];

function fallbackPersonalityPresets() {
  return [
    { id: 'calida_nocturna', label: 'Calida nocturna (por defecto)' },
    { id: 'energica', label: 'Energetica y positiva' },
    { id: 'serena', label: 'Serena y pausada' },
    { id: 'formal', label: 'Formal y cordial' },
    { id: 'juguetona', label: 'Juguetona con humor suave' },
    { id: 'custom', label: 'Personalizada (escribe abajo)' },
  ];
}

async function fetchPersonalityPresets() {
  try {
    const res = await fetch(`${API_BASE}/api/personality/presets`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.presets) ? data.presets : [];
  } catch (_) {
    return [];
  }
}

function populatePersonalitySelect(presets) {
  if (!personalityPresetSelect) return;
  personalityPresetSelect.innerHTML = '';
  for (const item of presets) {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.label || item.id;
    personalityPresetSelect.appendChild(opt);
  }
}

function syncPersonalityCustomVisibility() {
  if (!personalityCustomField || !personalityPresetSelect || !personalityCustomInput) return;
  const isCustom = personalityPresetSelect.value === 'custom';
  personalityCustomField.hidden = !isCustom;
  personalityCustomInput.required = isCustom;
}

function updatePersonalityCharCount() {
  if (!personalityCustomInput || !personalityCustomCount) return;
  personalityCustomCount.textContent = `${personalityCustomInput.value.length}/${PERSONALITY_CUSTOM_MAX}`;
}

function setStatus(text) {
  statusEl.textContent = text || '';
}

function randomBotName() {
  return BOT_NAME_POOL[Math.floor(Math.random() * BOT_NAME_POOL.length)];
}

function rollBotName() {
  let next = randomBotName();
  let guard = 0;
  const current = botNameInput.value.trim();
  while (next === current && guard < 24) {
    next = randomBotName();
    guard += 1;
  }
  botNameInput.value = next;
  validateForm();
}

function validateForm() {
  const bot = botNameInput.value.trim();
  const user = userNameInput.value.trim();
  const model = modelSelect.value;
  const preset = personalityPresetSelect?.value || '';
  const customOk = preset !== 'custom' || personalityCustomInput?.value.trim();
  continueButton.disabled = !(bot && user && model && customOk);
}

function getModelUrl(name) {
  const found = modelsList.find((m) => m.name === name);
  return found?.url || '';
}

async function refreshPreview() {
  previewStatusEl.hidden = true;
  previewStatusEl.textContent = '';
  const url = getModelUrl(modelSelect.value);
  if (!url || !previewEl) return;
  const ok = await setVrmPreviewUrl(previewEl, url);
  if (!ok) {
    previewStatusEl.textContent = 'No se pudo cargar la vista previa.';
    previewStatusEl.hidden = false;
  }
}

async function loadSetupData() {
  setStatus('Cargando modelos...');
  const [profile, modelData, apiPresets] = await Promise.all([
    window.rainyDesktop.getProfile(),
    window.rainyDesktop.listAvatarModels(),
    fetchPersonalityPresets(),
  ]);

  const presets = apiPresets.length ? apiPresets : fallbackPersonalityPresets();
  populatePersonalitySelect(presets);

  modelsList = modelData?.models || [];
  if (!modelsList.length) {
    setStatus('No se encontraron modelos .vrm en assets/models ni assets.');
    continueButton.disabled = true;
    return;
  }

  modelSelect.innerHTML = '';
  for (const model of modelsList) {
    const option = document.createElement('option');
    option.value = model.name;
    option.textContent = model.label || model.name;
    modelSelect.appendChild(option);
  }

  const isFreshSetup = !profile?.setupCompleted;
  if (isFreshSetup) {
    botNameInput.value = randomBotName();
  } else {
    botNameInput.value = profile?.botName || randomBotName();
  }
  userNameInput.value = profile?.userName || '';
  const presetId = String(profile?.personalityPreset || 'calida_nocturna').trim().toLowerCase();
  if (personalityPresetSelect && [...personalityPresetSelect.options].some((o) => o.value === presetId)) {
    personalityPresetSelect.value = presetId;
  }
  if (personalityCustomInput) {
    personalityCustomInput.value = String(profile?.personalityCustom || '').slice(0, PERSONALITY_CUSTOM_MAX);
  }
  syncPersonalityCustomVisibility();
  updatePersonalityCharCount();

  const currentModel = profile?.model || modelData?.current || '';
  if (currentModel) modelSelect.value = currentModel;

  setStatus('');
  validateForm();
  await refreshPreview();
}

rollButton?.addEventListener('click', () => rollBotName());

continueButton.addEventListener('click', async () => {
  const payload = {
    botName: botNameInput.value.trim(),
    userName: userNameInput.value.trim(),
    model: modelSelect.value,
    personalityPreset: personalityPresetSelect?.value || 'calida_nocturna',
    personalityCustom: personalityCustomInput?.value.trim() || '',
  };
  setStatus('Guardando configuración...');
  continueButton.disabled = true;
  const result = await window.rainyDesktop.saveProfile(payload);
  if (result?.ok) {
    setStatus('Listo. Iniciando...');
    disposeVrmPreview();
    return;
  }
  setStatus(result?.message || 'No pude guardar la configuración.');
  validateForm();
});

personalityPresetSelect?.addEventListener('change', () => {
  syncPersonalityCustomVisibility();
  validateForm();
});

personalityCustomInput?.addEventListener('input', () => {
  if (personalityCustomInput.value.length > PERSONALITY_CUSTOM_MAX) {
    personalityCustomInput.value = personalityCustomInput.value.slice(0, PERSONALITY_CUSTOM_MAX);
  }
  updatePersonalityCharCount();
  validateForm();
});

botNameInput.addEventListener('input', validateForm);
userNameInput.addEventListener('input', validateForm);
modelSelect.addEventListener('change', () => {
  validateForm();
  void refreshPreview();
});

window.addEventListener('beforeunload', () => {
  disposeVrmPreview();
});

void loadSetupData();
