const title = document.getElementById("title");
const detail = document.getElementById("detail");
const status = document.getElementById("status");
const audioModeSelect = document.getElementById("audioMode");
const captureFpsSelect = document.getElementById("captureFps");
const startButton = document.getElementById("startRecording");
const startLabel = document.getElementById("startLabel");
const stopButton = document.getElementById("stopRecording");

const DEFAULT_CAPTURE_FPS = 5;
const POLL_INTERVAL_MS = 500;

let snapshotState = null;
let pollingStarted = false;

function audioModeLabel(mode) {
  if (mode === "mic" || mode === "tab-mic") {
    return "Microfone";
  }
  return "Sem áudio";
}

function settingsStatus(mode, fps) {
  return `Áudio: ${audioModeLabel(mode)} · FPS: ${fps}`;
}

function busyStatus(state) {
  const parts = [];
  if (state.audioMode) {
    parts.push(`Áudio: ${audioModeLabel(state.audioMode)}`);
  }
  if (state.captureFps) {
    parts.push(`FPS: ${state.captureFps}`);
  }
  if (state.filename) {
    parts.push(`Arquivo: ${state.filename}`);
  }
  return parts.join(" · ");
}

function setSelectsDisabled(disabled) {
  audioModeSelect.disabled = disabled;
  captureFpsSelect.disabled = disabled;
}

function syncBusySelects(state) {
  if (state.audioMode === "none" || state.audioMode === "mic" || state.audioMode === "tab" || state.audioMode === "tab-mic") {
    const value = state.audioMode === "mic" || state.audioMode === "tab-mic" ? "mic" : "none";
    audioModeSelect.value = value;
  }
  if (Number.isFinite(state.captureFps) && state.captureFps > 0) {
    captureFpsSelect.value = String(state.captureFps);
  }
}

function renderReady() {
  title.textContent = "Pronto para gravar";
  detail.textContent = "Captura a área visível da aba ativa e salva em WebM. Opcionalmente inclui o microfone.";
  detail.classList.remove("error");
  status.textContent = settingsStatus(audioModeSelect.value, captureFpsSelect.value);
  status.classList.remove("error");
  startButton.hidden = false;
  startButton.disabled = false;
  startLabel.textContent = "Iniciar gravação";
  stopButton.hidden = true;
  setSelectsDisabled(false);
}

function renderError(error) {
  title.textContent = "Erro";
  detail.textContent = error;
  detail.classList.add("error");
  status.textContent = "";
  status.classList.remove("error");
  startButton.hidden = false;
  startButton.disabled = false;
  startLabel.textContent = "Tentar novamente";
  stopButton.hidden = true;
  setSelectsDisabled(false);
}

function render(state) {
  snapshotState = state;

  if (state && (state.audioMode || Number.isFinite(state.captureFps))) {
    if (state.recording || state.exporting || state.preparing || (state.countdownRemaining || 0) > 0) {
      syncBusySelects(state);
    }
  }

  if (state && state.error) {
    renderError(state.error);
    return;
  }

  if (state && state.exporting) {
    title.textContent = "Finalizando WebM";
    detail.textContent = "Baixando o arquivo em WebM...";
    detail.classList.remove("error");
    status.textContent = busyStatus(state);
    status.classList.remove("error");
    startButton.hidden = false;
    startButton.disabled = true;
    startLabel.textContent = "Finalizando...";
    stopButton.hidden = true;
    setSelectsDisabled(true);
    return;
  }

  if (state && state.recording) {
    title.textContent = "Gravando";
    detail.textContent = state.filename
      ? `Salvando como ${state.filename}.`
      : "Gravação em andamento.";
    detail.classList.remove("error");
    status.textContent = busyStatus(state);
    status.classList.remove("error");
    startButton.hidden = true;
    stopButton.hidden = false;
    stopButton.disabled = false;
    setSelectsDisabled(true);
    return;
  }

  if (state && state.preparing) {
    title.textContent = "Preparando gravação";
    detail.textContent = "Aguardando permissões de mídia, se necessário.";
    detail.classList.remove("error");
    status.textContent = busyStatus(state);
    status.classList.remove("error");
    startButton.hidden = false;
    startButton.disabled = true;
    startLabel.textContent = "Preparando...";
    stopButton.hidden = true;
    setSelectsDisabled(true);
    return;
  }

  if (state && Number(state.countdownRemaining) > 0) {
    title.textContent = `Iniciando em ${state.countdownRemaining}s`;
    detail.textContent = "A gravação começa quando o contador chegar a zero.";
    detail.classList.remove("error");
    status.textContent = busyStatus(state);
    status.classList.remove("error");
    startButton.hidden = false;
    startButton.disabled = true;
    startLabel.textContent = `Iniciando em ${state.countdownRemaining}s`;
    stopButton.hidden = true;
    setSelectsDisabled(true);
    return;
  }

  renderReady();
}

async function loadSettings() {
  try {
    const stored = await browser.storage.local.get({ captureFps: DEFAULT_CAPTURE_FPS });
    const fps = [5, 10, 15, 30, 60].includes(Number(stored.captureFps))
      ? Number(stored.captureFps)
      : DEFAULT_CAPTURE_FPS;
    captureFpsSelect.value = String(fps);
  } catch {
    captureFpsSelect.value = String(DEFAULT_CAPTURE_FPS);
  }
}

async function saveCaptureFps() {
  const fps = [5, 10, 15, 30, 60].includes(Number(captureFpsSelect.value))
    ? Number(captureFpsSelect.value)
    : DEFAULT_CAPTURE_FPS;

  captureFpsSelect.value = String(fps);

  try {
    await browser.storage.local.set({ captureFps: fps });
  } catch {
    // Best effort only.
  }

  if (!snapshotState || (!snapshotState.recording && !snapshotState.exporting && !snapshotState.preparing && Number(snapshotState.countdownRemaining || 0) === 0)) {
    status.textContent = settingsStatus(audioModeSelect.value, captureFpsSelect.value);
    status.classList.remove("error");
  }
}

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
  setSelectsDisabled(true);
  status.textContent = "Abrindo a janela de gravação...";
  status.classList.remove("error");

  try {
    const existing = recorderView();
    if (existing) {
      if (!existing.recorderApi.snapshot().error) {
        return;
      }
      existing.recorderApi.stop();
    }

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.windowId !== "number") {
      throw new Error("Nenhuma aba ativa encontrada.");
    }

    const url = browser.runtime.getURL(
      `recorder.html?windowId=${tab.windowId}&fps=${Number(captureFpsSelect.value)}&audio=${audioModeSelect.value}`
    );
    await browser.windows.create({ url, type: "popup", width: 380, height: 280 });
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

audioModeSelect.addEventListener("change", () => {
  if (!snapshotState || (!snapshotState.recording && !snapshotState.exporting && !snapshotState.preparing && Number(snapshotState.countdownRemaining || 0) === 0)) {
    status.textContent = settingsStatus(audioModeSelect.value, captureFpsSelect.value);
    status.classList.remove("error");
  }
});

captureFpsSelect.addEventListener("change", () => {
  void saveCaptureFps();
});

startButton.addEventListener("click", () => {
  void startRecording();
});

stopButton.addEventListener("click", () => {
  stopButton.disabled = true;
  status.textContent = "Finalizando exportação em WebM...";
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
