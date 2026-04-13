# Aegis AI - Trustless AI trading Agent

Aegis AI is a Node.js/TypeScript trading engine that combines:

- AI-generated trade decisions (LLM via Groq)
- Classic risk management (position sizing, stop-loss, take-profit, daily loss circuit breaker)
- Exchange execution via Kraken CLI (paper or live)
- Persistent position tracking in MongoDB
- Real-time monitoring (stop-loss / take-profit / break-even) via a watcher loop
- Real-time frontend telemetry via Socket.IO (human-readable events)
- Optional on-chain “risk router” flow (ERC-8004-style trade intents) + attestations for validation/reputation

It’s designed to be understandable for non-technical stakeholders (what the bot is doing and why) while staying inspectable for engineers (clear module boundaries, typed events, and auditable trade lifecycle).

---

## Why this project exists

### The problem
Automated trading systems often fail in practice because:

- Decisions are hard to audit (“it traded because the bot said so”)
- Risk management is bolted on late
- Frontends show dev logs instead of user-meaningful explanations
- Systems don’t recover cleanly after restarts
- “AI trading” demos skip execution realities (exchange integration, state, monitoring)

### The solution
Aegis AI treats trading as an end-to-end system:

- **Explainability:** Every major step is emitted to the frontend as a readable sentence.
- **Risk-first design:** Every trade passes a risk layer (size limits, SL/TP, daily loss limit).
- **Recoverability:** Open positions are restored from DB on boot and re-watched.
- **Hybrid Web2/Web3:** Trades can be gated/approved via an on-chain router and optionally attested for reputation/validation.

---

## What the application does (high level)

1. **Boot**
   - Loads config from `.env`
   - Checks Kraken CLI health
   - Connects to MongoDB
   - Initializes **Daily PnL** from DB (so `dailyPnL` survives restarts)
   - Restores open positions and starts watchers
   - Starts Express + Socket.IO server

2. **Market snapshot loop (every minute)**
   - Fetches market data for a list of tracked trading pairs
   - Computes indicators (RSI / ATR% / trend / volume ratio)
   - Emits `MARKET_UPDATE`

3. **Portfolio balance**
   - Reads balances via Kraken CLI
   - Emits `PORTFOLIO_UPDATE`

4. **AI trade generation**
   - Builds a prompt from:
     - market snapshots
     - currently open positions
     - available portfolio balance
   - Samples the model output via Groq (JSON-only)
   - Produces candidate trades

5. **Risk checks**
   - Applies position sizing
   - Enforces configured SL/TP (or AI-provided overrides)
   - Stops trading when daily loss limit triggers

6. **Execution + lifecycle tracking**
   - Submits trade intent (optional on-chain gating)
   - Opens a local position + stores it in MongoDB
   - Watcher monitors price and closes on SL/TP
   - On close, PnL is recorded into Daily PnL

---

## Key features

- **Real-time frontend visibility** via Socket.IO events
- **Paper and live modes** (paper via Kraken CLI “paper” commands)
- **Position recovery** after restarts
- **Daily PnL** tracking with DB initialization
- **On-chain endpoints** to inspect agent/reputation/trades/attestations

---

## Tech stack

- **Runtime:** Node.js (ESM)
- **Language:** TypeScript
- **Web server:** Express
- **Realtime:** Socket.IO
- **DB:** MongoDB + Mongoose
- **AI:** Groq SDK (LLM JSON decisions)
- **On-chain:** viem
- **Process exec:** execa (Kraken CLI integration)
- **Logging:** winston

---

## Getting started

### Prerequisites

- Node.js 18+ (recommended)
- `pnpm` (recommended) or `npm`
- A running MongoDB instance
- Kraken CLI binary accessible on the machine
- Groq API key

### Install

```bash
pnpm install
```

### Configure environment variables

Create a `.env` file. The configuration is loaded from `src/config/env.ts`.

Required variables (minimum):

- `KRAKEN_BINARY_PATH`
- `KRAKEN_API_KEY`
- `KRAKEN_API_SECRET`
- `MONGODB_URI`
- `GROQ_API_KEY`
- `OPERATOR_PRIVATE_KEY`
- `AGENT_PRIVATE_KEY`

Common optional variables:

- `MODE` (`paper` | `live`, default: `paper`)
- `DEV_MODE` (`true` | `false`, default: `false`)
- `FRONTEND_URL` (default: `http://localhost:3000`)
- `PORT` (default: `4000`)
- `ACTIVE_STRATEGY`
- `CURRENT_MODEL`

Risk config:

- `MAX_POSITION_SIZE_USD`
- `DAILY_LOSS_LIMIT_USD`
- `STOP_LOSS_PCT`
- `TAKE_PROFIT_PCT`
- `BREAK_EVEN_TRIGGER_PCT`

### Run (development)

```bash
pnpm run dev
```

### Build + run (production)

```bash
pnpm run build
pnpm start
```

---

## API endpoints

Base URL: `http://localhost:<PORT>/api`

### Bot control & status

- `GET /status` — bot status snapshot (running, dailyPnL, portfolio balance, etc.)
- `POST /bot/start` — start loop
- `POST /bot/stop` — stop loop
- `POST /bot/strategy` — change strategy
- `GET /positions` — open positions
- `GET /positions/history` — last closed positions
- `GET /portfolio` — balances + basic analytics

### On-chain inspection

Mounted under `/api/onchain`:

- `GET /agent`
- `GET /reputation`
- `GET /trades`
- `GET /attestations`
- `GET /summary`

---

## Realtime events (Socket.IO)

The backend emits structured, user-readable events through the central emitter in:

- `src/modules/events/index.ts`

Common event types include:

- `MARKET_UPDATE`
- `PORTFOLIO_UPDATE`
- `SYSTEM_MESSAGE`
- `TRADE_OPENED`
- `TRADE_CLOSED`
- `POSITION_UPDATE`
- `BOT_STATUS`
- `ERROR`

For payload shapes and frontend implementation notes, see:

- `FRONTEND_EMIT_SYSTEM.md`

---

## Folder structure (what lives where)

```text
src/
  bot.ts                  # Main entrypoint (boot + trading loop)

  ai/                      # AI decision system
    types.ts               # Zod schema + types for AI decisions
    promptbuilder.ts       # Builds the LLM prompt (market + positions + balance)
    sampler.ts             # Calls Groq and validates JSON output
    consensus.ts           # (Optional) consensus logic; may be bypassed in single-sample mode
    index.ts               # Orchestrates AI → trades

  api/
    routes/
      bot.ts               # REST bot control + status endpoints
      onchain.ts           # REST endpoints for on-chain visibility

  blockchain/
    erc8004.ts             # Trade intent submission, simulation, attestations, publicClient

  config/
    env.ts                 # Loads .env into a typed config object

  db/
    connect.ts             # Mongo connection
    models/                # Mongoose models (Position, etc.)
    simulator.ts           # (Optional) simulation utilities

  modules/
    events/                # Socket.IO event emitter
    execution/             # Kraken CLI integration (balance, orders)
    market/                # Market data fetch + indicators + history
    position/              # Position open/close/recovery + DB persistence
    risk/                  # Risk sizing + dailyPnL circuit breaker
    state/                 # botState + start/stop strategy switching
    strategy/              # Plug-in strategies (loader + implementations)
    watcher/               # Price monitoring loop and stop-loss/take-profit closes

  types/
    index.ts               # Shared types used everywhere

  utils/
    logger.ts              # Winston logger
```

---

## Deployment notes

This repo includes a GitHub Action workflow:

- `.github/workflows/deploy.yml`

It deploys to a VPS over SSH (you must set secrets such as `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, etc.).

You’ll also need a process manager (e.g. `pm2`) on the VPS to run `dist/bot.js` continuously.

---

## Safety / disclaimer

This project is an engineering system for automated trading. It is not financial advice.

If you run in live mode, you are responsible for:

- securing secrets
- validating risk parameters
- understanding exchange behavior and slippage

---

## License

TBD
