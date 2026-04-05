import { randomUUID } from "crypto";
import type { Position, PositionDirection, RiskOutput, CloseReason } from "../../types/index.js";
import { openOrder, closeOrder } from "../execution/index.js";
import { startWatcher, stopWatcher } from "../watcher/index.js";
import { recordPnL } from "../risk/index.js";
import { emit } from "../events/index.js";
import { PositionModel } from "../../db/models/Position.js";
import { logger } from "../../utils/logger.js";

const active = new Map<string, Position>();

export function getActivePositions(): Position[] { return [...active.values()]; }
export function getPosition(id: string): Position | undefined { return active.get(id); }

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
    pair, direction, entryPrice,
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
  emit("TRADE_OPENED", pos);
  logger.info(`[Position] Opened: ${direction.toUpperCase()} ${pair} @ ${entryPrice} | ${pos.id}`);
  startWatcher(pos);
  return pos;
}

export async function closePosition(id: string, price: number, reason: CloseReason): Promise<void> {
  const pos = active.get(id);
  if (!pos) return;

  await closeOrder(pos.direction, pos.pair, pos.volume);

  const diff = pos.direction === "buy" ? price - pos.entryPrice : pos.entryPrice - price;
  const pnl  = diff * pos.volume;
  const pct  = (diff / pos.entryPrice) * 100;

  Object.assign(pos, { status: "closed", closedAt: new Date(), closeReason: reason, currentPrice: price, pnl, pnlPct: pct });
  active.delete(id);
  await PositionModel.findOneAndUpdate({ id }, pos);
  recordPnL(pnl);
  stopWatcher(id);
  emit("TRADE_CLOSED", { position: pos, reason, pnl, pnlPct: pct });
  logger.info(`[Position] Closed: ${pos.pair} | ${reason} | PnL $${pnl.toFixed(2)} (${pct.toFixed(2)}%)`);
}

export function moveStopLossToBreakEven(id: string, entryPrice: number): void {
  const pos = active.get(id);
  if (!pos || pos.stopLossAdjusted) return;
  pos.stopLoss = entryPrice;
  pos.stopLossAdjusted = true;
  PositionModel.findOneAndUpdate({ id }, { stopLoss: entryPrice, stopLossAdjusted: true }).catch(() => {});
  emit("POSITION_UPDATE", { id, stopLoss: entryPrice, reason: "BREAK_EVEN_MOVE" });
  logger.info(`[Position] Break-even move: ${id}`);
}

export async function recoverOpenPositions(): Promise<void> {
  const docs = await PositionModel.find({ status: "open" }).lean();
  for (const doc of docs) {
    const pos = doc as unknown as Position;
    active.set(pos.id, pos);
    startWatcher(pos);
  }
  if (docs.length) logger.info(`[Position] Recovered ${docs.length} open positions`);
}
