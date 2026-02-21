# new-crypto-bot

Crypto trading bot with Python brain and TypeScript UI.

## Project structure

- `backend/brain.py`: Python "brain" that emits basic buy/sell/hold signals.
- `frontend/src/app.ts`: TypeScript UI source.
- `frontend/public/app.js`: Runtime JS used by the browser.
- `frontend/dev-server.js`: Minimal local server for the UI.
- `scripts/analyze.js`: Local project analyzer.

## Run

UI + analyzer:

```bash
npm run start
```

Only analyzer:

```bash
npm run analyze
```

Python brain:

```bash
python backend/brain.py
```

## Polymarket analyzer

Analyze a specific Polymarket event (liquidity, bid/ask, spread, slippage, and simple EV):

```bash
npm run polymarket:analyze -- --url "https://polymarket.com/es/event/btc-updown-15m-1771652700" --stake 100 --pYes 0.56
```

If you only want to test format/logic without network:

```bash
npm run polymarket:analyze -- --demo --stake 100 --pYes 0.56
```
