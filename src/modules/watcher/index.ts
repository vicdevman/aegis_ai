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
  emit("SYSTEM_MESSAGE", { 
    message: `Starting position monitor for ${position.pair} ${position.direction.toUpperCase()} position. Watching for stop-loss ($${position.stopLoss.toFixed(2)}) or take-profit ($${position.takeProfit.toFixed(2)}).`,
    type: 'watcher_started',
    pair: position.pair,
    positionId: position.id.slice(0, 8)
  });
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
  if (t) { 
    clearInterval(t); 
    watchers.delete(id); 
    emit("SYSTEM_MESSAGE", { 
      message: `Stopped monitoring position ${id.slice(0, 8)}... Position no longer active.`,
      type: 'watcher_stopped',
      positionId: id.slice(0, 8)
    });
  }
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

  // Only emit significant updates to avoid spamming
  const pnlPct = (pnl / (pos.volume * pos.entryPrice)) * 100;
  if (Math.abs(pnlPct) > 5 || Math.random() < 0.1) { // Emit on >5% moves or 10% of ticks
    const pnlEmoji = pnl >= 0 ? '🟢' : '🔴';
    emit("POSITION_UPDATE", { 
      message: `${pos.pair} position update: Current PnL $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%) ${pnlEmoji} | Price: $${price.toFixed(2)} | Entry: $${pos.entryPrice.toFixed(2)}`,
      id: pos.id, 
      pair: pos.pair, 
      currentPrice: price, 
      stopLoss: pos.stopLoss, 
      takeProfit: pos.takeProfit, 
      pnl,
      pnlPct,
      summary: `PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`
    });
  }

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
