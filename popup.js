const title = document.getElementById("title");
const detail = document.getElementById("detail");
const status = document.getElementById("status");
const micDeviceSelect = document.getElementById("micDevice");
const meetingDeviceSelect = document.getElementById("meetingDevice");
const unlockButton = document.getElementById("unlockDevices");
const transcribeSelect = document.getElementById("transcribe");
const deepgramKeyField = document.getElementById("deepgramKeyField");
const deepgramKeyInput = document.getElementById("deepgramKey");
const captureFpsSelect = document.getElementById("captureFps");
const startButton = document.getElementById("startRecording");
const startLabel = document.getElementById("startLabel");
const stopButton = document.getElementById("stopRecording");

const DEFAULT_CAPTURE_FPS = 5;
const ALLOWED_FPS = [5, 10, 15, 30, 60];
const POLL_INTERVAL_MS = 500;
// Loopback inputs are what carry the other participants' voices.
const LOOPBACK_HINT = /monitor|loopback|stereo mix|mixagem|blackhole|vb-audio|virtual/i;

const inputs = [micDeviceSelect, meetingDeviceSelect, transcribeSelect, deepgramKeyInput, captureFpsSelect];

let snapshotState = null;
let pollingStarted = false;

function settingsStatus() {
  const mic = micDeviceSelect.selectedOptions[0];
  const meeting = meetingDeviceSelect.selectedOptions[0];
  const audio = [mic && mic.value ? "Mic" : null, meeting && meeting.value ? "Reunião" : null]
    .filter(Boolean)
    .join(" + ") || "Sem áudio";
  const stt = transcribeSelect.value === "deepgram" ? "Deepgram" : "sem transcrição";
  return `Áudio: ${audio} · FPS: ${captureFpsSelect.value} · ${stt}`;
}

function busyStatus(state) {
  return [
    state.sources && state.sources.length ? `Áudio: ${state.sources.map((s) => s.label).join(" + ")}` : "Sem áudio",
    state.captureFps ? `FPS: ${state.captureFps}` : "",
    state.filename ? `Arquivo: ${state.filename}` : ""
  ].filter(Boolean).join(" · ");
}

function setInputsDisabled(disabled) {
  for (const input of inputs) {
    input.disabled = disabled;
  }
}

function isIdle(state) {
  return !state || (!state.recording && !state.exporting && !state.preparing && Number(state.countdownRemaining || 0) === 0);
}

function renderReady() {
  title.textContent = "Pronto para gravar";
  detail.textContent = "Captura a área visível da aba ativa e salva em WebM, com transcrição opcional em tempo real.";
  detail.classList.remove("error");
  status.textContent = settingsStatus();
  status.classList.remove("error");
  startButton.hidden = false;
  startButton.disabled = false;
  startLabel.textContent = "Iniciar gravação";
  stopButton.hidden = true;
  setInputsDisabled(false);
}

function renderError(error) {
  title.textContent = "Erro";
  detail.textContent = error;
  detail.classList.add("error");
  status.textContent = "";
  startButton.hidden = false;
  startButton.disabled = false;
  startLabel.textContent = "Tentar novamente";
  stopButton.hidden = true;
  setInputsDisabled(false);
}

function render(state) {
  snapshotState = state;

  if (state && state.error) {
    renderError(state.error);
    return;
  }

  if (state && state.done) {
    renderReady();
    status.textContent = `Baixado: ${(state.files || []).join(", ")}`;
    return;
  }

  if (state && state.exporting) {
    title.textContent = "Finalizando";
    detail.textContent = "Baixando o vídeo e a transcrição...";
    detail.classList.remove("error");
    status.textContent = busyStatus(state);
    startButton.hidden = false;
    startButton.disabled = true;
    startLabel.textContent = "Finalizando...";
    stopButton.hidden = true;
    setInputsDisabled(true);
    return;
  }

  if (state && state.recording) {
    title.textContent = "Gravando";
    detail.textContent = state.filename ? `Salvando como ${state.filename}.` : "Gravação em andamento.";
    detail.classList.remove("error");
    status.textContent = busyStatus(state);
    startButton.hidden = true;
    stopButton.hidden = false;
    stopButton.disabled = false;
    setInputsDisabled(true);
    return;
  }

  if (state && (state.preparing || Number(state.countdownRemaining) > 0)) {
    const counting = Number(state.countdownRemaining) > 0;
    title.textContent = counting ? `Iniciando em ${state.countdownRemaining}s` : "Preparando gravação";
    detail.textContent = counting
      ? "A gravação começa quando o contador chegar a zero."
      : "Aguardando permissões de áudio, se necessário.";
    detail.classList.remove("error");
    status.textContent = busyStatus(state);
    startButton.hidden = false;
    startButton.disabled = true;
    startLabel.textContent = counting ? `Iniciando em ${state.countdownRemaining}s` : "Preparando...";
    stopButton.hidden = true;
    setInputsDisabled(true);
    return;
  }

  renderReady();
}

// --- devices --------------------------------------------------------------

function fillDeviceSelect(select, devices, emptyLabel, stored, fallbackMatch) {
  select.textContent = "";
  select.append(new Option(emptyLabel, ""));
  for (const device of devices) {
    select.append(new Option(device.label || `Entrada ${select.length}`, device.deviceId));
  }

  const byId = stored && devices.some((device) => device.deviceId === stored.deviceId) ? stored.deviceId : "";
  const byLabel = !byId && stored && stored.label
    ? (devices.find((device) => device.label === stored.label) || {}).deviceId
    : "";
  const guessed = !byId && !byLabel && !stored && fallbackMatch
    ? (devices.find((device) => fallbackMatch.test(device.label || "")) || {}).deviceId
    : "";
  select.value = byId || byLabel || guessed || "";
}

async function populateDevices(settings) {
  const devices = (await navigator.mediaDevices.enumerateDevices())
    .filter((device) => device.kind === "audioinput");
  const named = devices.some((device) => device.label);

  fillDeviceSelect(micDeviceSelect, devices, "Sem microfone", settings.micDevice, null);
  fillDeviceSelect(meetingDeviceSelect, devices, "Sem áudio da reunião", settings.meetingDevice, LOOPBACK_HINT);
  unlockButton.hidden = named && devices.length > 0;
}

// Device labels stay blank until the mic permission exists; a popup can prompt
// (only background pages are barred), so grab it here and release it at once.
async function unlockDevices() {
  unlockButton.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) {
      track.stop();
    }
    await populateDevices(await readSettings());
  } catch (error) {
    status.textContent = error.message || String(error);
    status.classList.add("error");
  } finally {
    unlockButton.disabled = false;
  }
}

// --- settings -------------------------------------------------------------

function readSettings() {
  return browser.storage.local.get({
    micDevice: null,
    meetingDevice: null,
    captureFps: DEFAULT_CAPTURE_FPS,
    transcribe: "off",
    deepgramKey: ""
  });
}

function selectedDevice(select) {
  const option = select.selectedOptions[0];
  return option && option.value ? { deviceId: option.value, label: option.textContent } : null;
}

async function saveSettings() {
  deepgramKeyField.hidden = transcribeSelect.value !== "deepgram";
  await browser.storage.local.set({
    micDevice: selectedDevice(micDeviceSelect),
    meetingDevice: selectedDevice(meetingDeviceSelect),
    captureFps: ALLOWED_FPS.includes(Number(captureFpsSelect.value)) ? Number(captureFpsSelect.value) : DEFAULT_CAPTURE_FPS,
    transcribe: transcribeSelect.value,
    deepgramKey: deepgramKeyInput.value.trim()
  });

  if (isIdle(snapshotState)) {
    status.textContent = settingsStatus();
    status.classList.remove("error");
  }
}

async function loadSettings() {
  const settings = await readSettings();
  captureFpsSelect.value = String(
    ALLOWED_FPS.includes(Number(settings.captureFps)) ? Number(settings.captureFps) : DEFAULT_CAPTURE_FPS
  );
  transcribeSelect.value = settings.transcribe === "deepgram" ? "deepgram" : "off";
  deepgramKeyInput.value = settings.deepgramKey || "";
  deepgramKeyField.hidden = transcribeSelect.value !== "deepgram";
  await populateDevices(settings);
}

// --- recorder window ------------------------------------------------------

// The recorder lives in its own window: Firefox blocks getUserMedia in
// background pages, and a mic track dies with the document that opened it.
function recorderView() {
  return browser.extension.getViews().find((view) => view.recorderApi);
}

function refresh() {
  const view = recorderView();
  render(view ? view.recorderApi.snapshot() : null);
}

async function startRecording() {
  startButton.disabled = true;
  setInputsDisabled(true);
  status.textContent = "Abrindo a janela de gravação...";
  status.classList.remove("error");

  try {
    const existing = recorderView();
    if (existing) {
      const previous = existing.recorderApi.snapshot();
      if (!previous.error && !previous.done) {
        return;
      }
      existing.recorderApi.close();
    }

    await saveSettings();

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.windowId !== "number") {
      throw new Error("Nenhuma aba ativa encontrada.");
    }

    await browser.windows.create({
      url: browser.runtime.getURL(`recorder.html?windowId=${tab.windowId}`),
      type: "popup",
      width: 460,
      height: 560
    });
  } catch (error) {
    render({ error: error.message || String(error) });
  }
}

function startPolling() {
  if (pollingStarted) {
    return;
  }
  pollingStarted = true;
  setInterval(refresh, POLL_INTERVAL_MS);
}

for (const input of [micDeviceSelect, meetingDeviceSelect, transcribeSelect, captureFpsSelect]) {
  input.addEventListener("change", () => {
    void saveSettings();
  });
}

deepgramKeyInput.addEventListener("change", () => {
  void saveSettings();
});

unlockButton.addEventListener("click", () => {
  void unlockDevices();
});

startButton.addEventListener("click", () => {
  void startRecording();
});

stopButton.addEventListener("click", () => {
  stopButton.disabled = true;
  status.textContent = "Finalizando exportação...";
  status.classList.remove("error");
  const view = recorderView();
  if (view) {
    view.recorderApi.stop();
  }
});

void loadSettings().then(() => {
  refresh();
  startPolling();
});
