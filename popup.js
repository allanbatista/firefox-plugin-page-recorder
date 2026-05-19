const title = document.getElementById("title");
const detail = document.getElementById("detail");
const status = document.getElementById("status");
const toggle = document.getElementById("toggle");
let recording = false;

function formatFilename(filename) {
  return filename || "nenhum arquivo ainda";
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
    status.textContent = `FPS: ${state.fps}`;
    status.classList.remove("error");
    toggle.textContent = "Parar gravação";
    return;
  }

  title.textContent = "Pronto para gravar";
  detail.textContent = "Captura a área visível da aba ativa e salva em MP4.";
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
    const state = await browser.runtime.sendMessage({
      type: recording ? "stop-recording" : "start-recording"
    });
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
