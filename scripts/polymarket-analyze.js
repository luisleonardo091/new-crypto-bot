#!/usr/bin/env node

/**
 * Polymarket market analyzer:
 * - Reads event/market from a Polymarket event URL
 * - Pulls order books for YES/NO tokens
 * - Computes spread, depth, slippage and simple expected value
 */

const DEFAULT_STAKE_USD = 100;
const DEFAULT_FEE_BPS = 0;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k.startsWith("--")) continue;
    if (!v || v.startsWith("--")) {
      args[k.slice(2)] = true;
      continue;
    }
    args[k.slice(2)] = v;
    i += 1;
  }
  return args;
}

function extractSlug(eventUrl) {
  const u = new URL(eventUrl);
  const parts = u.pathname.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p === "event");
  if (idx === -1 || !parts[idx + 1]) {
    throw new Error("No pude extraer el slug del URL de evento.");
  }
  return parts[idx + 1];
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

function asNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : NaN;
}

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { Accept: "application/json" }
  });
  if (!r.ok) {
    throw new Error(`HTTP ${r.status} en ${url}`);
  }
  return r.json();
}

async function getMarketBySlug(slug) {
  const eventUrl = `https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`;
  const events = await fetchJson(eventUrl);
  if (Array.isArray(events) && events.length > 0) {
    const evt = events[0];
    const markets = evt.markets || [];
    if (markets.length > 0) return markets[0];
  }

  const marketUrl = `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`;
  const markets = await fetchJson(marketUrl);
  if (Array.isArray(markets) && markets.length > 0) return markets[0];

  throw new Error(`No encontré mercado para slug: ${slug}`);
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

function fmt(n, d = 4) {
  if (!Number.isFinite(n)) return "N/A";
  return n.toFixed(d);
}

function marketVerdict({ spread, askDepthUsd, bidDepthUsd, evYes, evNo, stakeUsd, market }) {
  const reasons = [];
  const active = market?.active;
  const closed = market?.closed;
  const acceptingOrders = market?.acceptingOrders;
  const endDate = market?.endDate ? new Date(market.endDate) : null;
  const ended = endDate instanceof Date && !Number.isNaN(endDate.getTime()) ? Date.now() > endDate.getTime() : false;

  if (closed === true || active === false || acceptingOrders === false || ended) {
    reasons.push("mercado no operativo (cerrado/inactivo/sin órdenes)");
  }

  if (!Number.isFinite(spread)) reasons.push("sin spread válido");
  else if (spread > 0.03) reasons.push("spread amplio (>3c)");

  if (askDepthUsd < stakeUsd) reasons.push("poca liquidez en asks para tu stake");
  if (bidDepthUsd < stakeUsd) reasons.push("poca liquidez en bids para salida rápida");

  const edge = Math.max(evYes ?? -Infinity, evNo ?? -Infinity);
  if (Number.isFinite(edge) && edge <= 0) reasons.push("EV no positivo con tu probabilidad");

  if (reasons.length) return `NO CLARO: ${reasons.join("; ")}`;
  return "APTO (según este filtro cuantitativo básico)";
}

function demoMarket() {
  return {
    question: "BTC Up or Down in 15m?",
    outcomes: ["Yes", "No"],
    clobTokenIds: ["111", "222"]
  };
}

async function getBook(tokenId, demo) {
  if (demo) {
    if (tokenId === "111") {
      return {
        bids: [{ price: 0.51, size: 120 }, { price: 0.5, size: 180 }],
        asks: [{ price: 0.53, size: 70 }, { price: 0.54, size: 130 }]
      };
    }
    return {
      bids: [{ price: 0.47, size: 130 }, { price: 0.46, size: 160 }],
      asks: [{ price: 0.49, size: 80 }, { price: 0.5, size: 150 }]
    };
  }
  const url = `https://clob.polymarket.com/book?token_id=${encodeURIComponent(tokenId)}`;
  return fetchJson(url);
}

async function main() {
  const args = parseArgs(process.argv);
  const url = args.url;
  const demo = Boolean(args.demo);
  const stakeUsd = asNum(args.stake) || DEFAULT_STAKE_USD;
  const pYes = asNum(args.pYes);
  const feeBps = asNum(args.feeBps) || DEFAULT_FEE_BPS;
  const fee = feeBps / 10000;

  if (!url && !demo) {
    throw new Error("Uso: --url <polymarket_event_url> [--stake 100] [--pYes 0.56] [--feeBps 50]");
  }

  const market = demo ? demoMarket() : await getMarketBySlug(extractSlug(url));

  const outcomes = safeJsonParse(market.outcomes, market.outcomes);
  const tokenIds = safeJsonParse(market.clobTokenIds, market.clobTokenIds);
  if (!Array.isArray(outcomes) || !Array.isArray(tokenIds) || outcomes.length < 2 || tokenIds.length < 2) {
    throw new Error("No pude mapear outcomes/tokenIds del mercado.");
  }

  const yesIdx = outcomes.findIndex((x) => String(x).toLowerCase() === "yes");
  const noIdx = outcomes.findIndex((x) => String(x).toLowerCase() === "no");
  const idxYes = yesIdx >= 0 ? yesIdx : 0;
  const idxNo = noIdx >= 0 ? noIdx : 1;

  const yesBookRaw = await getBook(String(tokenIds[idxYes]), demo);
  const noBookRaw = await getBook(String(tokenIds[idxNo]), demo);
  const yesBids = toLevels(yesBookRaw.bids);
  const yesAsks = toLevels(yesBookRaw.asks);
  const noBids = toLevels(noBookRaw.bids);
  const noAsks = toLevels(noBookRaw.asks);

  const yesBid = bestBid(yesBids);
  const yesAsk = bestAsk(yesAsks);
  const noBid = bestBid(noBids);
  const noAsk = bestAsk(noAsks);
  const yesSpread = yesAsk - yesBid;
  const noSpread = noAsk - noBid;

  const yesBuy = sharesBuyableFromAsks(yesAsks, stakeUsd);
  const noBuy = sharesBuyableFromAsks(noAsks, stakeUsd);
  const impliedPYesMid =
    Number.isFinite(yesBid) && Number.isFinite(yesAsk) ? (yesBid + yesAsk) / 2 : NaN;

  let evYes = NaN;
  let evNo = NaN;
  if (Number.isFinite(pYes) && Number.isFinite(yesBuy.avgPrice) && Number.isFinite(noBuy.avgPrice)) {
    const pNo = 1 - pYes;
    evYes = pYes * (1 - fee) - yesBuy.avgPrice;
    evNo = pNo * (1 - fee) - noBuy.avgPrice;
  }

  console.log("=== Polymarket Analyzer ===");
  console.log(`Question: ${market.question || "N/A"}`);
  console.log(
    `Status: active=${String(market.active)} closed=${String(market.closed)} acceptingOrders=${String(market.acceptingOrders)}`
  );
  if (market.endDate) console.log(`End date (UTC): ${market.endDate}`);
  console.log(`Stake USD: ${stakeUsd}`);
  console.log(`Fee bps: ${feeBps}`);
  console.log("");
  console.log("[YES]");
  console.log(`Best bid: ${fmt(yesBid, 3)} | Best ask: ${fmt(yesAsk, 3)} | Spread: ${fmt(yesSpread, 3)}`);
  console.log(`Ask depth (USD): ${fmt(depthUsd(yesAsks), 2)} | Bid depth (USD): ${fmt(depthUsd(yesBids), 2)}`);
  console.log(`Buy impact for ${stakeUsd} USD -> shares: ${fmt(yesBuy.shares, 2)} | avg fill: ${fmt(yesBuy.avgPrice, 4)}`);
  console.log("");
  console.log("[NO]");
  console.log(`Best bid: ${fmt(noBid, 3)} | Best ask: ${fmt(noAsk, 3)} | Spread: ${fmt(noSpread, 3)}`);
  console.log(`Ask depth (USD): ${fmt(depthUsd(noAsks), 2)} | Bid depth (USD): ${fmt(depthUsd(noBids), 2)}`);
  console.log(`Buy impact for ${stakeUsd} USD -> shares: ${fmt(noBuy.shares, 2)} | avg fill: ${fmt(noBuy.avgPrice, 4)}`);
  console.log("");
  console.log(`Implied p(YES) mid: ${fmt(impliedPYesMid, 4)}`);
  if (Number.isFinite(pYes)) {
    console.log(`Your p(YES): ${fmt(pYes, 4)} => EV/share BUY YES: ${fmt(evYes, 4)} | BUY NO: ${fmt(evNo, 4)}`);
  } else {
    console.log("Tip: agrega --pYes <0..1> para calcular EV según tu probabilidad subjetiva.");
  }
  console.log("");
  const verdict = marketVerdict({
    spread: Math.max(yesSpread, noSpread),
    askDepthUsd: Math.min(depthUsd(yesAsks), depthUsd(noAsks)),
    bidDepthUsd: Math.min(depthUsd(yesBids), depthUsd(noBids)),
    evYes: Number.isFinite(evYes) ? evYes : null,
    evNo: Number.isFinite(evNo) ? evNo : null,
    stakeUsd,
    market
  });
  console.log(`Verdict: ${verdict}`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
