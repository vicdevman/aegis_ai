import axios from "axios";
import type { MarketData, SignalDirection } from "../../types/index.js";
import { getTicker } from "../execution/index.js";
import { config } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

// ================================
// Price History (for RSI, ATR, Trend)
// ================================
const priceHistory = new Map<string, number[]>();
const MAX_HISTORY = 50;

export function updateHistory(pair: string, price: number): void {
  const hist = priceHistory.get(pair) ?? [];
  hist.push(price);
  if (hist.length > MAX_HISTORY) hist.shift();
  priceHistory.set(pair, hist);
}

export function getPriceHistory(pair: string): number[] {
  return priceHistory.get(pair) ?? [];
}

// ================================
// Volume History (for Volume Ratio)
// ================================
const volumeHistory = new Map<string, number[]>();
const MAX_VOLUME_HISTORY = 20;

export function updateVolumeHistory(pair: string, volume24h: number): void {
  let hist = volumeHistory.get(pair) ?? [];
  hist.push(volume24h);
  if (hist.length > MAX_VOLUME_HISTORY) hist.shift();
  volumeHistory.set(pair, hist);
}

export function getAverageVolume(pair: string): number {
  const hist = volumeHistory.get(pair) ?? [];
  if (hist.length === 0) return 0;
  return hist.reduce((a, b) => a + b, 0) / hist.length;
}

// ================================
// Prism Signal (optional)
// ================================
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

// ================================
// Main Market Data Fetcher
// ================================
export async function getMarketData(pair: string): Promise<MarketData> {
  const ticker = await getTicker(pair);
  const data = ticker[pair] ?? Object.values(ticker)[0];
  if (!data) throw new Error(`No ticker data for: ${pair}`);

  const price = parseFloat(data.c[0]);
  const volume24h = parseFloat(data.v[1]);
  updateHistory(pair, price);
  updateVolumeHistory(pair, volume24h);

  const market: MarketData = {
    pair,
    price,
    bid: parseFloat(data.b[0]),
    ask: parseFloat(data.a[0]),
    volume24h,
    timestamp: Date.now(),
  };

  const signal = await fetchPrismSignal(pair).catch(() => undefined);
  if (signal) market.signal = signal;
  return market;
}

// ================================
// Technical Indicators
// ================================
export function computeRSI(pair: string, period: number = 14): number {
  const prices = getPriceHistory(pair);
  if (prices.length < period + 1) return 50; // neutral fallback
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i-1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export function computeATRPercent(pair: string, period: number = 14): number {
  const prices = getPriceHistory(pair);
  if (prices.length < period + 1) return 2.0; // neutral fallback (2% volatility)
  let trSum = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    // Approximate True Range using only close prices (simplified)
    const high = prices[i];
    const low = prices[i];
    const prevClose = prices[i-1];
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trSum += tr;
  }
  const atr = trSum / period;
  const currentPrice = prices[prices.length-1];
  return (atr / currentPrice) * 100;
}

export function computeTrend(pair: string): 'up' | 'down' | 'sideways' {
  const prices = getPriceHistory(pair);
  if (prices.length < 20) return 'sideways';
  const recent = prices.slice(-5);
  const older = prices.slice(-20, -15);
  const recentAvg = recent.reduce((a,b)=>a+b,0)/recent.length;
  const olderAvg = older.reduce((a,b)=>a+b,0)/older.length;
  if (recentAvg > olderAvg * 1.01) return 'up';
  if (recentAvg < olderAvg * 0.99) return 'down';
  return 'sideways';
}

/**
 * Compute volume ratio (current volume / average volume)
 * @param currentVolume - latest 24h volume
 * @param pair - asset pair (to retrieve average volume)
 */
export function computeVolumeRatio(currentVolume: number, pair: string): number {
  const avgVolume = getAverageVolume(pair);
  if (avgVolume === 0) return 1.0;
  return currentVolume / avgVolume;
}