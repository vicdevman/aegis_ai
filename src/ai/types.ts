import { z } from 'zod';

export const AIDecisionSchema = z.discriminatedUnion('action', [
  z.object({
    asset: z.string().min(3).max(20),
    action: z.literal('hold'),
    entryPrice: z.number().default(0),
    confidence: z.number().min(0).max(1).default(0),
    stopLossPct: z.number().min(0).max(0.15).default(0.03),
    takeProfitPct: z.number().min(0).max(0.30).default(0.06),
    sizeMultiplier: z.number().min(0).max(2).default(1),
    primarySignal: z.string().default('no_signal'),
    reasoningSummary: z.string().max(200).default('No signal'),
    // strategy is optional for hold
    strategy: z.enum(['mean_reversion', 'breakout', 'momentum', 'trend_following']).optional()
  }),
  z.object({
    asset: z.string().min(3).max(20),
    action: z.enum(['buy', 'sell']),
    strategy: z.enum(['mean_reversion', 'breakout', 'momentum', 'trend_following']),
    entryPrice: z.number().positive(),
    confidence: z.number().min(0.5).max(1),
    stopLossPct: z.number().min(0.005).max(0.15),
    takeProfitPct: z.number().min(0.01).max(0.30),
    sizeMultiplier: z.number().min(0.5).max(2.0),
    primarySignal: z.string().min(3).max(40),
    reasoningSummary: z.string().min(5).max(200)
  }).refine(data => data.takeProfitPct > data.stopLossPct, {
    message: "Take profit % must be greater than stop loss %"
  })
]);

export type AIDecision = z.infer<typeof AIDecisionSchema>;

export interface AssetSnapshot {
  asset: string;
  assetClass: string;
  price: number;
  change24h: number;
  rsi14: number;
  volumeRatio: number;
  atrPercent: number;
  trend: 'up' | 'down' | 'sideways';
}