import { randomUUID } from "crypto";
import type {
  Position,
  PositionDirection,
  RiskOutput,
  CloseReason,
} from "../../types/index.js";
import { openOrder, closeOrder } from "../execution/index.js";
import { startWatcher, stopWatcher } from "../watcher/index.js";
import { recordPnL } from "../risk/index.js";
import { emit } from "../events/index.js";
import { PositionModel } from "../../db/models/Position.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config/env.js";

const active = new Map<string, Position>();
const history: Position[] = [];

export async function getActivePositions(): Promise<Position[]> {
  if (config.devMode) {
    return [...active.values()];
  }
  return (await PositionModel.find({ status: "open" }).lean()) as Position[];
}

export async function getPositionHistory(limit = 50): Promise<Position[]> {
  if (config.devMode) {
    return history.slice(-limit).reverse();
  }
  return (await PositionModel.find({ status: "closed" })
    .sort({ closedAt: -1 })
    .limit(limit)
    .lean()) as Position[];
}

export function getPosition(id: string): Position | undefined {
  return active.get(id);
}

export async function openPosition(params: {
  pair: string;
  direction: PositionDirection;
  risk: RiskOutput;
  strategy: string;
  entryPrice: number;
}): Promise<Position> {
  const { pair, direction, risk, strategy, entryPrice } = params;
  const order = await openOrder(direction, pair, risk.volume);

  const pos: Position = {
    id: randomUUID(),
    pair,
    direction,
    entryPrice,
    volume: risk.volume,
    positionSizeUSD: risk.positionSizeUSD,
    stopLoss: risk.stopLoss,
    takeProfit: risk.takeProfit,
    breakEvenTrigger: risk.breakEvenTrigger,
    stopLossAdjusted: false,
    status: "open",
    strategy,
    orderId: order.txid?.[0],
    openedAt: new Date(),
  };

  active.set(pos.id, pos);
  await PositionModel.create(pos);
  emit("TRADE_OPENED", {
    message: `New ${direction.toUpperCase()} position opened for ${pair} at $${entryPrice.toFixed(2)}. Position size: $${risk.positionSizeUSD.toFixed(2)} (${risk.volume.toFixed(6)} units). Stop-loss: $${risk.stopLoss.toFixed(2)}, Take-profit: $${risk.takeProfit.toFixed(2)}.`,
    position: pos,
  });
  logger.info(
    `[Position] Opened: ${direction.toUpperCase()} ${pair} @ ${entryPrice} | ${pos.id}`,
  );
  startWatcher(pos);
  return pos;
}

export async function closePosition(
  id: string,
  price: number,
  reason: CloseReason,
): Promise<void> {
  const pos = active.get(id);
  if (!pos) return;

  await closeOrder(pos.direction, pos.pair, pos.volume);

  const diff =
    pos.direction === "buy" ? price - pos.entryPrice : pos.entryPrice - price;
  const pnl = diff * pos.volume;
  const pct = (diff / pos.entryPrice) * 100;

  Object.assign(pos, {
    status: "closed",
    closedAt: new Date(),
    closeReason: reason,
    currentPrice: price,
    pnl,
    pnlPct: pct,
  });
  active.delete(id);
  if (config.devMode) {
    history.push({ ...pos });
    if (history.length > 100) history.shift();
  }
  await PositionModel.findOneAndUpdate({ id }, pos);
  recordPnL(pnl);
  stopWatcher(id);

  const pnlEmoji = pnl >= 0 ? "🟢" : "🔴";
  const pnlWord = pnl >= 0 ? "profit" : "loss";

  emit("TRADE_CLOSED", {
    message: `${pos.pair} position closed due to ${reason.replace(/_/g, " ").toLowerCase()}. Final ${pnlWord}: $${Math.abs(pnl).toFixed(2)} (${pct.toFixed(2)}%) ${pnlEmoji}`,
    position: pos,
    reason,
    pnl,
    pnlPct: pct,
    summary: `Trade completed with ${pnlWord} of $${Math.abs(pnl).toFixed(2)}`,
  });
  logger.info(
    `[Position] Closed: ${pos.pair} | ${reason} | PnL $${pnl.toFixed(2)} (${pct.toFixed(2)}%)`,
  );
}

export function moveStopLossToBreakEven(id: string, entryPrice: number): void {
  const pos = active.get(id);
  if (!pos || pos.stopLossAdjusted) return;
  pos.stopLoss = entryPrice;
  pos.stopLossAdjusted = true;
  PositionModel.findOneAndUpdate(
    { id },
    { stopLoss: entryPrice, stopLossAdjusted: true },
  ).catch(() => {});
  emit("POSITION_UPDATE", {
    message: `Stop-loss moved to break-even ($${entryPrice.toFixed(2)}) for position ${id.slice(0, 8)}... Position is now risk-free!`,
    id,
    stopLoss: entryPrice,
    reason: "BREAK_EVEN_MOVE",
    type: "break_even",
  });
  logger.info(`[Position] Break-even move: ${id}`);
}

export async function recoverOpenPositions(): Promise<void> {
  const docs = (await PositionModel.find({
    status: "open",
  }).lean()) as Array<unknown>;
  for (const doc of docs) {
    const pos = doc as unknown as Position;
    active.set(pos.id, pos);
    startWatcher(pos);
  }
  if (docs.length) {
    logger.info(`[Position] Recovered ${docs.length} open positions`);
    emit("SYSTEM_MESSAGE", {
      message: `Recovered ${docs.length} open position(s) from database. Positions are being monitored for stop-loss/take-profit.`,
      type: "recovery",
      count: docs.length,
    });
  }
}
