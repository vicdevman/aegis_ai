import type { StrategyInput, StrategyOutput } from "../../types/index.js";

const LOOKBACK = 14;
const BUFFER = 0.003;

export async function breakout(input: StrategyInput): Promise<StrategyOutput> {
  const { marketData, priceHistory } = input;
  const { pair, price } = marketData;

  if (priceHistory.length < LOOKBACK) {
    return { action: "HOLD", confidence: 0, pair, reason: `Warming up (${priceHistory.length}/${LOOKBACK})` };
  }

  const recent = priceHistory.slice(-LOOKBACK);
  const high = Math.max(...recent);
  const low = Math.min(...recent);
  const range = high - low;

  if (price > high * (1 + BUFFER)) {
    return { action: "BUY", confidence: Math.min((price - high) / range, 1), pair, reason: `Breakout above ${high.toFixed(2)}` };
  }
  if (price < low * (1 - BUFFER)) {
    return { action: "SELL", confidence: Math.min((low - price) / range, 1), pair, reason: `Breakdown below ${low.toFixed(2)}` };
  }
  return { action: "HOLD", confidence: 0, pair, reason: `Ranging [${low.toFixed(2)}, ${high.toFixed(2)}]` };
}
