function fmt(n, d = 3) {
  if (n === null || n === undefined) return "N/A";
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(d) : "N/A";
}

function usd(n) {
  if (n === null || n === undefined) return "N/A";
  const x = Number(n);
  return Number.isFinite(x) ? `$${x.toFixed(2)}` : "N/A";
}

function setDecisionStyle(box, action) {
  box.classList.remove("ok", "wait", "bad");
  if (action.startsWith("COMPRAR")) {
    box.classList.add("ok");
    return;
  }
  if (action === "ESPERAR" || action === "NO ENTRAR") {
    box.classList.add("wait");
    return;
  }
  box.classList.add("bad");
}

let isAnalyzing = false;
let pollTimer = null;

async function runAnalysis() {
  if (isAnalyzing) return;
  isAnalyzing = true;
  const url = document.getElementById("url").value.trim();
  const stake = document.getElementById("stake").value.trim();
  const pYes = document.getElementById("pYes").value.trim();

  const decisionBox = document.getElementById("decisionBox");
  const reason = document.getElementById("reason");
  const prediction = document.getElementById("prediction");
  const marketInfo = document.getElementById("marketInfo");
  const error = document.getElementById("error");

  error.textContent = "";
  decisionBox.textContent = "Analizando...";
  decisionBox.classList.add("wait");
  reason.textContent = "";
  prediction.textContent = "";

  try {
    const api = `/api/polymarket/analyze?url=${encodeURIComponent(url)}&stake=${encodeURIComponent(stake)}&pYes=${encodeURIComponent(pYes)}`;
    const response = await fetch(api);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Error de analisis");
    }

    setDecisionStyle(decisionBox, data.decision.action);
    decisionBox.textContent = `Decision: ${data.decision.action}`;
    reason.textContent = data.decision.reason;
    prediction.textContent = `Prediccion 15m: ${data.prediction}`;

    const endText = data.market.endDate ? ` | Cierra: ${new Date(data.market.endDate).toLocaleString()}` : "";
    marketInfo.textContent = `${data.market.question} | Mercado abierto: ${data.market.marketOpen ? "Si" : "No"}${endText}`;

    document.getElementById("yesBasics").textContent =
      `${fmt(data.snapshot.yes.bid)} / ${fmt(data.snapshot.yes.ask)} / ${fmt(data.snapshot.yes.spread)}`;
    document.getElementById("noBasics").textContent =
      `${fmt(data.snapshot.no.bid)} / ${fmt(data.snapshot.no.ask)} / ${fmt(data.snapshot.no.spread)}`;
    document.getElementById("yesLiq").textContent =
      `${usd(data.snapshot.yes.askDepthUsd)} / ${usd(data.snapshot.yes.bidDepthUsd)}`;
    document.getElementById("noLiq").textContent =
      `${usd(data.snapshot.no.askDepthUsd)} / ${usd(data.snapshot.no.bidDepthUsd)}`;
    document.getElementById("yesEv").textContent = fmt(data.snapshot.yes.evPerShare, 4);
    document.getElementById("noEv").textContent = fmt(data.snapshot.no.evPerShare, 4);
  } catch (err) {
    decisionBox.textContent = "Decision: ERROR";
    setDecisionStyle(decisionBox, "ERROR");
    reason.textContent = "No se pudo analizar este mercado.";
    prediction.textContent = "";
    marketInfo.textContent = "";
    error.textContent = err.message;
  } finally {
    isAnalyzing = false;
  }
}

async function autoLoadMarket() {
  const urlInput = document.getElementById("url");
  const error = document.getElementById("error");
  const reason = document.getElementById("reason");
  error.textContent = "";
  reason.textContent = "Buscando proximo mercado BTC 15m...";

  try {
    const api = `/api/polymarket/auto-btc-15m?seedUrl=${encodeURIComponent(urlInput.value.trim())}`;
    const response = await fetch(api);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo detectar mercado automatico.");

    urlInput.value = data.eventUrl;
    reason.textContent = data.marketOpen
      ? "Mercado activo detectado. Ejecutando analisis..."
      : "Se detecto mercado cercano. Puede que aun no abra; igual se analiza.";
    await runAnalysis();
  } catch (err) {
    error.textContent = err.message;
    reason.textContent = "No se pudo cargar automaticamente el mercado.";
  }
}

function startAutoRefresh() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    runAnalysis();
  }, 2000);
}

document.getElementById("runBtn").addEventListener("click", runAnalysis);
document.getElementById("autoBtn").addEventListener("click", autoLoadMarket);
autoLoadMarket();
startAutoRefresh();
