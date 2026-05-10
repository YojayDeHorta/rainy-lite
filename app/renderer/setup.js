import { disposeVrmPreview, setVrmPreviewUrl, updatePreviewSettings, setPreviewSpin, setPreviewIdleMotion } from './setup-vrm-preview.js';

const API_BASE = 'http://127.0.0.1:8765';
const PERSONALITY_CUSTOM_MAX = 600;
const AVATAR_SETTINGS_KEY = 'rainy-avatar-settings-v1';
const SETUP_PREVIEW_SETTINGS = {
  x: 0,
  y: 1.03,
  scale: 0.85,
  cameraZ: 3.4,
  light: 0.75,
  modelYawDeg: 0,
  modelPitchDeg: 0,
  armHangDeg: 0,
  armAbductionDeg: 0,
};

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
const privacyConsentCheckbox = document.getElementById('privacy-consent-checkbox');
const policyModal = document.getElementById('policy-modal');
const policyModalTitle = document.getElementById('policy-modal-title');
const policyModalBody = document.getElementById('policy-modal-body');
const policyModalClose = document.getElementById('policy-modal-close');

const POLICY_TEXT = {
  privacy: {
    title: 'Politica de privacidad',
    paragraphs: [
      'La aplicacion guarda informacion local para funcionar, como tu perfil, preferencias, conversaciones, memorias y configuracion.',
      'Algunas funciones pueden procesar texto o audio para responder, transcribir, ejecutar acciones solicitadas o mejorar la experiencia del asistente.',
      'La aplicacion no esta pensada para recopilar datos con fines publicitarios. Puedes revisar y borrar conversaciones o memorias desde Configuracion cuando corresponda.',
      'Evita compartir contrasenas, claves privadas, tokens u otra informacion sensible dentro de conversaciones o configuraciones.',
    ],
  },
  services: {
    title: 'Configuracion de servicios',
    paragraphs: [
      'Algunas funciones pueden depender de servicios externos configurados por el usuario, por la distribucion o por el entorno donde se ejecute la aplicacion.',
      'Esto puede incluir respuestas del asistente, transcripcion de voz, busqueda de musica, estado de presencia, voz, acciones integradas u otras funciones opcionales.',
      'Cuando una funcion externa esta activa, la aplicacion puede enviar el contenido necesario para completar esa accion. Las funciones disponibles dependen de la configuracion instalada.',
      'Puedes cambiar opciones relacionadas desde Configuracion cuando esten disponibles.',
    ],
  },
};

const BOT_NAME_POOL = [
  'Luna', 'Yuki', 'Hana', 'Mika', 'Neko', 'Sora', 'Kira', 'Mio', 'Rin', 'Aoi',
  'Nana', 'Yui', 'Kai', 'Ren', 'Hoshi', 'Momo', 'Koko', 'Lila', 'Nia', 'Zoe',
  'Iris', 'Vega', 'Nova', 'Sky', 'Miel', 'Cielo', 'Astra', 'Nami', 'Umi', 'Hikari',
  'Asuka', 'Rei', 'Miku', 'Kana', 'Saki', 'Tomo', 'Yuna', 'Emi', 'Chi', 'Ruri',
];

let modelsList = [];

function loadSavedAvatarPose() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AVATAR_SETTINGS_KEY) || '{}');
    return {
      modelYawDeg: Number.isFinite(Number(parsed?.modelYawDeg)) ? Number(parsed.modelYawDeg) : SETUP_PREVIEW_SETTINGS.modelYawDeg,
      modelPitchDeg: Number.isFinite(Number(parsed?.modelPitchDeg)) ? Number(parsed.modelPitchDeg) : SETUP_PREVIEW_SETTINGS.modelPitchDeg,
      armHangDeg: Number.isFinite(Number(parsed?.armHangDeg)) ? Number(parsed.armHangDeg) : SETUP_PREVIEW_SETTINGS.armHangDeg,
      armAbductionDeg: Number.isFinite(Number(parsed?.armAbductionDeg)) ? Number(parsed.armAbductionDeg) : SETUP_PREVIEW_SETTINGS.armAbductionDeg,
    };
  } catch (_) {
    return {
      modelYawDeg: SETUP_PREVIEW_SETTINGS.modelYawDeg,
      modelPitchDeg: SETUP_PREVIEW_SETTINGS.modelPitchDeg,
      armHangDeg: SETUP_PREVIEW_SETTINGS.armHangDeg,
      armAbductionDeg: SETUP_PREVIEW_SETTINGS.armAbductionDeg,
    };
  }
}

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
  const privacyOk = privacyConsentCheckbox?.checked;
  continueButton.disabled = !(bot && user && model && customOk && privacyOk);
}

function openPolicyModal(kind) {
  const content = POLICY_TEXT[kind];
  if (!content || !policyModal || !policyModalTitle || !policyModalBody) return;
  policyModalTitle.textContent = content.title;
  policyModalBody.innerHTML = '';
  for (const text of content.paragraphs) {
    const p = document.createElement('p');
    p.textContent = text;
    policyModalBody.appendChild(p);
  }
  policyModal.hidden = false;
  policyModalClose?.focus();
}

function closePolicyModal() {
  if (policyModal) policyModal.hidden = true;
}

function getModelUrl(name) {
  const found = modelsList.find((m) => m.name === name);
  return found?.url || '';
}

async function refreshPreview() {
  previewStatusEl.hidden = true;
  previewStatusEl.textContent = '';
  const spinner = document.getElementById('preview-spinner');
  
  const url = getModelUrl(modelSelect.value);
  if (!url || !previewEl) return;
  
  if (spinner) spinner.hidden = false;
  
  updatePreviewSettings({
    ...SETUP_PREVIEW_SETTINGS,
    ...loadSavedAvatarPose(),
  });
  setPreviewSpin(true);
  setPreviewIdleMotion(false);
  const ok = await setVrmPreviewUrl(previewEl, url);
  
  if (spinner) spinner.hidden = true;
  
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
  if (privacyConsentCheckbox) {
    privacyConsentCheckbox.checked = Boolean(profile?.privacyAccepted);
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
    privacyAccepted: Boolean(privacyConsentCheckbox?.checked),
    privacyAcceptedAt: new Date().toISOString(),
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
privacyConsentCheckbox?.addEventListener('change', validateForm);
document.querySelectorAll('[data-policy-modal]').forEach((button) => {
  button.addEventListener('click', () => openPolicyModal(button.dataset.policyModal));
});
policyModalClose?.addEventListener('click', closePolicyModal);
policyModal?.addEventListener('click', (event) => {
  if (event.target === policyModal) closePolicyModal();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && policyModal && !policyModal.hidden) closePolicyModal();
});

window.addEventListener('beforeunload', () => {
  disposeVrmPreview();
});

void loadSetupData();
