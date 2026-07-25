// This page owns the whole capture pipeline because Firefox refuses
// getUserMedia() in extension background pages (bugzilla 1579489), and a
// mic track dies with the document that created it — so the browser action
// popup cannot hold it either. One window per recording.
//
// Firefox cannot capture tab or system audio at all (bugzilla 1541425), so the
// remote participants have to arrive through an OS loopback device ("Monitor
// of ..." on PipeWire/PulseAudio) picked as a regular audio input.
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
const STT_SAMPLE_RATE = 16000;
const DEEPGRAM_URL = "wss://api.deepgram.com/v1/listen";
const DEEPGRAM_CLOSE_TIMEOUT_MS = 4000;

const titleEl = document.getElementById("title");
const detailEl = document.getElementById("detail");
const statusEl = document.getElementById("status");
const stopButton = document.getElementById("stop");
const stopLabelEl = document.getElementById("stopLabel");
const transcriptEl = document.getElementById("transcript");
const interimEl = document.getElementById("interim");

const targetWindowId = Number(new URLSearchParams(location.search).get("windowId"));

const state = {
  preparing: true,
  countdownRemaining: 0,
  recording: false,
  exporting: false,
  done: false,
  files: [],
  filename: "",
  error: "",
  sources: [],
  captureFps: 5,
  transcribing: false,
  transcriptNote: ""
};

let baseFilename = "";
let canvas = null;
let context = null;
let inputStreams = [];
let fileAudioContext = null;
let fileAudioDestination = null;
let sttAudioContext = null;
let socket = null;
let recorder = null;
let chunks = [];
let segments = [];
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

function clock(seconds) {
  const total = Math.max(0, Math.round(seconds));
  return `${pad2(Math.floor(total / 3600))}:${pad2(Math.floor(total / 60) % 60)}:${pad2(total % 60)}`;
}

function slugifyHost(hostname) {
  return (hostname || "recording")
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "recording";
}

function baseFilenameFromUrl(url) {
  try {
    return `${slugifyHost(new URL(url).hostname)}-${timestamp(new Date())}`;
  } catch {
    return `recording-${timestamp(new Date())}`;
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
  for (const stream of inputStreams) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
  inputStreams = [];
  for (const audioContext of [fileAudioContext, sttAudioContext]) {
    if (audioContext) {
      audioContext.close().catch(() => {});
    }
  }
  fileAudioContext = null;
  fileAudioDestination = null;
  sttAudioContext = null;
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
  const sources = state.sources.map((source) => source.label).join(" + ") || "Sem áudio";
  statusEl.textContent = [
    `Áudio: ${sources}`,
    `FPS: ${state.captureFps}`,
    state.transcriptNote || (state.transcribing ? "Transcrição: ao vivo" : "Transcrição: desligada")
  ].join(" · ");

  if (state.done) {
    titleEl.textContent = "Concluído";
    detailEl.textContent = `Baixado: ${state.files.join(", ")}.`;
    stopButton.hidden = false;
    stopButton.disabled = false;
    stopLabelEl.textContent = "Fechar";
    return;
  }

  if (state.exporting) {
    titleEl.textContent = "Finalizando";
    detailEl.textContent = "Baixando o vídeo e a transcrição...";
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
  detailEl.textContent = "Aguardando a permissão de áudio.";
  stopButton.hidden = true;
}

function renderTranscript() {
  transcriptEl.textContent = "";
  for (const segment of segments.slice(-60)) {
    const line = document.createElement("p");
    line.className = "line";
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = `[${clock(segment.start)}] ${segment.label}: `;
    line.append(who, document.createTextNode(segment.text));
    transcriptEl.append(line);
  }
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

// --- audio inputs ---------------------------------------------------------

async function openInput(source) {
  const constraints = source.kind === "meeting"
    // Raw loopback: the meeting audio is already processed on the far side.
    ? { deviceId: { exact: source.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    : { deviceId: { exact: source.deviceId } };

  const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
  inputStreams.push(stream);
  return stream;
}

// Device ids and labels stay blank until an audio permission exists, so a
// configured input would resolve to nothing and record silence.
async function ensureDeviceAccess() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  if (devices.some((device) => device.kind === "audioinput" && device.deviceId && device.label)) {
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

async function resolveDeviceId(stored) {
  if (!stored || !stored.deviceId) {
    return null;
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === "audioinput");
  if (inputs.some((device) => device.deviceId === stored.deviceId)) {
    return stored.deviceId;
  }
  // Firefox rotates device ids between sessions; fall back to the saved label.
  const byLabel = inputs.find((device) => device.label && device.label === stored.label);
  return byLabel ? byLabel.deviceId : null;
}

async function buildAudioGraph(settings) {
  const wanted = [
    { kind: "mic", label: "Você", diarize: false, stored: settings.micDevice },
    { kind: "meeting", label: "Reunião", diarize: true, stored: settings.meetingDevice }
  ];

  const configured = wanted.filter((source) => source.stored && source.stored.deviceId);
  if (configured.length === 0) {
    return;
  }
  await ensureDeviceAccess();

  const sources = [];
  for (const source of configured) {
    const deviceId = await resolveDeviceId(source.stored);
    if (!deviceId) {
      continue;
    }
    sources.push({ ...source, deviceId, stream: await openInput({ ...source, deviceId }) });
  }

  state.sources = sources;
  if (sources.length === 0) {
    throw new Error("Os dispositivos de áudio configurados não estão disponíveis. Reabra o popup e escolha de novo.");
  }

  // Mixed graph for the recorded file.
  fileAudioContext = new AudioContext();
  fileAudioDestination = fileAudioContext.createMediaStreamDestination();
  for (const source of sources) {
    fileAudioContext.createMediaStreamSource(source.stream).connect(fileAudioDestination);
  }
  await fileAudioContext.resume();
}

async function startTranscription(settings) {
  if (settings.transcribe !== "deepgram" || state.sources.length === 0) {
    return;
  }
  if (!settings.deepgramKey) {
    state.transcriptNote = "Transcrição: sem chave da Deepgram";
    return;
  }

  // One channel per source, so "you" and "the meeting" can never be confused;
  // diarize then splits the meeting channel into Participante 1..N.
  const channels = state.sources.length;
  const params = new URLSearchParams({
    model: "nova-3",
    language: "multi",
    encoding: "linear16",
    sample_rate: String(STT_SAMPLE_RATE),
    channels: String(channels),
    diarize: "true",
    punctuate: "true",
    smart_format: "true",
    interim_results: "true",
    endpointing: "300"
  });
  if (channels > 1) {
    params.set("multichannel", "true");
  }

  socket = new WebSocket(`${DEEPGRAM_URL}?${params}`, ["token", settings.deepgramKey]);
  socket.onmessage = (event) => handleDeepgramMessage(JSON.parse(event.data));
  socket.onerror = () => {
    state.transcriptNote = "Transcrição: falha na conexão";
    render();
  };
  socket.onclose = (event) => {
    if (event.code !== 1000 && state.recording) {
      state.transcriptNote = `Transcrição: conexão encerrada (${event.code})`;
      render();
    }
  };

  // The context resamples both inputs to 16 kHz for us — no manual resampling.
  sttAudioContext = new AudioContext({ sampleRate: STT_SAMPLE_RATE });
  await sttAudioContext.audioWorklet.addModule(browser.runtime.getURL("pcm-worklet.js"));

  const merger = sttAudioContext.createChannelMerger(channels);
  state.sources.forEach((source, index) => {
    sttAudioContext.createMediaStreamSource(source.stream).connect(merger, 0, index);
  });

  const pcm = new AudioWorkletNode(sttAudioContext, "pcm", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: channels,
    channelCountMode: "explicit",
    channelInterpretation: "discrete"
  });
  pcm.port.onmessage = (event) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(event.data);
    }
  };

  // Web Audio only pulls nodes that reach the destination; a muted gain keeps
  // the worklet running without echoing the meeting back into the room.
  const mute = sttAudioContext.createGain();
  mute.gain.value = 0;
  merger.connect(pcm).connect(mute).connect(sttAudioContext.destination);

  await sttAudioContext.resume();
  state.transcribing = true;
}

// --- transcription --------------------------------------------------------

function handleDeepgramMessage(message) {
  if (!message || message.type !== "Results") {
    return;
  }

  const channelIndex = Array.isArray(message.channel_index) ? message.channel_index[0] : 0;
  const source = state.sources[channelIndex] || state.sources[0];
  const alternative = message.channel && message.channel.alternatives && message.channel.alternatives[0];
  if (!source || !alternative || !alternative.transcript) {
    return;
  }

  if (!message.is_final) {
    interimEl.textContent = `${source.label}: ${alternative.transcript}`;
    return;
  }

  interimEl.textContent = "";
  segments.push(...splitBySpeaker(alternative, source, message.start || 0));
  segments.sort((a, b) => a.start - b.start);
  renderTranscript();
}

function speakerLabel(source, speaker) {
  return source.diarize ? `${source.label} · Participante ${(speaker || 0) + 1}` : source.label;
}

function splitBySpeaker(alternative, source, fallbackStart) {
  const words = alternative.words || [];
  if (words.length === 0) {
    return [{ start: fallbackStart, label: source.label, text: alternative.transcript }];
  }

  const result = [];
  for (const word of words) {
    const label = speakerLabel(source, word.speaker);
    const text = word.punctuated_word || word.word;
    const previous = result[result.length - 1];
    if (previous && previous.label === label) {
      previous.text += ` ${text}`;
    } else {
      result.push({ start: word.start, label, text });
    }
  }
  return result;
}

function transcriptFile() {
  const header = [
    `# ${baseFilename}`,
    `# Fontes: ${state.sources.map((source) => source.label).join(" + ")}`,
    ""
  ];
  const lines = segments.map((segment) => `[${clock(segment.start)}] ${segment.label}: ${segment.text}`);
  return `${header.concat(lines).join("\n")}\n`;
}

async function closeTranscription() {
  if (!socket) {
    return;
  }
  if (socket.readyState === WebSocket.OPEN) {
    // Flush whatever Deepgram is still holding before we build the file.
    socket.send(JSON.stringify({ type: "CloseStream" }));
    await Promise.race([
      new Promise((resolve) => socket.addEventListener("close", resolve, { once: true })),
      sleep(DEEPGRAM_CLOSE_TIMEOUT_MS)
    ]);
  }
  socket.close();
  socket = null;
}

// --- video ----------------------------------------------------------------

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

// downloads.download() hangs on blob: URLs created outside a background page
// (bugzilla 1404202 / 1696174), and we no longer have one. <a download> is the
// documented workaround and needs no permission.
function download(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
}

function exportRecording(mimeType) {
  const files = [state.filename];
  download(new Blob(chunks, { type: mimeType }), state.filename);
  if (segments.length > 0) {
    files.push(`${baseFilename}.txt`);
    download(new Blob([transcriptFile()], { type: "text/plain" }), `${baseFilename}.txt`);
  }
  return files;
}

function startRecorder(mimeType) {
  const videoStream = canvas.captureStream(state.captureFps);
  const audioTracks = fileAudioDestination ? fileAudioDestination.stream.getAudioTracks() : [];
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
      await closeTranscription();
      state.files = exportRecording(mimeType);
      // Closing this document would cancel a blob download still in flight, so
      // the window stays until the user dismisses it.
      state.exporting = false;
      state.done = true;
      cleanup();
      render();
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
    const settings = await browser.storage.local.get({
      micDevice: null,
      meetingDevice: null,
      captureFps: 5,
      transcribe: "off",
      deepgramKey: ""
    });
    state.captureFps = ALLOWED_FPS.includes(Number(settings.captureFps)) ? Number(settings.captureFps) : 5;

    const mimeType = chooseMimeType();
    if (!mimeType) {
      throw new Error("Este Firefox não suporta gravação de vídeo neste sistema.");
    }

    const [tab] = await browser.tabs.query({ active: true, windowId: targetWindowId });
    if (!tab) {
      throw new Error("Nenhuma aba ativa encontrada na janela de origem.");
    }
    baseFilename = baseFilenameFromUrl(tab.url || "");
    state.filename = `${baseFilename}.webm`;
    render();

    await buildAudioGraph(settings);
    if (stopRequested) {
      return;
    }
    await startTranscription(settings);
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
  stop,
  close: () => void closeSelf()
};

stopButton.addEventListener("click", () => {
  if (state.done) {
    void closeSelf();
    return;
  }
  stop();
});
// ponytail: closing this window mid-recording discards the take. Buffer chunks
// to IndexedDB if crash-safety ever matters.
window.addEventListener("unload", () => setBadge(false));

void main();
