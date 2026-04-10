import { AssetSnapshot } from './types.js';

export function buildPrompt(
  snapshots: AssetSnapshot[],
  openPositions: Array<{
    pair: string;
    direction: string;
    entryPrice: number;
    currentPrice?: number;
  }>,
  portfolioValue: number,
  marketRegime?: 'trending' | 'ranging' | 'volatile' | 'unknown'
): string {

  // ── Asset block ──────────────────────────────────────────────────────────
  const assetsText = snapshots.map(s => {
    const signals: string[] = [];

    if (s.rsi14 < 30)        signals.push('RSI_oversold (EXTREME)');
    else if (s.rsi14 > 70)   signals.push('RSI_overbought (EXTREME)');

    if (s.volumeRatio > 2.0) signals.push('VOLUME_SURGE (2× avg)');
    else if (s.volumeRatio > 1.5) signals.push('volume_spike (1.5× avg)');

    if (s.atrPercent > 4)    signals.push('VERY_HIGH_VOLATILITY → reduce size');
    else if (s.atrPercent > 2.5) signals.push('elevated_volatility');

    if (s.trend === 'up' && s.rsi14 < 55)   signals.push('uptrend_intact');
    if (s.trend === 'down' && s.rsi14 > 45) signals.push('downtrend_intact');

    const pctChange = s.change24h >= 0 ? `+${s.change24h.toFixed(2)}%` : `${s.change24h.toFixed(2)}%`;

    return `
  [${s.asset}] class=${s.assetClass}
    price=$${s.price.toFixed(2)}  24h=${pctChange}  trend=${s.trend}
    rsi14=${s.rsi14.toFixed(1)}  volRatio=${s.volumeRatio.toFixed(2)}x  atr%=${s.atrPercent.toFixed(2)}%
    active_signals=${signals.length > 0 ? signals.join(' | ') : 'none'}`;
  }).join('\n');

  // ── Open positions block ──────────────────────────────────────────────────
  const positionsText = openPositions.length === 0
    ? 'none'
    : openPositions.map(p => {
        const current = p.currentPrice ?? p.entryPrice;
        const pnlPct = ((current - p.entryPrice) / p.entryPrice * 100).toFixed(2);
        const sign = parseFloat(pnlPct) >= 0 ? '+' : '';
        return `  ${p.pair} ${p.direction.toUpperCase()} entry=$${p.entryPrice} current=$${current} pnl=${sign}${pnlPct}%`;
      }).join('\n');

  // ── Market context ────────────────────────────────────────────────────────
  const regimeNote = marketRegime && marketRegime !== 'unknown'
    ? `\nMarket regime: ${marketRegime.toUpperCase()} — adjust confidence and sizing accordingly.`
    : '';

  // ── Prompt ────────────────────────────────────────────────────────────────
  return `You are AegisAI, a disciplined quantitative trading agent. Your ONLY output is valid JSON — no preamble, no explanation, no markdown.

CONTEXT
Portfolio value: $${portfolioValue}${regimeNote}
Open positions:
${positionsText}

MARKET DATA
${assetsText}

DECISION RULES (apply in order, first match wins)
1. RSI < 30                                  → action="buy",  confidence ≥ 0.65, primarySignal="RSI_oversold"
2. RSI > 70                                  → action="sell", confidence ≥ 0.65, primarySignal="RSI_overbought"
3. volumeRatio > 1.5 AND trend="up"          → action="buy",  confidence ≥ 0.60, primarySignal="volume_breakout"
4. volumeRatio > 1.5 AND trend="down"        → action="sell", confidence ≥ 0.60, primarySignal="volume_breakdown"
5. trend="up"   AND rsi14 between 40–55      → action="buy",  confidence ≥ 0.55, primarySignal="trend_following"
6. trend="down" AND rsi14 between 45–60      → action="sell", confidence ≥ 0.55, primarySignal="trend_following"
7. none of the above                         → action="hold", confidence=0, entryPrice=0

FIELD RULES for buy/sell decisions
- entryPrice    : MUST equal current market price. NEVER 0 for an active buy/sell.
- confidence    : float 0.0–1.0. NEVER 0 for an active buy/sell. Strong multi-signal confluence → 0.85+.
- stopLossPct   : float 0.005–0.03 (0.5%–3%). Scale to atr%. High ATR → wider stop.
- takeProfitPct : float STRICTLY ≥ 2 × stopLossPct. Minimum 0.01. Good R:R → aim for 3×.
- sizeMultiplier: 0.5 (weak/conflicting signals) | 1.0 (normal) | 1.5 (strong multi-signal confluence)
- strategy      : "mean_reversion" | "momentum" | "breakout" | "trend_following"
- primarySignal : "RSI_oversold" | "RSI_overbought" | "volume_breakout" | "volume_breakdown" | "trend_following" | "no_signal"
- reasoningSummary: one sentence — cite the specific indicator values driving confidence (e.g. "RSI=27 + volume 2.1× avg confirms oversold entry at support")

HOLD RULES
- action="hold" → entryPrice=0, confidence=0, stopLossPct=0.02, takeProfitPct=0.04, sizeMultiplier=1.0, primarySignal="no_signal"
- reasoningSummary should still explain WHY you are holding (e.g. "RSI neutral at 52, no volume confirmation")

CRITICAL CONSTRAINTS
- NEVER output entryPrice=0 or confidence=0 for a buy or sell decision
- NEVER skip an asset — every asset in MARKET DATA must appear in decisions[]
- NEVER produce takeProfitPct < stopLossPct × 2
- If multiple signals conflict (e.g. RSI oversold but strong downtrend), hold and note the conflict in reasoningSummary

OUTPUT FORMAT — return this exact shape, nothing else:
{"decisions":[
  {"asset":"XBTUSD","action":"buy","strategy":"mean_reversion","entryPrice":65400.00,"confidence":0.78,"stopLossPct":0.018,"takeProfitPct":0.054,"sizeMultiplier":1.0,"primarySignal":"RSI_oversold","reasoningSummary":"RSI=27 + vol 1.8× avg, uptrend intact, entry near 65k support"},
  {"asset":"ETHUSD","action":"hold","strategy":"momentum","entryPrice":0,"confidence":0,"stopLossPct":0.02,"takeProfitPct":0.04,"sizeMultiplier":1.0,"primarySignal":"no_signal","reasoningSummary":"RSI at 54, neutral zone, volume below avg — no edge"}
]}`;
}