/**
 * Aegis AI – Trading Engine Entry Point
 * ──────────────────────────────────────
 * Boot order:
 *  1. Config + Kraken CLI health check
 *  2. MongoDB connect
 *  3. Express + Socket.io server
 *  4. Paper account init (if paper mode)
 *  5. Crash recovery — restore open positions from DB
 *  6. Main trading loop (every 1 min, only runs when bot is started)
 */
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server as IOServer } from "socket.io";
import { config } from "./config/env.js";
import { connectDB } from "./db/connect.js";
import { initEvents, emit } from "./modules/events/index.js";
import {
  initPaperAccount,
  krakenStatus,
  getBalance,
} from "./modules/execution/index.js";
import {
  getMarketData,
  getPriceHistory,
  updateHistory,
} from "./modules/market/index.js";
import { getStrategy } from "./modules/strategy/loader.js";
import { calculateRisk, initDailyPnL } from "./modules/risk/index.js";
import {
  openPosition,
  recoverOpenPositions,
  getActivePositions,
} from "./modules/position/index.js";
import { botState } from "./modules/state/index.js";
import { botRouter } from "./api/routes/bot.js";
import onchainRouter from "./api/routes/onchain.js";
import { logger } from "./utils/logger.js";
import { getAITrades } from "./ai/index.js";
import type { AssetSnapshot } from "./ai/types.js";
import type { Position } from "./types/index.js";
import {
  computeRSI,
  computeATRPercent,
  computeTrend,
} from "./modules/market/index.js";
import {
  submitTradeIntent,
  createCheckpointHash,
  postAttestation,
  publicClient,
  AGENT_WALLET,
} from "./blockchain/erc8004.js";

const TRADING_PAIR = "XBTUSD"; // Change to ETH/SOL etc. as needed
const LOOP_INTERVAL_MS = 60_000; // 1 minute (was 30 seconds)

async function hasOpenPositionForPair(pair: string): Promise<boolean> {
  const activePositions = await getActivePositions();
  return activePositions.some((p) => p.pair === pair && p.status === "open");
}

// Asset universe – expand as needed
const TRADING_PAIRS = [
  { symbol: "XBTUSD", assetClass: "crypto" },
  { symbol: "ETHUSD", assetClass: "crypto" },
  { symbol: "SOLUSD", assetClass: "crypto" },
  { symbol: "BNBUSD", assetClass: "crypto" },
  { symbol: "LINKUSD", assetClass: "crypto" },

  // { symbol: "PEPEUSD", assetClass: "crypto" },
  // { symbol: "BONZOUSD", assetClass: "crypto" },
  // { symbol: "AAPLx/USD", assetClass: "tokenized_asset" },  // uncomment if available
  // { symbol: "NVDAx/USD", assetClass: "tokenized_asset" },
];

// Store rolling volumes for volume ratio
const volumeHistory = new Map<string, number[]>();
const VOLUME_HISTORY_LEN = 20;

async function buildSnapshots(): Promise<AssetSnapshot[]> {
  const activePositionsRaw = await getActivePositions();
  const openPairs = new Set(
    activePositionsRaw
      .filter((p: Position) => p.status === "open")
      .map((p: Position) => p.pair),
  );
  const snapshots = [];
  for (const pair of TRADING_PAIRS) {
    if (openPairs.has(pair.symbol)) {
      logger.debug(`[SNAPSHOT] Skipping ${pair.symbol} – already in position`);
      continue;
    }
    try {
      const market = await getMarketData(pair.symbol);
      const price = market.price;
      const volume24h = market.volume24h || 0;

      // Update volume history
      let hist = volumeHistory.get(pair.symbol) || [];
      hist.push(volume24h);
      if (hist.length > VOLUME_HISTORY_LEN) hist.shift();
      volumeHistory.set(pair.symbol, hist);
      const avgVolume = hist.reduce((a, b) => a + b, 0) / (hist.length || 1);
      const volumeRatio = avgVolume > 0 ? volume24h / avgVolume : 1.0;

      // Compute indicators using your helper functions
      const rsi14 = computeRSI(pair.symbol);
      const atrPercent = computeATRPercent(pair.symbol);
      const trend = computeTrend(pair.symbol);

      // 24h change from price history
      const prices = getPriceHistory(pair.symbol);
      let change24h = 0;
      if (prices.length >= 2) {
        const oldest = prices[0];
        const newest = prices[prices.length - 1];
        change24h = ((newest - oldest) / oldest) * 100;
      }

      // Log snapshot values for debugging
      logger.debug(
        `[SNAPSHOT] ${pair.symbol}: price=${price}, rsi=${rsi14.toFixed(1)}, atr=${atrPercent.toFixed(2)}%, volRatio=${volumeRatio.toFixed(2)}, trend=${trend}, 24hChange=${change24h.toFixed(2)}%`,
      );

      snapshots.push({
        asset: pair.symbol,
        assetClass: pair.assetClass,
        price,
        change24h,
        rsi14,
        volumeRatio,
        atrPercent,
        trend,
      });
    } catch (err) {
      logger.warn(`Failed to build snapshot for ${pair.symbol}: ${err}`);
    }
  }
  return snapshots;
}

async function main(): Promise<void> {
  // ── 1. Kraken CLI health check ──────────────────────────────
  logger.info("[Boot] Checking Kraken CLI...");
  const alive = await krakenStatus();
  if (!alive) {
    logger.error("[Boot] ❌ Kraken CLI not responding");
    logger.error(`       KRAKEN_BINARY_PATH = ${config.krakenBinaryPath}`);
    logger.error(
      "       In Ubuntu WSL: run  which kraken  to find the correct path",
    );
    process.exit(1);
  }
  logger.info("[Boot] ✅ Kraken CLI OK");

  // ── 2. MongoDB ──────────────────────────────────────────────
  await connectDB();

  await initDailyPnL();

  // Seed price history with current prices
  async function seedPriceHistory() {
    logger.info("[Boot] Seeding price history with current prices...");
    for (const pair of TRADING_PAIRS) {
      try {
        const market = await getMarketData(pair.symbol);
        const price = market.price;
        // Fill history with 20 identical prices (no extra API calls)
        for (let i = 0; i < 20; i++) {
          updateHistory(pair.symbol, price);
        }
        logger.debug(`[Seed] ${pair.symbol} history seeded with ${price}`);
      } catch (err) {
        logger.warn(`[Seed] Failed to seed ${pair.symbol}: ${err}`);
      }
    }
    logger.info("[Boot] Price history seeded.");
  }
  await seedPriceHistory();
  // ── 3. Express + Socket.io ──────────────────────────────────
  const app = express();
  app.use(cors({ origin: config.frontendUrl, credentials: true }));
  app.use(express.json());
  app.use("/api", botRouter);
  app.use("/api/onchain", onchainRouter);
  app.get("/", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

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
      payload: {
        running: botState.running,
        mode: botState.mode,
        strategy: botState.strategy,
      },
      timestamp: Date.now(),
    });
    socket.on("disconnect", () =>
      logger.info(`[WS] Client disconnected: ${socket.id}`),
    );
  });

  httpServer.listen(config.port, () => {
    logger.info(`[Boot] ✅ HTTP  → http://localhost:${config.port}`);
    logger.info(`[Boot] ✅ WS    → ws://localhost:${config.port}`);
  });

  // ── 4. Paper mode ───────────────────────────────────────────
  // if (config.mode === "paper") {
  //   await initPaperAccount(10_000);
  //   logger.info("[Boot] ✅ Paper account ($10,000)");
  // }

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

  // ── 6. Main trading loop (RiskRouter integrated) ─────────────
  setInterval(async () => {
    logger.debug("[LOOP] 🔁 Tick start");
    logger.debug(`[LOOP] botState.running = ${botState.running}`);

    if (!botState.running) {
      logger.debug("[LOOP] Bot not running, skipping");
      return;
    }

    try {
      // ── 1. Build snapshots for all assets ─────────────────────
      logger.debug("[LOOP] Building snapshots...");
      const snapshots = await buildSnapshots();
      logger.debug(`[LOOP] Built ${snapshots.length} snapshots`);

      if (snapshots.length === 0) {
        logger.warn("[LOOP] No snapshots, skipping");
        return;
      }

      // Emit market update with user-friendly summary
      const marketSummary = snapshots
        .map(
          (s) =>
            `${s.asset}: $${s.price.toFixed(2)} (${s.change24h >= 0 ? "+" : ""}${s.change24h.toFixed(2)}%) - RSI: ${s.rsi14.toFixed(1)}`,
        )
        .join("; ");

      emit("MARKET_UPDATE", {
        message: `Market data received for ${snapshots.length} assets. ${marketSummary}`,
        snapshots,
        summary: marketSummary,
      });

      // ── 2. Portfolio value from Kraken ──────────────
      const balances = await getBalance();
      const usdEntry = balances.balances?.USD;
      const zusdEntry = balances.balances?.ZUSD;

      const rawTotal =
        (typeof usdEntry === "object" ? usdEntry.total : usdEntry) ||
        (typeof zusdEntry === "object" ? zusdEntry.total : zusdEntry) ||
        1000;

      const portfolioValue =
        typeof rawTotal === "number" ? rawTotal : parseFloat(rawTotal);
      logger.debug(`[LOOP] Portfolio value: $${portfolioValue.toFixed(2)}`);

      // Build summary string from the nested balances object
      const balancesObj = balances.balances || {};
      const summary =
        Object.entries(balancesObj)
          .map(([currency, data]) => {
            const totalAmt = typeof data === "object" ? data.total : data;
            return `${typeof totalAmt === "number" ? totalAmt.toFixed(4) : totalAmt} ${currency}`;
          })
          .join(", ") || "No balance data";

      emit("PORTFOLIO_UPDATE", {
        message: `Portfolio balance updated: $${portfolioValue.toFixed(2)} USD`,
        balance: portfolioValue,
        currencies: balancesObj,
        summary,
      });

      // ── 3. Get AI trade recommendations ────────────────────────
      emit("SYSTEM_MESSAGE", {
        message: `AI is analyzing ${snapshots.length} markets for trading opportunities...`,
        type: "info",
      });

      const trades = await getAITrades(snapshots, portfolioValue);

      if (trades.length === 0) {
        emit("SYSTEM_MESSAGE", {
          message: `No trading opportunities detected this cycle. Markets are quiet or no consensus reached.`,
          type: "info",
        });
      } else {
        emit("SYSTEM_MESSAGE", {
          message: `AI identified ${trades.length} potential trade(s) for execution.`,
          type: "opportunity",
          count: trades.length,
        });
      }

      // ── 4. Execute each trade via RiskRouter first ─────────────
      for (const trade of trades) {
        logger.info(
          `[AI TRADE] ${trade.direction} ${trade.pair} | conf: ${trade.confidence.toFixed(2)} | ${trade.reasoning}`,
        );

        if (await hasOpenPositionForPair(trade.pair)) {
          emit("SYSTEM_MESSAGE", {
            message: `Skipping ${trade.pair} trade - position already open for this asset.`,
            type: "skip",
            pair: trade.pair,
            reason: "Position already exists",
          });
          continue;
        }

        // --- 4a. Submit trade intent to RiskRouter (on-chain) ---
        const amountUsd = trade.volume * trade.entryPrice;
        if (amountUsd <= 0) {
          emit("ERROR", {
            message: `Invalid trade amount $${amountUsd.toFixed(2)} for ${trade.pair}. Trade skipped.`,
          });
          continue;
        }

        emit("SYSTEM_MESSAGE", {
          message: `Submitting ${trade.direction.toUpperCase()} trade for ${trade.pair} worth $${amountUsd.toFixed(2)} to RiskRouter for approval...`,
          type: "submitting",
          pair: trade.pair,
          direction: trade.direction,
          amount: amountUsd,
        });

        const txHash = await submitTradeIntent(
          trade.pair,
          trade.direction === "buy" ? "BUY" : "SELL",
          amountUsd,
          100, // 1% slippage
          300, // 5 min deadline
        );

        if (!txHash) {
          emit("ERROR", {
            message: `RiskRouter rejected the ${trade.direction.toUpperCase()} trade for ${trade.pair}. Trade will not be executed.`,
          });
          continue;
        }

        emit("SYSTEM_MESSAGE", {
          message: `RiskRouter approved ${trade.direction.toUpperCase()} ${trade.pair} trade! Transaction hash: ${txHash.slice(0, 20)}...`,
          type: "approved",
          pair: trade.pair,
          txHash: txHash,
        });

        // Short pause for on-chain confirmation
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // --- 4b. Open local position for watcher & PnL tracking ---
        emit("SYSTEM_MESSAGE", {
          message: `Opening ${trade.direction.toUpperCase()} position for ${trade.pair} at $${trade.entryPrice.toFixed(2)} with stop-loss at $${trade.stopLoss.toFixed(2)} and take-profit at $${trade.takeProfit.toFixed(2)}.`,
          type: "opening",
          pair: trade.pair,
          direction: trade.direction,
          entryPrice: trade.entryPrice,
          stopLoss: trade.stopLoss,
          takeProfit: trade.takeProfit,
        });

        const riskForPosition = {
          approved: true,
          reason: "AI approved + on-chain approved",
          positionSizeUSD: amountUsd,
          volume: trade.volume,
          stopLoss: trade.stopLoss,
          takeProfit: trade.takeProfit,
          breakEvenTrigger: trade.breakEvenTrigger,
        };

        // After successful submitTradeIntent
        if (txHash) {
          // Create checkpoint hash for this trade
          let stopLossPct: number, takeProfitPct: number;
          if (trade.direction === "buy") {
            stopLossPct =
              (trade.entryPrice - trade.stopLoss) / trade.entryPrice;
            takeProfitPct =
              (trade.takeProfit - trade.entryPrice) / trade.entryPrice;
          } else {
            // For sell trades (if you ever use them)
            stopLossPct =
              (trade.stopLoss - trade.entryPrice) / trade.entryPrice;
            takeProfitPct =
              (trade.entryPrice - trade.takeProfit) / trade.entryPrice;
          }

          const checkpointHash = createCheckpointHash({
            pair: trade.pair,
            action: trade.direction === "buy" ? "BUY" : "SELL",
            entryPrice: trade.entryPrice,
            stopLossPct, // convert price to %
            takeProfitPct,
            reasoning: trade.reasoning,
            timestamp: Date.now(),
          });

          // Score = confidence * 100 (0-100)
          const score = Math.min(Math.floor(trade.confidence * 100), 100);

          // Post attestation to ValidationRegistry
          await postAttestation(checkpointHash, score, trade.reasoning);
        }

        await openPosition({
          pair: trade.pair,
          direction:
            trade.direction as import("./types/index.js").PositionDirection,
          risk: riskForPosition,
          strategy: "ai_consensus",
          entryPrice: trade.entryPrice,
        });

        emit("SYSTEM_MESSAGE", {
          message: `Position opened successfully! Monitoring ${trade.pair} for stop-loss at $${trade.stopLoss.toFixed(2)} or take-profit at $${trade.takeProfit.toFixed(2)}.`,
          type: "opened",
          pair: trade.pair,
        });
      }
    } catch (err) {
      logger.error(
        `[LOOP] ❌ Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (err instanceof Error && err.stack)
        logger.error(`[LOOP] Stack: ${err.stack}`);
      emit("ERROR", { message: String(err) });
    }
  }, LOOP_INTERVAL_MS);
}

main().catch((err) => {
  logger.error(`[Fatal] ${err}`);
  process.exit(1);
});
