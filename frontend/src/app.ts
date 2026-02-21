type Signal = "BUY" | "SELL" | "HOLD";

interface Tick {
  symbol: string;
  price: number;
  signal: Signal;
  updated: string;
}

function computeSignal(price: number): Signal {
  if (price < 95500) return "BUY";
  if (price > 96500) return "SELL";
  return "HOLD";
}

function mockTick(): Tick {
  const price = Number((96000 + (Math.random() * 2400 - 1200)).toFixed(2));
  return {
    symbol: "BTCUSDT",
    price,
    signal: computeSignal(price),
    updated: new Date().toLocaleTimeString()
  };
}

function updateView(tick: Tick): void {
  const symbolEl = document.getElementById("symbol");
  const priceEl = document.getElementById("price");
  const signalEl = document.getElementById("signal");
  const updatedEl = document.getElementById("updated");
  if (!symbolEl || !priceEl || !signalEl || !updatedEl) return;

  symbolEl.textContent = tick.symbol;
  priceEl.textContent = `$${tick.price.toLocaleString()}`;
  signalEl.textContent = tick.signal;
  signalEl.className = `signal-${tick.signal.toLowerCase()}`;
  updatedEl.textContent = tick.updated;
}

setInterval(() => updateView(mockTick()), 1500);
updateView(mockTick());
