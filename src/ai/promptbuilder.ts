import { AssetSnapshot } from './types.js';

export function buildPrompt(
  snapshots: AssetSnapshot[],
  openPositions: Array<{ pair: string; direction: string; entryPrice: number; currentPrice?: number }>,
  portfolioValue: number
): string {
  const assetsText = snapshots.map(s => {
    let signalHint = '';
    if (s.rsi14 < 30) signalHint = '🔥 OVERSOLD → STRONG BUY SIGNAL';
    else if (s.rsi14 > 70) signalHint = '🔥 OVERBOUGHT → STRONG SELL SIGNAL';
    else if (s.volumeRatio > 1.5) signalHint = '📈 VOLUME SPIKE → POTENTIAL BREAKOUT';
    else if (s.atrPercent > 3) signalHint = '⚠️ HIGH VOLATILITY → TIGHTER STOPS';
    
    return `
    ${s.asset} (${s.assetClass}):
      Price: $${s.price.toFixed(2)}
      24h change: ${s.change24h.toFixed(2)}%
      RSI(14): ${s.rsi14.toFixed(1)}${s.rsi14 < 30 || s.rsi14 > 70 ? ' (EXTREME)' : ''}
      Volume vs avg: ${s.volumeRatio.toFixed(2)}x
      Volatility (ATR%): ${s.atrPercent.toFixed(2)}%
      Trend: ${s.trend}
      ${signalHint}
  `}).join('\n');

  const positionsText = openPositions.length === 0 
    ? 'No open positions.'
    : openPositions.map(p => {
        const pnl = p.currentPrice ? ((p.currentPrice - p.entryPrice) / p.entryPrice * 100).toFixed(1) : '0';
        return `${p.pair} ${p.direction} entry $${p.entryPrice} PnL ${pnl}%`;
      }).join('\n');

  return `You are a trading AI. **Do NOT return entryPrice=0 or confidence=0 for any asset unless you are absolutely sure.**  
Portfolio value: $${portfolioValue}  
Open positions: ${positionsText}  

Market data:  
${assetsText}  

**Rules for each asset:**  
- If RSI < 30 → action = "buy", confidence >= 0.65  
- If RSI > 70 → action = "sell", confidence >= 0.65  
- If volumeRatio > 1.5 and price > 20-period high → action = "buy", confidence >= 0.6  
- If volumeRatio > 1.5 and price < 20-period low → action = "sell", confidence >= 0.6  
- Otherwise → action = "hold", confidence = 0  

**For buy/sell:**  
- entryPrice = current price (no zero)  
- stopLossPct = 0.01 to 0.03 (1-3%)  
- takeProfitPct = 0.02 to 0.08 (2-8%, must be > stopLossPct)  
- sizeMultiplier = 1.0 normally, 0.5 for weak signals, 1.5 for very strong signals  
- primarySignal = one of: "RSI_oversold", "RSI_overbought", "volume_breakout", "trend_following"  
- reasoningSummary = short sentence explaining the signal  

Return a JSON object with a "decisions" array. Example:
{"decisions": [
  {"asset":"XBTUSD","action":"buy","strategy":"mean_reversion","entryPrice":65400,"confidence":0.78,"stopLossPct":0.02,"takeProfitPct":0.05,"sizeMultiplier":1.0,"primarySignal":"RSI_oversold","reasoningSummary":"RSI=28, support at 65k"},
  {"asset":"ETHUSD","action":"hold","strategy":"momentum","entryPrice":0,"confidence":0,"stopLossPct":0.03,"takeProfitPct":0.06,"sizeMultiplier":1.0,"primarySignal":"no_signal","reasoningSummary":"RSI neutral, low volume"}
]}
`
}