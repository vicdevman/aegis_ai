import "dotenv/config";
import type { AegisConfig } from "../types/index.js";

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}
function opt(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config: AegisConfig = {
  krakenBinaryPath: req("KRAKEN_BINARY_PATH"),
  krakenApiKey: req("KRAKEN_API_KEY"),
  krakenApiSecret: req("KRAKEN_API_SECRET"),
  mode: opt("MODE", "paper") as "paper" | "live",
  mongodbUri: req("MONGODB_URI"),
  prismApiKey: process.env["PRISM_API_KEY"],
  port: parseInt(opt("PORT", "4000")),
  frontendUrl: opt("FRONTEND_URL", "http://localhost:3000"),
  activeStrategy: opt("ACTIVE_STRATEGY", "meanReversion"),
  risk: {
    maxPositionSizeUSD: parseFloat(opt("MAX_POSITION_SIZE_USD", "100")),
    dailyLossLimitUSD: parseFloat(opt("DAILY_LOSS_LIMIT_USD", "200")),
    stopLossPct: parseFloat(opt("STOP_LOSS_PCT", "0.03")),
    takeProfitPct: parseFloat(opt("TAKE_PROFIT_PCT", "0.06")),
    breakEvenTriggerPct: parseFloat(opt("BREAK_EVEN_TRIGGER_PCT", "0.02")),
  },
};
