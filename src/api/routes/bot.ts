/**
 * REST API – Bot Control Routes
 * ──────────────────────────────
 * POST /api/bot/start          Start the trading loop
 * POST /api/bot/stop           Stop the trading loop
 * POST /api/bot/strategy       Switch active strategy
 * GET  /api/status             Full status snapshot
 * GET  /api/positions          Active open positions
 * GET  /api/positions/history  Last 50 closed positions
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { botState, startBot, stopBot, setStrategy } from "../../modules/state/index.js";
import { getActivePositions } from "../../modules/position/index.js";
import { getDailyPnL } from "../../modules/risk/index.js";
import { getActiveWatcherCount } from "../../modules/watcher/index.js";
import { listStrategies } from "../../modules/strategy/loader.js";
import { PositionModel } from "../../db/models/Position.js";
import { emit } from "../../modules/events/index.js";
import { logger } from "../../utils/logger.js";

export const botRouter = Router();

// ── GET /api/status ───────────────────────────────────────────
botRouter.get("/status", (_req: Request, res: Response) => {
  res.json({
    running: botState.running,
    strategy: botState.strategy,
    mode: botState.mode,
    startedAt: botState.startedAt,
    activePositions: getActivePositions().length,
    activeWatchers: getActiveWatcherCount(),
    dailyPnL: getDailyPnL(),
    availableStrategies: listStrategies(),
    uptime: Math.round(process.uptime()),
  });
});

// ── POST /api/bot/start ───────────────────────────────────────
botRouter.post("/bot/start", (_req: Request, res: Response) => {
  if (botState.running) {
    res.status(400).json({ error: "Bot is already running" });
    return;
  }
  startBot();
  emit("BOT_STATUS", { running: true, strategy: botState.strategy, mode: botState.mode });
  logger.info("[API] ▶ Bot started");
  res.json({ success: true, message: "Bot started" });
});

// ── POST /api/bot/stop ────────────────────────────────────────
botRouter.post("/bot/stop", (_req: Request, res: Response) => {
  stopBot();
  emit("BOT_STATUS", { running: false, strategy: botState.strategy, mode: botState.mode });
  logger.info("[API] ■ Bot stopped");
  res.json({ success: true, message: "Bot stopped" });
});

// ── POST /api/bot/strategy ────────────────────────────────────
botRouter.post("/bot/strategy", (req: Request, res: Response) => {
  const { strategy } = req.body as { strategy?: string };
  const available = listStrategies();

  if (!strategy || !available.includes(strategy)) {
    res.status(400).json({ error: `Invalid strategy. Available: ${available.join(", ")}` });
    return;
  }

  setStrategy(strategy);
  emit("BOT_STATUS", { running: botState.running, strategy, mode: botState.mode });
  logger.info(`[API] Strategy → ${strategy}`);
  res.json({ success: true, strategy });
});

// ── GET /api/positions ────────────────────────────────────────
botRouter.get("/positions", (_req: Request, res: Response) => {
  res.json(getActivePositions());
});

// ── GET /api/positions/history ────────────────────────────────
botRouter.get("/positions/history", async (_req: Request, res: Response) => {
  try {
    const closed = await PositionModel
      .find({ status: "closed" })
      .sort({ closedAt: -1 })
      .limit(50)
      .lean();
    res.json(closed);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/onchain/intents ──────────────────────────────────
botRouter.get("/onchain/intents", async (_req: Request, res: Response) => {
  const { getTradeIntents } = await import("../../modules/onchain/index.js");
  res.json(getTradeIntents());
});

// ── GET /api/onchain/artifacts ────────────────────────────────
botRouter.get("/onchain/artifacts", async (_req: Request, res: Response) => {
  const { getValidationArtifacts } = await import("../../modules/onchain/index.js");
  res.json(getValidationArtifacts());
});
