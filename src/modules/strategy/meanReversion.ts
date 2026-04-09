import type { StrategyInput, StrategyOutput } from "../../types/index.js";
import { logger } from "../../utils/logger.js";

const LOOKBACK = 20;
const THRESHOLD = 0.015;

export async function meanReversion(input: StrategyInput): Promise<StrategyOutput> {
  const { marketData, priceHistory } = input;
  const { pair, price } = marketData;

  // logger.info({ marketData, priceHistory })

  if (priceHistory.length < LOOKBACK) {
    return { action: "HOLD", confidence: 0, pair, reason: `Warming up (${priceHistory.length}/${LOOKBACK})` };
  }

  const recent = priceHistory.slice(-LOOKBACK);
  const sma = recent.reduce((a, b) => a + b, 0) / recent.length;
  const deviation = (price - sma) / sma;

  if (deviation < -THRESHOLD) {
    return { action: "BUY", confidence: Math.min(Math.abs(deviation) / 0.05, 1), pair, reason: `${(deviation * 100).toFixed(2)}% below SMA(${LOOKBACK}) @ ${sma.toFixed(2)}` };
  }
  if (deviation > THRESHOLD) {
    return { action: "SELL", confidence: Math.min(Math.abs(deviation) / 0.05, 1), pair, reason: `${(deviation * 100).toFixed(2)}% above SMA(${LOOKBACK}) @ ${sma.toFixed(2)}` };
  }
  return { action: "HOLD", confidence: 0, pair, reason: `Within ±${THRESHOLD * 100}% of SMA` };
}
