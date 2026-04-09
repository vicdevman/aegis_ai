import { AIDecision } from './types.js';

export interface ConsensusResult {
  reached: boolean;
  decision?: AIDecision;
  agreement: number; // 0-1
}

export function buildConsensus(asset: string, samples: AIDecision[][]): ConsensusResult {
  const decisions = samples.flat().filter(d => d.asset === asset);
  if (decisions.length === 0) return { reached: false, agreement: 0 };

  const actionGroups: Record<string, AIDecision[]> = {};
  for (const d of decisions) {
    if (!actionGroups[d.action]) actionGroups[d.action] = [];
    actionGroups[d.action].push(d);
  }

  const entries = Object.entries(actionGroups);
  entries.sort((a, b) => b[1].length - a[1].length);
  const [topAction, topDecisions] = entries[0];
  const agreement = topDecisions.length / 3; // 3 total samples

  if (topDecisions.length < 2) return { reached: false, agreement };

  const avgConfidence = topDecisions.reduce((s, d) => s + d.confidence, 0) / topDecisions.length;
  const avgStop = topDecisions.reduce((s, d) => s + d.stopLossPct, 0) / topDecisions.length;
  const avgTake = topDecisions.reduce((s, d) => s + d.takeProfitPct, 0) / topDecisions.length;
  const avgSize = topDecisions.reduce((s, d) => s + d.sizeMultiplier, 0) / topDecisions.length;
  const avgEntry = topDecisions.reduce((s, d) => s + d.entryPrice, 0) / topDecisions.length;

  const signalCounts: Record<string, number> = {};
  for (const d of topDecisions) signalCounts[d.primarySignal] = (signalCounts[d.primarySignal] || 0) + 1;
  const topSignal = Object.entries(signalCounts).sort((a,b) => b[1] - a[1])[0][0];

  const base = topDecisions[0];
  return {
    reached: true,
    agreement,
    decision: {
      asset: base.asset,
      action: topAction as 'buy' | 'sell' | 'hold',
      strategy: base.strategy,
      entryPrice: avgEntry,
      confidence: avgConfidence,
      stopLossPct: avgStop,
      takeProfitPct: avgTake,
      sizeMultiplier: avgSize,
      primarySignal: topSignal,
      reasoningSummary: base.reasoningSummary
    } as AIDecision
  };
}