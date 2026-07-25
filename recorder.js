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

const titleEl = document.getElementById("title");
const detailEl = document.getElementById("detail");
const statusEl = document.getElementById("status");
const stopButton = document.getElementById("stop");

const params = new URLSearchParams(location.search);
const targetWindowId = Number(params.get("windowId"));

function normalizeCaptureFps(value) {
  const fps = Number(value);
  return ALLOWED_FPS.includes(fps) ? fps : DEFAULT_CAPTURE_FPS;
}

// none | mic (legacy tab / tab-mic map to none / mic)
function normalizeAudioMode(value) {
  return value === "mic" || value === "tab-mic" ? "mic" : "none";
}

const state = {
  preparing: true,
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
let micStream = null;
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

function chooseMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || "";
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
  if (micStream) {
    for (const track of micStream.getTracks()) {
      track.stop();
    }
    micStream = null;
  }
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
  if (state.error) {
    titleEl.textContent = "Erro";
    detailEl.textContent = state.error;
    detailEl.classList.add("error");
    statusEl.textContent = "Feche esta janela e tente novamente.";
    stopButton.hidden = true;
    return;
  }

  detailEl.classList.remove("error");
  statusEl.textContent = `Áudio: ${state.audioMode === "mic" ? "Microfone" : "Sem áudio"} · FPS: ${state.captureFps}`;

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

  if (state.countdownRemaining > 0) {
    titleEl.textContent = `Iniciando em ${state.countdownRemaining}s`;
    detailEl.textContent = "A gravação começa quando o contador chegar a zero.";
    stopButton.hidden = true;
    return;
  }

  titleEl.textContent = "Preparando gravação";
  detailEl.textContent = "Aguardando a permissão do microfone.";
  stopButton.hidden = true;
}

async function prepareMicAudio() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    throw new Error("Este Firefox não suporta captura de microfone neste fluxo.");
  }

  micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  audioContext = new AudioContext();
  audioDestination = audioContext.createMediaStreamDestination();
  audioContext.createMediaStreamSource(micStream).connect(audioDestination);
  await audioContext.resume();
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
    const mimeType = chooseMimeType();
    if (!mimeType) {
      throw new Error("Este Firefox não suporta gravação de vídeo neste sistema.");
    }

    const [tab] = await browser.tabs.query({ active: true, windowId: targetWindowId });
    if (!tab) {
      throw new Error("Nenhuma aba ativa encontrada na janela de origem.");
    }
    state.filename = filenameFromUrl(tab.url || "");
    render();

    if (state.audioMode === "mic") {
      await prepareMicAudio();
    }
    if (stopRequested) {
      return;
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
