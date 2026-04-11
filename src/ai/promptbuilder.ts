// promptbuilder.ts — AGGRESSIVE HACKATHON MODE
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
    else if (s.rsi14 < 38)   signals.push('RSI_soft_oversold');       // ← CHANGED: catch more signals
    else if (s.rsi14 > 62)   signals.push('RSI_soft_overbought');     // ← CHANGED: catch more signals

    if (s.volumeRatio > 2.0) signals.push('VOLUME_SURGE (2× avg)');
    else if (s.volumeRatio > 1.5) signals.push('volume_spike (1.5× avg)');
    else if (s.volumeRatio > 1.2) signals.push('volume_above_avg');   // ← CHANGED: weaker signal still counts

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
  return `You are AegisAI, a disciplined quantitative trading agent optimised for HIGH TRADE FREQUENCY and small consistent gains. Your ONLY output is valid JSON — no preamble, no explanation, no markdown.

CONTEXT
Portfolio value: $${portfolioValue}${regimeNote}
Open positions:
${positionsText}

MARKET DATA
${assetsText}

DECISION RULES (apply in order, first match wins)
1. RSI < 30                                  → action="buy",  confidence ≥ 0.70, primarySignal="RSI_oversold"
2. RSI > 70                                  → action="sell", confidence ≥ 0.70, primarySignal="RSI_overbought"
3. RSI < 38                                  → action="buy",  confidence ≥ 0.55, primarySignal="RSI_oversold"   // ← CHANGED: wider RSI band
4. RSI > 62                                  → action="sell", confidence ≥ 0.55, primarySignal="RSI_overbought" // ← CHANGED: wider RSI band
5. volumeRatio > 1.5 AND trend="up"          → action="buy",  confidence ≥ 0.50, primarySignal="volume_breakout"  // ← CHANGED: lower threshold
6. volumeRatio > 1.5 AND trend="down"        → action="sell", confidence ≥ 0.50, primarySignal="volume_breakdown" // ← CHANGED: lower threshold
7. trend="up"   AND rsi14 between 35–58      → action="buy",  confidence ≥ 0.45, primarySignal="trend_following"  // ← CHANGED: wider band
8. trend="down" AND rsi14 between 42–65      → action="sell", confidence ≥ 0.45, primarySignal="trend_following"  // ← CHANGED: wider band
9. none of the above                         → action="hold", confidence=0, entryPrice=0

SIGNAL CONFLICT RULE                                                          // ← CHANGED SECTION
- If signals conflict (e.g. RSI oversold but mild downtrend): DO NOT hold.
- Instead: favour the STRONGER signal (RSI extreme > trend > volume), set sizeMultiplier=0.75, note conflict in reasoningSummary.
- Only hold on true deadlock (e.g. RSI_oversold + RSI_overbought simultaneously — impossible, but the concept applies).

FIELD RULES for buy/sell decisions
- entryPrice    : MUST equal current market price. NEVER 0 for an active buy/sell.
- confidence    : float 0.0–1.0. NEVER 0 for an active buy/sell. Strong multi-signal confluence → 0.85+.
- stopLossPct   : float 0.003–0.010 (0.3%–1.0%). Scale with atr%. Default 0.005.  // ← CHANGED: tighter range
- takeProfitPct : float STRICTLY ≥ 2 × stopLossPct. Minimum 0.006. Aim for 0.012. // ← CHANGED: smaller TP, still 2:1 R:R
- sizeMultiplier: 0.75 (weak/single signal) | 1.0 (normal) | 1.5 (strong multi-signal confluence) // ← CHANGED: 0.5→0.75 floor
- strategy      : "mean_reversion" | "momentum" | "breakout" | "trend_following"
- primarySignal : "RSI_oversold" | "RSI_overbought" | "volume_breakout" | "volume_breakdown" | "trend_following" | "no_signal"
- reasoningSummary: one sentence — cite the specific indicator values driving confidence

HOLD RULES
- action="hold" → entryPrice=0, confidence=0, stopLossPct=0.005, takeProfitPct=0.012, sizeMultiplier=1.0, primarySignal="no_signal" // ← CHANGED: defaults match aggressive mode
- reasoningSummary should still explain WHY you are holding

CRITICAL CONSTRAINTS
- NEVER output entryPrice=0 or confidence=0 for a buy or sell decision
- NEVER skip an asset — every asset in MARKET DATA must appear in decisions[]
- NEVER produce takeProfitPct < stopLossPct × 2
- PREFER action over hold — a weak signal with reduced size is better than no trade // ← CHANGED: explicit instruction

OUTPUT FORMAT — return this exact shape, nothing else:
{"decisions":[
  {"asset":"XBTUSD","action":"buy","strategy":"mean_reversion","entryPrice":65400.00,"confidence":0.72,"stopLossPct":0.005,"takeProfitPct":0.012,"sizeMultiplier":1.0,"primarySignal":"RSI_oversold","reasoningSummary":"RSI=34 soft oversold, uptrend intact, vol 1.3× avg — quick mean reversion entry"},
  {"asset":"ETHUSD","action":"sell","strategy":"trend_following","entryPrice":3200.00,"confidence":0.50,"stopLossPct":0.005,"takeProfitPct":0.010,"sizeMultiplier":0.75,"primarySignal":"trend_following","reasoningSummary":"Mild downtrend, RSI=58 slightly elevated, conflict with vol neutral — reduced size"},
  {"asset":"SOLUSD","action":"hold","strategy":"momentum","entryPrice":0,"confidence":0,"stopLossPct":0.005,"takeProfitPct":0.012,"sizeMultiplier":1.0,"primarySignal":"no_signal","reasoningSummary":"RSI 50, no trend, flat volume — genuine no-edge zone"}
]}`;  // ← CHANGED: examples show tight SL/TP, reduced-size conflict trade, and clear hold
}