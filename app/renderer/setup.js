import { disposeVrmPreview, setVrmPreviewUrl } from './setup-vrm-preview.js';

const botNameInput = document.getElementById('bot-name-input');
const userNameInput = document.getElementById('user-name-input');
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
  continueButton.disabled = !(bot && user && model);
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
  const [profile, modelData] = await Promise.all([
    window.rainyDesktop.getProfile(),
    window.rainyDesktop.listAvatarModels(),
  ]);

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
