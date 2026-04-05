import type { RiskInput, RiskOutput } from "../../types/index.js";
import { config } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

let dailyPnL = 0;

export function recordPnL(pnl: number): void {
  dailyPnL += pnl;
  logger.info(`[Risk] Daily PnL: $${dailyPnL.toFixed(2)}`);
}
export function getDailyPnL(): number { return dailyPnL; }
export function resetDailyPnL(): void { dailyPnL = 0; }

export function calculateRisk(input: RiskInput): RiskOutput {
  const { entryPrice, direction, pair, availableBalance } = input;
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

  if (direction === "buy") {
    stopLoss         = entryPrice * (1 - risk.stopLossPct);
    takeProfit       = entryPrice * (1 + risk.takeProfitPct);
    breakEvenTrigger = entryPrice * (1 + risk.breakEvenTriggerPct);
  } else {
    stopLoss         = entryPrice * (1 + risk.stopLossPct);
    takeProfit       = entryPrice * (1 - risk.takeProfitPct);
    breakEvenTrigger = entryPrice * (1 - risk.breakEvenTriggerPct);
  }

  logger.info(`[Risk] APPROVED | ${pair} | $${positionSizeUSD.toFixed(2)} | SL:${stopLoss.toFixed(2)} TP:${takeProfit.toFixed(2)}`);
  return { approved: true, reason: "Risk checks passed", positionSizeUSD, volume, stopLoss, takeProfit, breakEvenTrigger };
}
