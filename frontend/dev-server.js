const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "public");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = contentTypes[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function asNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : NaN;
}

function safeJsonParse(value, fallback = null) {
  if (value == null) return fallback;
  if (Array.isArray(value) || typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toLevels(side) {
  if (!Array.isArray(side)) return [];
  return side
    .map((l) => ({ price: asNum(l.price), size: asNum(l.size) }))
    .filter((l) => Number.isFinite(l.price) && Number.isFinite(l.size) && l.size > 0);
}

function bestBid(levels) {
  if (!levels.length) return NaN;
  return levels.reduce((m, x) => (x.price > m ? x.price : m), -Infinity);
}

function bestAsk(levels) {
  if (!levels.length) return NaN;
  return levels.reduce((m, x) => (x.price < m ? x.price : m), Infinity);
}

function depthUsd(levels) {
  return levels.reduce((sum, l) => sum + l.price * l.size, 0);
}

function sharesBuyableFromAsks(asks, stakeUsd) {
  const sorted = [...asks].sort((a, b) => a.price - b.price);
  let budget = stakeUsd;
  let shares = 0;
  let avgPriceNumerator = 0;

  for (const l of sorted) {
    if (budget <= 0) break;
    const levelCost = l.price * l.size;
    if (levelCost <= budget) {
      shares += l.size;
      avgPriceNumerator += l.price * l.size;
      budget -= levelCost;
      continue;
    }
    const partial = budget / l.price;
    shares += partial;
    avgPriceNumerator += partial * l.price;
    budget = 0;
  }

  const spent = stakeUsd - budget;
  const avg = shares > 0 ? avgPriceNumerator / shares : NaN;
  return { shares, avgPrice: avg, spentUsd: spent };
}

function pickDecision({ marketOpen, yes, no, pYes }) {
  if (!marketOpen) {
    return { action: "ESPERAR", reason: "Mercado cerrado o sin aceptar ordenes." };
  }

  const hasEdgeYes = Number.isFinite(yes.evPerShare) && yes.evPerShare > 0;
  const hasEdgeNo = Number.isFinite(no.evPerShare) && no.evPerShare > 0;

  if (!hasEdgeYes && !hasEdgeNo) {
    return { action: "ESPERAR", reason: "No hay ventaja esperada positiva con tus supuestos." };
  }

  if (hasEdgeYes && (!hasEdgeNo || yes.evPerShare >= no.evPerShare)) {
    return {
      action: "COMPRAR YES",
      reason: `Tu pYES ${pYes.toFixed(3)} es mayor al costo efectivo YES ${yes.avgFill.toFixed(3)}.`
    };
  }

  return {
    action: "COMPRAR NO",
    reason: `Tu pNO ${(1 - pYes).toFixed(3)} es mayor al costo efectivo NO ${no.avgFill.toFixed(3)}.`
  };
}

function isMarketOpen(market) {
  return (
    market?.active === true &&
    market?.closed !== true &&
    market?.acceptingOrders !== false &&
    (!market?.endDate || Date.now() <= new Date(market.endDate).getTime())
  );
}

function extractSlug(eventUrl) {
  const parsed = new URL(eventUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p === "event");
  if (idx === -1 || !parts[idx + 1]) {
    throw new Error("URL invalido: no contiene /event/<slug>");
  }
  return parts[idx + 1];
}

function extractEpochFromSlug(slug) {
  const m = String(slug || "").match(/btc-updown-15m-(\d+)/i);
  if (!m) return NaN;
  const x = Number(m[1]);
  return Number.isFinite(x) ? x : NaN;
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  return r.json();
}

async function getMarketBySlug(slug) {
  const events = await fetchJson(`https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`);
  if (Array.isArray(events) && events.length > 0) {
    const firstMarket = events[0]?.markets?.[0];
    if (firstMarket) return firstMarket;
  }
  const markets = await fetchJson(`https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`);
  if (Array.isArray(markets) && markets.length > 0) return markets[0];
  throw new Error("No encontre mercado para ese slug.");
}

async function getBook(tokenId) {
  return fetchJson(`https://clob.polymarket.com/book?token_id=${encodeURIComponent(tokenId)}`);
}

async function findAutoBtc15m(seedUrl) {
  let seedEpoch = NaN;
  if (seedUrl) {
    try {
      seedEpoch = extractEpochFromSlug(extractSlug(seedUrl));
    } catch {
      seedEpoch = NaN;
    }
  }
  if (!Number.isFinite(seedEpoch)) {
    seedEpoch = Math.floor(Date.now() / 1000 / 900) * 900;
  }

  const candidates = [];
  for (let i = -2; i <= 12; i += 1) {
    candidates.push(seedEpoch + i * 900);
  }

  let nearestFuture = null;
  for (const epoch of candidates) {
    const slug = `btc-updown-15m-${epoch}`;
    try {
      const market = await getMarketBySlug(slug);
      if (isMarketOpen(market)) {
        return {
          found: true,
          eventUrl: `https://polymarket.com/event/${slug}`,
          slug,
          question: market.question || "N/A",
          endDate: market.endDate || null,
          marketOpen: true
        };
      }
      const endTs = market?.endDate ? new Date(market.endDate).getTime() : NaN;
      if (
        Number.isFinite(endTs) &&
        endTs > Date.now() &&
        (!nearestFuture || endTs < new Date(nearestFuture.endDate).getTime())
      ) {
        nearestFuture = {
          found: true,
          eventUrl: `https://polymarket.com/event/${slug}`,
          slug,
          question: market.question || "N/A",
          endDate: market.endDate || null,
          marketOpen: false
        };
      }
    } catch {
      // Ignore slug not found and continue scanning nearby 15m windows.
    }
  }

  if (nearestFuture) return nearestFuture;
  throw new Error("No encontre un mercado BTC UpDown 15m cercano.");
}

async function analyzePolymarket({ eventUrl, stakeUsd, pYes }) {
  const slug = extractSlug(eventUrl);
  const market = await getMarketBySlug(slug);
  const outcomes = safeJsonParse(market.outcomes, market.outcomes);
  const tokenIds = safeJsonParse(market.clobTokenIds, market.clobTokenIds);

  if (!Array.isArray(outcomes) || !Array.isArray(tokenIds) || outcomes.length < 2 || tokenIds.length < 2) {
    throw new Error("No pude mapear outcomes/tokenIds del mercado.");
  }

  const yesIdx = outcomes.findIndex((x) => String(x).toLowerCase() === "yes");
  const noIdx = outcomes.findIndex((x) => String(x).toLowerCase() === "no");
  const idxYes = yesIdx >= 0 ? yesIdx : 0;
  const idxNo = noIdx >= 0 ? noIdx : 1;

  const marketOpen = isMarketOpen(market);

  if (!marketOpen) {
    return {
      market: {
        question: market.question || "N/A",
        slug,
        endDate: market.endDate || null,
        marketOpen
      },
      inputs: { stakeUsd, pYes },
      snapshot: {
        impliedPYesMid: NaN,
        yes: { bid: NaN, ask: NaN, spread: NaN, askDepthUsd: 0, bidDepthUsd: 0, avgFill: NaN, evPerShare: NaN },
        no: { bid: NaN, ask: NaN, spread: NaN, askDepthUsd: 0, bidDepthUsd: 0, avgFill: NaN, evPerShare: NaN }
      },
      decision: { action: "ESPERAR", reason: "Este mercado de 15m ya cerro. Carga el siguiente link activo." },
      prediction: pYes >= 0.5 ? "ALZA (YES)" : "BAJA (NO)",
      generatedAt: new Date().toISOString()
    };
  }

  const yesBookRaw = await getBook(String(tokenIds[idxYes]));
  const noBookRaw = await getBook(String(tokenIds[idxNo]));

  const yesBids = toLevels(yesBookRaw.bids);
  const yesAsks = toLevels(yesBookRaw.asks);
  const noBids = toLevels(noBookRaw.bids);
  const noAsks = toLevels(noBookRaw.asks);

  const yesBid = bestBid(yesBids);
  const yesAsk = bestAsk(yesAsks);
  const noBid = bestBid(noBids);
  const noAsk = bestAsk(noAsks);

  const yesBuy = sharesBuyableFromAsks(yesAsks, stakeUsd);
  const noBuy = sharesBuyableFromAsks(noAsks, stakeUsd);

  const yesEv = Number.isFinite(pYes) && Number.isFinite(yesBuy.avgPrice) ? pYes - yesBuy.avgPrice : NaN;
  const noEv = Number.isFinite(pYes) && Number.isFinite(noBuy.avgPrice) ? (1 - pYes) - noBuy.avgPrice : NaN;

  const yes = {
    bid: yesBid,
    ask: yesAsk,
    spread: yesAsk - yesBid,
    askDepthUsd: depthUsd(yesAsks),
    bidDepthUsd: depthUsd(yesBids),
    avgFill: yesBuy.avgPrice,
    evPerShare: yesEv
  };

  const no = {
    bid: noBid,
    ask: noAsk,
    spread: noAsk - noBid,
    askDepthUsd: depthUsd(noAsks),
    bidDepthUsd: depthUsd(noBids),
    avgFill: noBuy.avgPrice,
    evPerShare: noEv
  };

  const impliedPYesMid =
    Number.isFinite(yesBid) && Number.isFinite(yesAsk) ? (yesBid + yesAsk) / 2 : NaN;

  const decision = pickDecision({ marketOpen, yes, no, pYes });
  const prediction = pYes >= 0.5 ? "ALZA (YES)" : "BAJA (NO)";

  return {
    market: {
      question: market.question || "N/A",
      slug,
      endDate: market.endDate || null,
      marketOpen
    },
    inputs: { stakeUsd, pYes },
    snapshot: { impliedPYesMid, yes, no },
    decision,
    prediction,
    generatedAt: new Date().toISOString()
  };
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);

  if (parsed.pathname === "/api/polymarket/auto-btc-15m") {
    const seedUrl = parsed.searchParams.get("seedUrl");
    findAutoBtc15m(seedUrl)
      .then((data) => {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(data));
      })
      .catch((err) => {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  if (parsed.pathname === "/api/polymarket/analyze") {
    const eventUrl = parsed.searchParams.get("url");
    const stakeUsd = asNum(parsed.searchParams.get("stake")) || 100;
    const pYes = asNum(parsed.searchParams.get("pYes"));

    if (!eventUrl) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Falta query param: url" }));
      return;
    }
    if (!Number.isFinite(pYes) || pYes < 0 || pYes > 1) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "pYes debe estar entre 0 y 1" }));
      return;
    }

    analyzePolymarket({ eventUrl, stakeUsd, pYes })
      .then((data) => {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(data));
      })
      .catch((err) => {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  const reqPath = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
  const filePath = path.join(ROOT, reqPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }
  sendFile(filePath, res);
});

server.listen(PORT, () => {
  console.log(`UI running on http://localhost:${PORT}`);
});
