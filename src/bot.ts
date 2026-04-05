/**
 * Aegis AI – Trading Engine Entry Point
 * ──────────────────────────────────────
 * Boot order:
 *  1. Config + Kraken CLI health check
 *  2. MongoDB connect
 *  3. Express + Socket.io server
 *  4. Paper account init (if paper mode)
 *  5. Crash recovery — restore open positions from DB
 *  6. Main trading loop (every 30s, only runs when bot is started)
 */

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server as IOServer } from "socket.io";
import { config } from "./config/env.js";
import { connectDB } from "./db/connect.js";
import { initEvents, emit } from "./modules/events/index.js";
import { initPaperAccount, krakenStatus } from "./modules/execution/index.js";
import { getMarketData, getPriceHistory } from "./modules/market/index.js";
import { getStrategy } from "./modules/strategy/loader.js";
import { calculateRisk } from "./modules/risk/index.js";
import { openPosition, recoverOpenPositions, getActivePositions } from "./modules/position/index.js";
import { botState } from "./modules/state/index.js";
import { botRouter } from "./api/routes/bot.js";
import { logger } from "./utils/logger.js";

const TRADING_PAIR = "XBTUSD";     // Change to ETH/SOL etc. as needed
const LOOP_INTERVAL_MS = 30_000;   // 30 seconds

function hasOpenPositionForPair(pair: string): boolean {
  return getActivePositions().some((p) => p.pair === pair && p.status === "open");
}

async function main(): Promise<void> {

    // ── 2. MongoDB ──────────────────────────────────────────────
  await connectDB();

  // ── 1. Kraken CLI health check ──────────────────────────────
  logger.info("[Boot] Checking Kraken CLI...");
  const alive = await krakenStatus();
  if (!alive) {
    logger.error("[Boot] ❌ Kraken CLI not responding");
    logger.error(`       KRAKEN_BINARY_PATH = ${config.krakenBinaryPath}`);
    logger.error("       In Ubuntu WSL: run  which kraken  to find the correct path");
    process.exit(1);
  }
  logger.info("[Boot] ✅ Kraken CLI OK");



  // ── 3. Express + Socket.io ──────────────────────────────────
  const app = express();
  app.use(cors({ origin: config.frontendUrl, credentials: true }));
  app.use(express.json());
  app.use("/api", botRouter);
  app.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

  const httpServer = createServer(app);
  const io = new IOServer(httpServer, {
    cors: { origin: config.frontendUrl, methods: ["GET", "POST"] },
  });

  initEvents(io);

  io.on("connection", (socket) => {
    logger.info(`[WS] Client connected: ${socket.id}`);
    // Push current status to newly connected client immediately
    socket.emit("aegis_event", {
      type: "BOT_STATUS",
      payload: { running: botState.running, mode: botState.mode, strategy: botState.strategy },
      timestamp: Date.now(),
    });
    socket.on("disconnect", () => logger.info(`[WS] Client disconnected: ${socket.id}`));
  });

  httpServer.listen(config.port, () => {
    logger.info(`[Boot] ✅ HTTP  → http://localhost:${config.port}`);
    logger.info(`[Boot] ✅ WS    → ws://localhost:${config.port}`);
  });

  // ── 4. Paper mode ───────────────────────────────────────────
  if (config.mode === "paper") {
    await initPaperAccount(10_000);
    logger.info("[Boot] ✅ Paper account ($10,000)");
  }

  // ── 5. Crash recovery ───────────────────────────────────────
  await recoverOpenPositions();

  logger.info(`[Boot] Mode:     ${config.mode.toUpperCase()}`);
  logger.info(`[Boot] Strategy: ${botState.strategy}`);
  logger.info(`[Boot] Pair:     ${TRADING_PAIR}`);
  logger.info("[Boot] 🚀 Ready. Hit POST /api/bot/start to begin trading.");

  emit("BOT_STATUS", {
    running: botState.running,
    mode: botState.mode,
    strategy: botState.strategy,
  });

  // ── 6. Main trading loop ─────────────────────────────────────
  setInterval(async () => {
    if (!botState.running) return;

    try {
      // Skip if already holding a position in this pair
      if (hasOpenPositionForPair(TRADING_PAIR)) {
        logger.debug(`[Loop] Position already open for ${TRADING_PAIR} — skipping`);
        return;
      }

      // a) Price + enriched signal
      const market = await getMarketData(TRADING_PAIR);
      emit("MARKET_UPDATE", market);

      // b) Strategy evaluation
      const stratFn = getStrategy(botState.strategy);
      const signal = await stratFn({
        marketData: market,
        priceHistory: getPriceHistory(TRADING_PAIR),
      });

      emit("STRATEGY_SIGNAL", signal);
      logger.info(`[Strategy] ${signal.action} ${(signal.confidence * 100).toFixed(0)}% — ${signal.reason}`);

      if (signal.action === "HOLD" || signal.confidence < 0.3) return;

      // c) Risk evaluation
      const direction = signal.action === "BUY" ? "buy" : "sell";
      const risk = calculateRisk({
        entryPrice: market.price,
        direction,
        pair: TRADING_PAIR,
        availableBalance: 10_000, // TODO: wire up getBalance() for live mode
      });

      if (!risk.approved) {
        emit("RISK_REJECTED", { reason: risk.reason });
        logger.warn(`[Risk] REJECTED — ${risk.reason}`);
        return;
      }

      emit("RISK_APPROVED", risk);

      // d) Execute + start watcher
      await openPosition({
        pair: TRADING_PAIR,
        direction,
        risk,
        strategy: botState.strategy,
        entryPrice: market.price,
      });

    } catch (err) {
      logger.error(`[Loop] Error: ${err}`);
      emit("ERROR", { message: String(err) });
    }
  }, LOOP_INTERVAL_MS);
}

main().catch((err) => {
  logger.error(`[Fatal] ${err}`);
  process.exit(1);
});
