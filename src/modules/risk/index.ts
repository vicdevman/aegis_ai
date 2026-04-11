import type { RiskInput, RiskOutput } from "../../types/index.js";
import { config } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { PositionModel } from "../../db/models/Position.js";

let dailyPnL = 0;

function todayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let dailyPnLKey = todayKey();

function ensureDailyPnLIsToday(): void {
  const key = todayKey();
  if (key !== dailyPnLKey) {
    dailyPnLKey = key;
    dailyPnL = 0;
    logger.info("[Risk] New day detected. Daily PnL reset.");
  }
}

export async function initDailyPnL(): Promise<void> {
  ensureDailyPnLIsToday();

  if (config.devMode) return;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const closedToday = await PositionModel.find({
    status: "closed",
    closedAt: { $gte: startOfDay },
  })
    .select({ pnl: 1 })
    .lean();

  const sum = (closedToday as Array<{ pnl?: unknown }>).reduce(
    (acc: number, p: { pnl?: unknown }) =>
      acc + (typeof p.pnl === "number" ? p.pnl : 0),
    0,
  );
  dailyPnL = sum;
  logger.info(`[Risk] Daily PnL initialized from DB: $${dailyPnL.toFixed(2)}`);
}

export function recordPnL(pnl: number): void {
  ensureDailyPnLIsToday();
  dailyPnL += pnl;
  logger.info(`[Risk] Daily PnL: $${dailyPnL.toFixed(2)}`);
}
export function getDailyPnL(): number { return dailyPnL; }
export function resetDailyPnL(): void { dailyPnL = 0; }

// Extended input type that accepts AI‑provided SL/TP percentages
interface ExtendedRiskInput extends RiskInput {
  aiStopLossPct?: number;
  aiTakeProfitPct?: number;
}

export function calculateRisk(input: ExtendedRiskInput): RiskOutput {
  const { entryPrice, direction, pair, availableBalance, aiStopLossPct, aiTakeProfitPct } = input;
  const risk = config.risk;

  if (dailyPnL <= -Math.abs(risk.dailyLossLimitUSD)) {
    logger.warn("[Risk] CIRCUIT BREAKER triggered");
    return { approved: false, reason: "Daily loss limit reached", positionSizeUSD: 0, volume: 0, stopLoss: 0, takeProfit: 0 };
  }

  const positionSizeUSD = Math.min(risk.maxPositionSizeUSD, availableBalance * 0.1);
  if (positionSizeUSD < 1) {
    return { approved: false, reason: `Insufficient balance: $${availableBalance.toFixed(2)}`, positionSizeUSD: 0, volume: 0, stopLoss: 0, takeProfit: 0 };
  }

  const volume = positionSizeUSD / entryPrice;
  let stopLoss: number, takeProfit: number, breakEvenTrigger: number | undefined;

  // Use AI‑provided percentages if given, otherwise fallback to config defaults
  const stopLossPct = aiStopLossPct ?? risk.stopLossPct;
  const takeProfitPct = aiTakeProfitPct ?? risk.takeProfitPct;

  if (direction === "buy") {
    stopLoss         = entryPrice * (1 - stopLossPct);
    takeProfit       = entryPrice * (1 + takeProfitPct);
    breakEvenTrigger = entryPrice * (1 + risk.breakEvenTriggerPct);
  } else {
    stopLoss         = entryPrice * (1 + stopLossPct);
    takeProfit       = entryPrice * (1 - takeProfitPct);
    breakEvenTrigger = entryPrice * (1 - risk.breakEvenTriggerPct);
  }

  logger.info(`[Risk] APPROVED | ${pair} | $${positionSizeUSD.toFixed(2)} | SL:${stopLoss.toFixed(2)} TP:${takeProfit.toFixed(2)}`);
  return { approved: true, reason: "Risk checks passed", positionSizeUSD, volume, stopLoss, takeProfit, breakEvenTrigger };
}