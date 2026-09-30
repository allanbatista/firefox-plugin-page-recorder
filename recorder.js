// This page owns the whole capture pipeline because Firefox refuses
// getUserMedia() in extension background pages (bugzilla 1579489), and a
// mic track dies with the document that created it — so the browser action
// popup cannot hold it either. One window per recording.
const DEFAULT_CAPTURE_FPS = 5;
const ALLOWED_FPS = [5, 10, 15, 30, 60];
const MIME_TYPES = [
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp8",
  "video/webm"
];
const VIDEO_BITS_PER_PIXEL_PER_FRAME = 0.4;
const MIN_VIDEO_BITS_PER_SECOND = 2_500_000;
const MAX_VIDEO_BITS_PER_SECOND = 16_000_000;
const COUNTDOWN_SECONDS = 3;

// Firefox has no tab-audio API (getDisplayMedia audio is bugzilla 1541425), so
// "system" audio means the OS monitor/loopback input.
const AUDIO_MODES = ["none", "mic", "system", "mic-system"];
const MONITOR_LABEL = /monitor|loopback|stereo mix|what u hear|mixagem/i;

const titleEl = document.getElementById("title");
const detailEl = document.getElementById("detail");
const statusEl = document.getElementById("status");
const stopButton = document.getElementById("stop");
const devicePicker = document.getElementById("devicePicker");
const deviceSelect = document.getElementById("audioDevice");
const confirmDeviceButton = document.getElementById("confirmDevice");

const params = new URLSearchParams(location.search);
const targetWindowId = Number(params.get("windowId"));

function normalizeCaptureFps(value) {
  const fps = Number(value);
  return ALLOWED_FPS.includes(fps) ? fps : DEFAULT_CAPTURE_FPS;
}

function normalizeAudioMode(value) {
  return AUDIO_MODES.includes(value) ? value : "none";
}

function audioModeLabel(mode) {
  if (mode === "mic-system") {
    return "Microfone + som do sistema";
  }
  if (mode === "system") {
    return "Som do sistema";
  }
  return mode === "mic" ? "Microfone" : "Sem áudio";
}

const state = {
  preparing: true,
  choosingDevice: false,
  countdownRemaining: 0,
  recording: false,
  exporting: false,
  filename: "",
  error: "",
  audioMode: normalizeAudioMode(params.get("audio")),
  captureFps: normalizeCaptureFps(params.get("fps"))
};

let canvas = null;
let context = null;
let audioStreams = [];
let audioContext = null;
let audioDestination = null;
let recorder = null;
let chunks = [];
let stopRequested = false;

function pad2(value) {
  return String(value).padStart(2, "0");
}

function timestamp(date) {
  return [
    date.getFullYear(),
    "-",
    pad2(date.getMonth() + 1),
    "-",
    pad2(date.getDate()),
    "_",
    pad2(date.getHours()),
    "-",
    pad2(date.getMinutes()),
    "-",
    pad2(date.getSeconds())
  ].join("");
}

function slugifyHost(hostname) {
  return (hostname || "recording")
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "recording";
}

function filenameFromUrl(url) {
  try {
    return `${slugifyHost(new URL(url).hostname)}-${timestamp(new Date())}.webm`;
  } catch {
    return `recording-${timestamp(new Date())}.webm`;
  }
}

// Asking for opus without an audio track leaves Firefox muxing nothing at all
// (bugzilla 1881826): no dataavailable, no file.
function chooseMimeType(hasAudio) {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  return MIME_TYPES
    .filter((type) => hasAudio || !type.includes("opus"))
    .find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function estimateVideoBitsPerSecond(width, height, fps) {
  const pixels = Math.max(1, width) * Math.max(1, height);
  const estimated = Math.round(pixels * Math.max(1, fps) * VIDEO_BITS_PER_PIXEL_PER_FRAME);
  return Math.max(MIN_VIDEO_BITS_PER_SECOND, Math.min(MAX_VIDEO_BITS_PER_SECOND, estimated));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setBadge(recording) {
  browser.browserAction.setBadgeBackgroundColor({
    color: recording ? "#c62828" : "#000000"
  }).catch(() => {});
  browser.browserAction.setBadgeText({
    text: recording ? "REC" : ""
  }).catch(() => {});
}

function cleanup() {
  for (const stream of audioStreams) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
  audioStreams = [];
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
  audioDestination = null;
  setBadge(false);
}

async function closeSelf() {
  cleanup();
  const currentWindow = await browser.windows.getCurrent();
  await browser.windows.remove(currentWindow.id);
}

function render() {
  devicePicker.hidden = !state.choosingDevice;

  if (state.error) {
    titleEl.textContent = "Erro";
    detailEl.textContent = state.error;
    detailEl.classList.add("error");
    statusEl.textContent = "Feche esta janela e tente novamente.";
    stopButton.hidden = true;
    devicePicker.hidden = true;
    return;
  }

  detailEl.classList.remove("error");
  statusEl.textContent = `Áudio: ${audioModeLabel(state.audioMode)} · FPS: ${state.captureFps}`;

  if (state.exporting) {
    titleEl.textContent = "Finalizando WebM";
    detailEl.textContent = "Baixando o arquivo em WebM...";
    stopButton.hidden = true;
    return;
  }

  if (state.recording) {
    titleEl.textContent = "Gravando";
    detailEl.textContent = `Salvando como ${state.filename}.`;
    stopButton.hidden = false;
    stopButton.disabled = false;
    return;
  }

  if (state.choosingDevice) {
    titleEl.textContent = "Escolha a saída de áudio";
    detailEl.textContent = "Selecione o monitor (loopback) da saída onde a reunião está tocando.";
    stopButton.hidden = true;
    return;
  }

  if (state.countdownRemaining > 0) {
    titleEl.textContent = `Iniciando em ${state.countdownRemaining}s`;
    detailEl.textContent = "A gravação começa quando o contador chegar a zero.";
    stopButton.hidden = true;
    return;
  }

  titleEl.textContent = "Preparando gravação";
  detailEl.textContent = "Aguardando a permissão de áudio.";
  stopButton.hidden = true;
}

async function addAudioSource(constraints) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
  audioStreams.push(stream);

  if (!audioContext) {
    audioContext = new AudioContext();
    audioDestination = audioContext.createMediaStreamDestination();
  }
  audioContext.createMediaStreamSource(stream).connect(audioDestination);
  await audioContext.resume();
  return stream;
}

function askMonitorDevice(devices) {
  deviceSelect.replaceChildren(...devices.map((device) => new Option(device.label, device.deviceId)));
  state.choosingDevice = true;
  render();

  return new Promise((resolve) => {
    confirmDeviceButton.addEventListener("click", () => {
      state.choosingDevice = false;
      render();
      resolve(deviceSelect.value);
    }, { once: true });
  });
}

// Device labels stay blank until some capture permission is granted, so the
// monitor can only be looked up after the first getUserMedia call.
async function monitorDeviceId() {
  const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
  const monitors = inputs.filter((device) => MONITOR_LABEL.test(device.label));

  if (monitors.length === 1) {
    return monitors[0].deviceId;
  }
  if (inputs.length === 0) {
    throw new Error("Nenhuma entrada de áudio disponível para capturar o som do sistema.");
  }
  // Several outputs, or a loopback this heuristic cannot name (VB-Cable,
  // BlackHole): the user picks. Likely candidates first.
  return askMonitorDevice([...monitors, ...inputs.filter((device) => !monitors.includes(device))]);
}

async function prepareAudio() {
  if (state.audioMode === "none") {
    return;
  }
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    throw new Error("Este Firefox não suporta captura de áudio neste fluxo.");
  }

  if (state.audioMode === "mic" || state.audioMode === "mic-system") {
    await addAudioSource(true);
  } else {
    // Throwaway grant: it is what unlocks the device labels read below.
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    for (const track of probe.getTracks()) {
      track.stop();
    }
  }

  if (state.audioMode === "mic") {
    return;
  }

  await addAudioSource({
    deviceId: { exact: await monitorDeviceId() },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  });
}

async function captureAndPaint() {
  const dataUrl = await browser.tabs.captureVisibleTab(targetWindowId, { format: "png" });
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  if (!canvas) {
    canvas = document.createElement("canvas");
    context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      bitmap.close();
      throw new Error("Canvas 2D context unavailable.");
    }
  }
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
}

async function captureLoop() {
  const frameIntervalMs = 1000 / Math.max(1, state.captureFps);
  while (state.recording) {
    const started = performance.now();
    try {
      await captureAndPaint();
    } catch {
      // Lost the tab (closed, navigated to a privileged page): keep what we have.
      if (state.recording) {
        stop();
      }
      return;
    }
    await sleep(Math.max(0, frameIntervalMs - (performance.now() - started)));
  }
}

async function downloadRecording(mimeType) {
  const objectUrl = URL.createObjectURL(new Blob(chunks, { type: mimeType }));
  try {
    await browser.downloads.download({
      url: objectUrl,
      filename: state.filename,
      saveAs: false
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }
}

function startRecorder(mimeType) {
  const videoStream = canvas.captureStream(state.captureFps);
  const audioTracks = audioDestination ? audioDestination.stream.getAudioTracks() : [];
  recorder = new MediaRecorder(new MediaStream([...videoStream.getVideoTracks(), ...audioTracks]), {
    mimeType,
    videoBitsPerSecond: estimateVideoBitsPerSecond(canvas.width, canvas.height, state.captureFps)
  });

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  recorder.onstop = async () => {
    try {
      await downloadRecording(mimeType);
      await closeSelf();
    } catch (error) {
      state.exporting = false;
      state.error = error.message || String(error);
      cleanup();
      render();
    }
  };

  state.recording = true;
  setBadge(true);
  recorder.start(1000);
  render();
  void captureLoop();
}

function stop() {
  stopRequested = true;

  if (!state.recording) {
    void closeSelf();
    return;
  }

  state.recording = false;
  state.exporting = true;
  render();

  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  }
}

async function main() {
  try {
    const [tab] = await browser.tabs.query({ active: true, windowId: targetWindowId });
    if (!tab) {
      throw new Error("Nenhuma aba ativa encontrada na janela de origem.");
    }
    state.filename = filenameFromUrl(tab.url || "");
    render();

    await prepareAudio();
    if (stopRequested) {
      return;
    }

    const mimeType = chooseMimeType(Boolean(audioDestination));
    if (!mimeType) {
      throw new Error("Este Firefox não suporta gravação de vídeo neste sistema.");
    }

    await captureAndPaint();
    state.preparing = false;

    for (let remaining = COUNTDOWN_SECONDS; remaining > 0; remaining -= 1) {
      state.countdownRemaining = remaining;
      render();
      await sleep(1000);
      if (stopRequested) {
        return;
      }
    }
    state.countdownRemaining = 0;

    startRecorder(mimeType);
  } catch (error) {
    state.preparing = false;
    state.choosingDevice = false;
    state.countdownRemaining = 0;
    state.error = error.message || String(error);
    cleanup();
    render();
  }
}

// Read by the browser action popup via browser.extension.getViews().
window.recorderApi = {
  snapshot: () => ({ ...state }),
  stop
};

stopButton.addEventListener("click", stop);
// ponytail: closing this window mid-recording discards the take. Buffer to
// IndexedDB per chunk if crash-safety ever matters.
window.addEventListener("unload", () => setBadge(false));

void main();
