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
  devMode: opt("DEV_MODE", "false") === "true",
  krakenApiKey: req("KRAKEN_API_KEY"),
  krakenApiSecret: req("KRAKEN_API_SECRET"),
  mode: opt("MODE", "paper") as "paper" | "live",
  mongodbUri: req("MONGODB_URI"),
  groqApiKey: req("GROQ_API_KEY"),
  prismApiKey: process.env["PRISM_API_KEY"],
  port: parseInt(opt("PORT", "4000")),
  frontendUrl: opt("FRONTEND_URL", "http://localhost:3000"),
  activeStrategy: opt("ACTIVE_STRATEGY", "meanReversion"),
  operatorPrivateKey:req('OPERATOR_PRIVATE_KEY'),
  agentPrivateKey: req('AGENT_PRIVATE_KEY'),
  CurrentModel: opt("CURRENT_MODEL", "llama-3.1-8b-instant"),
  risk: {
    maxPositionSizeUSD: parseFloat(opt("MAX_POSITION_SIZE_USD", "100")),
    dailyLossLimitUSD: parseFloat(opt("DAILY_LOSS_LIMIT_USD", "200")),
    stopLossPct: parseFloat(opt("STOP_LOSS_PCT", "0.02")),
    takeProfitPct: parseFloat(opt("TAKE_PROFIT_PCT", "0.04")),
    breakEvenTriggerPct: parseFloat(opt("BREAK_EVEN_TRIGGER_PCT", "0.02")),
  },
};
