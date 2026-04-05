import axios from "axios";
import type { MarketData, SignalDirection } from "../../types/index.js";
import { getTicker } from "../execution/index.js";
import { config } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

const priceHistory = new Map<string, number[]>();
const MAX_HISTORY = 50;

function updateHistory(pair: string, price: number): void {
  const hist = priceHistory.get(pair) ?? [];
  hist.push(price);
  if (hist.length > MAX_HISTORY) hist.shift();
  priceHistory.set(pair, hist);
}

export function getPriceHistory(pair: string): number[] {
  return priceHistory.get(pair) ?? [];
}

async function fetchPrismSignal(pair: string): Promise<SignalDirection | undefined> {
  if (!config.prismApiKey) return undefined;
  const symbol = pair.replace(/USD$|ZUSD$/, "");
  try {
    const { data } = await axios.get<{ signal: string }>(
      `https://api.prismapi.ai/signals/${symbol}`,
      { headers: { "X-API-Key": config.prismApiKey }, timeout: 3000 }
    );
    const sig = data.signal?.toUpperCase();
    if (sig === "BUY" || sig === "SELL" || sig === "HOLD") return sig as SignalDirection;
  } catch { /* non-critical */ }
  return undefined;
}

export async function getMarketData(pair: string): Promise<MarketData> {
  const ticker = await getTicker(pair);
  const data = ticker[pair] ?? Object.values(ticker)[0];
  if (!data) throw new Error(`No ticker data for: ${pair}`);

  const price = parseFloat(data.c[0]);
  updateHistory(pair, price);

  const market: MarketData = {
    pair,
    price,
    bid: parseFloat(data.b[0]),
    ask: parseFloat(data.a[0]),
    volume24h: parseFloat(data.v[1]),
    timestamp: Date.now(),
  };

  const signal = await fetchPrismSignal(pair).catch(() => undefined);
  if (signal) market.signal = signal;
  return market;
}
