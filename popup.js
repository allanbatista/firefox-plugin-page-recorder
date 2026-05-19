const title = document.getElementById("title");
const detail = document.getElementById("detail");
const status = document.getElementById("status");
const toggle = document.getElementById("toggle");
let recording = false;
const popupUrl = new URL(window.location.href);
const targetUrl = popupUrl.searchParams.get("targetUrl");

function formatFilename(filename) {
  return filename || "nenhum arquivo ainda";
}

function formatBitrate(bitsPerSecond) {
  if (!bitsPerSecond) {
    return "";
  }
  return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`;
}

function setBusy(busy) {
  toggle.disabled = busy;
}

function render(state) {
  recording = Boolean(state.recording);

  if (state.error) {
    title.textContent = "Erro";
    detail.textContent = state.error;
    detail.classList.add("error");
    status.textContent = "";
    status.classList.remove("error");
    toggle.textContent = "Tentar novamente";
    return;
  }

  if (state.recording) {
    title.textContent = "Gravando";
    detail.textContent = `Salvando como ${formatFilename(state.filename)}.`;
    detail.classList.remove("error");
    const bitrate = formatBitrate(state.videoBitsPerSecond);
    const parts = [];
    if (state.formatLabel) {
      parts.push(`Formato: ${state.formatLabel}`);
    }
    if (bitrate) {
      parts.push(bitrate);
    }
    parts.push(`FPS: ${state.fps}`);
    status.textContent = parts.join(" · ");
    status.classList.remove("error");
    toggle.textContent = "Parar gravação";
    return;
  }

  title.textContent = "Pronto para gravar";
  detail.textContent = "Captura a área visível da aba ativa e salva em MP4 ou WebM, conforme suporte do Firefox.";
  detail.classList.remove("error");
  status.textContent = state.filename ? `Último arquivo: ${state.filename}` : "";
  status.classList.remove("error");
  toggle.textContent = "Iniciar gravação";
}

async function refresh() {
  const state = await browser.runtime.sendMessage({ type: "get-status" });
  render(state);
}

toggle.addEventListener("click", async () => {
  setBusy(true);
  status.classList.remove("error");
  status.textContent = "";

  try {
    const message = {
      type: recording ? "stop-recording" : "start-recording"
    };
    if (targetUrl) {
      message.targetUrl = targetUrl;
    }

    const state = await browser.runtime.sendMessage(message);
    render(state);
  } catch (error) {
    render({ error: error.message || String(error) });
  } finally {
    setBusy(false);
  }
});

refresh().catch((error) => {
  render({ error: error.message || String(error) });
  setBusy(false);
});
