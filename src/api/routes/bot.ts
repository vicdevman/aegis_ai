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
import { getActivePositions, getPositionHistory } from "../../modules/position/index.js";
import { getDailyPnL } from "../../modules/risk/index.js";
import { getBalance } from "../../modules/execution/index.js";
import { getActiveWatcherCount } from "../../modules/watcher/index.js";
import { listStrategies } from "../../modules/strategy/loader.js";
import { PositionModel } from "../../db/models/Position.js";
import { emit } from "../../modules/events/index.js";
import { logger } from "../../utils/logger.js";

export const botRouter = Router();

function getUsdTotal(balances: Awaited<ReturnType<typeof getBalance>>): number {
  const usd = balances.balances?.USD;
  const zusd = balances.balances?.ZUSD;
  
  const raw =
    (typeof usd === "object" ? usd.total : usd) ??
    (typeof zusd === "object" ? zusd.total : zusd) ??
    0;
  return typeof raw === "number" ? raw : parseFloat(raw as string);
}

// ── GET /api/status ───────────────────────────────────────────
botRouter.get("/status", async (_req: Request, res: Response) => {
  const activePositions = await getActivePositions();
  const balances = await getBalance();
  const usdTotal = getUsdTotal(balances);

  res.json({
    running: botState.running,
    strategy: botState.strategy,
    mode: botState.mode,
    startedAt: botState.startedAt,
    activePositions: activePositions.length,
    activeWatchers: getActiveWatcherCount(),
    dailyPnL: getDailyPnL(),
    portfolioBalance: usdTotal,
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
botRouter.get("/positions", async (_req: Request, res: Response) => {
  res.json(await getActivePositions());
});

// ── GET /api/positions/history ────────────────────────────────
botRouter.get("/positions/history", async (_req: Request, res: Response) => {
  try {
    const closed = await getPositionHistory(50);
    res.json(closed);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/portfolio ──────────────────────────────────────
botRouter.get("/portfolio", async (_req: Request, res: Response) => {
  try {
    const balances = await getBalance();
    const activePositions = await getActivePositions();
    const history = await getPositionHistory(10);
    
    const usdTotal = getUsdTotal(balances);
    
    res.json({
      balance: usdTotal,
      currencies: balances.balances,
      activeCount: activePositions.length,
      historyCount: history.length,
      dailyPnL: getDailyPnL(),
      analytics: {
        // Placeholder for future analytics
        winRate: history.length > 0 ? (history.filter(p => (p.pnl || 0) > 0).length / history.length) : 0,
        avgPnL: history.length > 0 ? (history.reduce((a, b) => a + (b.pnl || 0), 0) / history.length) : 0,
      }
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

