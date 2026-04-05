import { execa } from "execa";
import type {
  KrakenTickerResponse,
  KrakenBalanceResponse,
  KrakenOrderResponse,
  PositionDirection,
} from "../../types/index.js";
import { config } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

async function runKraken<T>(args: string[]): Promise<T> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    KRAKEN_API_KEY: config.krakenApiKey,
    KRAKEN_API_SECRET: config.krakenApiSecret,
  };
  const fullArgs = [...args, "-o", "json"];
  logger.debug(`[Kraken] ${config.krakenBinaryPath} ${fullArgs.join(" ")}`);
  const { stdout } = await execa(config.krakenBinaryPath, fullArgs, { env });
  return JSON.parse(stdout) as T;
}

export async function getTicker(pair: string): Promise<KrakenTickerResponse> {
  return runKraken<KrakenTickerResponse>(["ticker", pair]);
}

export async function getBalance(): Promise<KrakenBalanceResponse> {
  if (config.mode === "paper") {
    return runKraken<KrakenBalanceResponse>(["paper", "balance"]);
  }
  return runKraken<KrakenBalanceResponse>(["balance"]);
}

export async function openOrder(
  direction: PositionDirection,
  pair: string,
  volume: number,
): Promise<KrakenOrderResponse> {
  const vol = volume.toFixed(8);
  if (config.mode === "paper") {
    logger.info(`[PAPER] ${direction.toUpperCase()} ${vol} ${pair}`);
    return runKraken<KrakenOrderResponse>(["paper", direction, pair, vol]);
  }
  logger.info(`[LIVE] ${direction.toUpperCase()} ${vol} ${pair}`);
  return runKraken<KrakenOrderResponse>([
    "order",
    direction,
    pair,
    vol,
    "--type",
    "market",
  ]);
}

export async function closeOrder(
  direction: PositionDirection,
  pair: string,
  volume: number,
): Promise<KrakenOrderResponse> {
  const opposite: PositionDirection = direction === "buy" ? "sell" : "buy";
  return openOrder(opposite, pair, volume);
}

export async function krakenStatus(): Promise<boolean> {
  try {
    await runKraken<unknown>(["status"]);
    return true;
  } catch {
    return false;
  }
}

export async function initPaperAccount(balance = 10000): Promise<void> {
  if (config.mode !== "paper") return;
  await runKraken<unknown>(["paper", "init", "--balance", balance.toString()]);
  logger.info(`[Execution] Paper account initialized with $${balance}`);
}
