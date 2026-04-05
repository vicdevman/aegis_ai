import type { Position } from "../../types/index.js";
import { getTicker } from "../execution/index.js";
import { emit } from "../events/index.js";
import { logger } from "../../utils/logger.js";

const POLL_MS = 2000;
const watchers = new Map<string, NodeJS.Timeout>();

// Lazy import avoids circular dep: watcher -> position -> watcher
async function pm() {
  return import("../position/index.js");
}

export function startWatcher(position: Position): void {
  if (watchers.has(position.id)) return;
  logger.info(`[Watcher] Born  → ${position.id} (${position.pair})`);

  const interval = setInterval(async () => {
    try {
      await tick(position);
    } catch (err) {
      logger.error(`[Watcher] Tick error ${position.id}: ${err}`);
    }
  }, POLL_MS);

  watchers.set(position.id, interval);
}

export function stopWatcher(id: string): void {
  const t = watchers.get(id);
  if (t) { clearInterval(t); watchers.delete(id); }
  logger.info(`[Watcher] Died  → ${id}`);
}

export function getActiveWatcherCount(): number {
  return watchers.size;
}

async function tick(pos: Position): Promise<void> {
  const ticker = await getTicker(pos.pair);
  const d = ticker[pos.pair] ?? Object.values(ticker)[0];
  if (!d) return;

  const price = parseFloat(d.c[0]);
  pos.currentPrice = price;

  const diff = pos.direction === "buy" ? price - pos.entryPrice : pos.entryPrice - price;
  const pnl  = diff * pos.volume;

  emit("POSITION_UPDATE", { id: pos.id, pair: pos.pair, currentPrice: price, stopLoss: pos.stopLoss, takeProfit: pos.takeProfit, pnl });

  const { closePosition, moveStopLossToBreakEven } = await pm();

  if (pos.direction === "buy") {
    if (price <= pos.stopLoss)  { await closePosition(pos.id, price, "STOP_LOSS"); return; }
    if (price >= pos.takeProfit) { await closePosition(pos.id, price, "TAKE_PROFIT"); return; }
    if (pos.breakEvenTrigger && price >= pos.breakEvenTrigger && !pos.stopLossAdjusted) {
      moveStopLossToBreakEven(pos.id, pos.entryPrice);
    }
  } else {
    if (price >= pos.stopLoss)  { await closePosition(pos.id, price, "STOP_LOSS"); return; }
    if (price <= pos.takeProfit) { await closePosition(pos.id, price, "TAKE_PROFIT"); return; }
    if (pos.breakEvenTrigger && price <= pos.breakEvenTrigger && !pos.stopLossAdjusted) {
      moveStopLossToBreakEven(pos.id, pos.entryPrice);
    }
  }
}
