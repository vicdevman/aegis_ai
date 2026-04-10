import { getSampledDecisions } from "./sampler.js";
import { buildPrompt } from "./promptbuilder.js";
import { AssetSnapshot, AIDecision } from "./types.js";
import { getActivePositions } from "../modules/position/index.js";
import { calculateRisk } from "../modules/risk/index.js";
import { logger } from "../utils/logger.js";

export async function getAITrades(
  snapshots: AssetSnapshot[],
  portfolioValue: number,
) {
  logger.debug("[AI] 🧠 getAITrades called");
  const activePositionsRaw = await getActivePositions();
  const openPositions = activePositionsRaw.filter((p) => p.status === "open");
  const prompt = buildPrompt(snapshots, openPositions, portfolioValue);
  logger.debug(`[AI] Prompt length: ${prompt.length} chars`);

  const samples = await getSampledDecisions(prompt);
  if (samples.length === 0 || samples[0].length === 0) {
    logger.warn("[AI] No valid decisions from AI");
    return [];
  }

  // Use the first (and only) sample directly – no consensus
  const decisions = samples[0];
  const trades = [];

  for (const decision of decisions) {
    if (decision.action === "hold") continue;

    // Find corresponding snapshot (to get current price if needed)
    const snapshot = snapshots.find((s) => s.asset === decision.asset);
    if (!snapshot) {
      logger.warn(`[AI] No snapshot for ${decision.asset}, skipping`);
      continue;
    }

    logger.debug(
      `[AI] Decision: ${decision.action} ${decision.asset} conf=${decision.confidence}`,
    );

    const riskInput = {
      entryPrice: decision.entryPrice,
      direction: (decision.action === "buy" ? "buy" : "sell") as "buy" | "sell",
      pair: decision.asset,
      availableBalance: portfolioValue,
      aiStopLossPct: decision.stopLossPct,
      aiTakeProfitPct: decision.takeProfitPct,
    };
    const riskOutput = calculateRisk(riskInput);
    if (!riskOutput.approved) {
      logger.debug(`[AI] Risk rejected: ${riskOutput.reason}`);
      continue;
    }

    trades.push({
      pair: decision.asset,
      direction: decision.action === "buy" ? "buy" : "sell",
      entryPrice: decision.entryPrice,
      volume: riskOutput.volume,
      stopLoss: riskOutput.stopLoss,
      takeProfit: riskOutput.takeProfit,
      breakEvenTrigger: riskOutput.breakEvenTrigger,
      confidence: decision.confidence,
      reasoning: decision.reasoningSummary,
    });
  }
  logger.debug(`[AI] Returning ${trades.length} trades`);
  return trades;
}
