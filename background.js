const FPS = 8;
const FRAME_INTERVAL_MS = 1000 / FPS;
const RECORDING_FORMATS = [
  {
    label: "MP4/H.264",
    extension: "mp4",
    mimeTypes: [
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4;codecs=avc1.640028",
      "video/mp4"
    ]
  },
  {
    label: "WebM/VP8",
    extension: "webm",
    mimeTypes: [
      "video/webm;codecs=vp8",
      "video/webm"
    ]
  }
];
const VIDEO_BITS_PER_PIXEL_PER_FRAME = 0.35;
const MIN_VIDEO_BITS_PER_SECOND = 2_500_000;
const MAX_VIDEO_BITS_PER_SECOND = 16_000_000;

const state = {
  recording: false,
  sessionId: 0,
  windowId: null,
  filename: "",
  mimeType: "",
  formatLabel: "",
  videoBitsPerSecond: 0,
  startedAt: 0,
  recorder: null,
  stream: null,
  canvas: null,
  context: null,
  chunks: [],
  finishPromise: null,
  finishResolve: null,
  finishReject: null,
  objectUrl: ""
};

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

function filenameFromUrl(url, extension = "mp4") {
  try {
    return `${slugifyHost(new URL(url).hostname)}-${timestamp(new Date())}.${extension}`;
  } catch {
    return `recording-${timestamp(new Date())}.${extension}`;
  }
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return "";
  }
}

function chooseRecordingFormat() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return null;
  }
  for (const format of RECORDING_FORMATS) {
    const mimeType = format.mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
    if (mimeType) {
      return { ...format, mimeType };
    }
  }
  return null;
}

function estimateVideoBitsPerSecond(width, height, mimeType) {
  const pixels = Math.max(1, width) * Math.max(1, height);
  const formatMultiplier = mimeType.startsWith("video/webm") ? 1.15 : 1;
  const estimated = Math.round(pixels * FPS * VIDEO_BITS_PER_PIXEL_PER_FRAME * formatMultiplier);
  return Math.max(MIN_VIDEO_BITS_PER_SECOND, Math.min(MAX_VIDEO_BITS_PER_SECOND, estimated));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bitmapFromDataUrl(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

function ensureCanvas(bitmap) {
  if (!state.canvas) {
    state.canvas = document.createElement("canvas");
    state.context = state.canvas.getContext("2d", { alpha: false });
    if (!state.context) {
      throw new Error("Canvas 2D context unavailable.");
    }
  }
  // Canvas defaults to 300x150; size it to the captured frame before streaming.
  state.canvas.width = bitmap.width;
  state.canvas.height = bitmap.height;
}

async function captureAndPaint(windowId, sessionId) {
  const dataUrl = await browser.tabs.captureVisibleTab(windowId, {
    format: "png"
  });
  const bitmap = await bitmapFromDataUrl(dataUrl);
  if (state.sessionId !== sessionId) {
    bitmap.close();
    return false;
  }
  ensureCanvas(bitmap);
  if (!state.context) {
    bitmap.close();
    throw new Error("Canvas 2D context unavailable.");
  }
  state.context.drawImage(bitmap, 0, 0, state.canvas.width, state.canvas.height);
  bitmap.close();
  return true;
}

function setBadge(recording) {
  browser.browserAction.setBadgeBackgroundColor({
    color: recording ? "#c62828" : "#000000"
  }).catch(() => {});
  browser.browserAction.setBadgeText({
    text: recording ? "REC" : ""
  }).catch(() => {});
}

function settleRecording(result) {
  if (state.finishResolve) {
    state.finishResolve(result);
  }
  state.finishResolve = null;
  state.finishReject = null;
  state.finishPromise = null;
}

function failRecording(error) {
  if (state.finishReject) {
    state.finishReject(error);
  }
  state.finishResolve = null;
  state.finishReject = null;
  state.finishPromise = null;
}

function resetArtifacts() {
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
  }
  if (state.objectUrl) {
    const url = state.objectUrl;
    state.objectUrl = "";
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  state.recording = false;
  state.sessionId += 1;
  state.windowId = null;
  state.filename = "";
  state.mimeType = "";
  state.formatLabel = "";
  state.videoBitsPerSecond = 0;
  state.startedAt = 0;
  state.recorder = null;
  state.stream = null;
  state.canvas = null;
  state.context = null;
  state.chunks = [];
  state.finishPromise = null;
  state.finishResolve = null;
  state.finishReject = null;
  setBadge(false);
}

function snapshot() {
  return {
    recording: state.recording,
    filename: state.filename,
    mimeType: state.mimeType,
    formatLabel: state.formatLabel,
    videoBitsPerSecond: state.videoBitsPerSecond,
    startedAt: state.startedAt,
    windowId: state.windowId,
    fps: FPS
  };
}

async function finalizeDownload() {
  const blob = new Blob(state.chunks, {
    type: state.mimeType || "video/mp4"
  });
  const objectUrl = URL.createObjectURL(blob);
  state.objectUrl = objectUrl;
  await browser.downloads.download({
    url: objectUrl,
    filename: state.filename,
    saveAs: false
  });
  return {
    filename: state.filename,
    mimeType: state.mimeType || blob.type,
    size: blob.size
  };
}

async function findTargetTab(targetUrl) {
  if (targetUrl) {
    const normalizedTargetUrl = normalizeUrl(targetUrl);
    const tabs = await browser.tabs.query({});
    const targetTab = tabs.find((tab) => normalizeUrl(tab.url || tab.pendingUrl || "") === normalizedTargetUrl);
    if (targetTab) {
      return targetTab;
    }
    throw new Error("Aba de destino não encontrada.");
  }

  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab;
}

async function startRecording(request = {}) {
  if (state.recording) {
    return snapshot();
  }

  if (state.finishPromise) {
    await state.finishPromise.catch(() => {});
  }

  state.sessionId += 1;
  const sessionId = state.sessionId;

  const tab = await findTargetTab(request.targetUrl);

  if (!tab || typeof tab.windowId !== "number") {
    throw new Error("Nenhuma aba ativa encontrada.");
  }

  const format = chooseRecordingFormat();
  if (!format) {
    throw new Error("Este Firefox não suporta gravação de vídeo neste sistema.");
  }

  const windowId = tab.windowId;
  const filename = filenameFromUrl(tab.url || tab.pendingUrl || "", format.extension);

  try {
    await captureAndPaint(windowId, sessionId);
    if (!state.canvas || !state.context) {
      throw new Error("Falha ao preparar a tela de gravação.");
    }

    state.recording = true;
    state.windowId = windowId;
    state.filename = filename;
    state.mimeType = format.mimeType;
    state.formatLabel = format.label;
    state.videoBitsPerSecond = estimateVideoBitsPerSecond(state.canvas.width, state.canvas.height, format.mimeType);
    state.startedAt = Date.now();
    state.chunks = [];
    state.stream = state.canvas.captureStream(FPS);
    state.recorder = new MediaRecorder(state.stream, {
      mimeType: format.mimeType,
      videoBitsPerSecond: state.videoBitsPerSecond
    });
    state.finishPromise = new Promise((resolve, reject) => {
      state.finishResolve = resolve;
      state.finishReject = reject;
    });

    state.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        state.chunks.push(event.data);
      }
    };

    state.recorder.onstop = async () => {
      try {
        const result = await finalizeDownload();
        settleRecording(result);
      } catch (error) {
        failRecording(error);
      } finally {
        resetArtifacts();
      }
    };

    setBadge(true);
    state.recorder.start(1000);
    void captureLoop(sessionId, windowId);
    return snapshot();
  } catch (error) {
    resetArtifacts();
    throw error;
  }
}

async function captureLoop(sessionId, windowId) {
  while (state.recording && state.sessionId === sessionId) {
    const started = performance.now();
    try {
      const painted = await captureAndPaint(windowId, sessionId);
      if (!painted) {
        return;
      }
    } catch (error) {
      if (state.recording && state.sessionId === sessionId) {
        try {
          await stopRecording();
        } catch {
          // Partial recording is still finalized by the recorder stop path.
        }
      }
      return;
    }

    const elapsed = performance.now() - started;
    const wait = Math.max(0, FRAME_INTERVAL_MS - elapsed);
    if (wait > 0) {
      await sleep(wait);
    }
  }
}

async function stopRecording() {
  state.sessionId += 1;

  if (!state.recording) {
    return state.finishPromise || snapshot();
  }

  const recorder = state.recorder;
  state.recording = false;

  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  }

  return state.finishPromise || snapshot();
}

browser.runtime.onMessage.addListener((message) => {
  if (!message || typeof message.type !== "string") {
    return Promise.resolve(snapshot());
  }

  if (message.type === "get-status") {
    return Promise.resolve(snapshot());
  }

  if (message.type === "start-recording") {
    return startRecording(message).catch((error) => ({
      ...snapshot(),
      error: error.message || String(error)
    }));
  }

  if (message.type === "stop-recording") {
    return stopRecording().catch((error) => ({
      ...snapshot(),
      error: error.message || String(error)
    }));
  }

  return Promise.resolve(snapshot());
});
