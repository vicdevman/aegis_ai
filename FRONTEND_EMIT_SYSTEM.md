# Aegis AI Frontend Emit Log System

## Overview

The Aegis AI trading bot now provides **human-readable, user-friendly messages** through all socket.io emits. Every event includes a `message` field that describes exactly what's happening in plain English.

---

## Event Types

### 1. `BOT_STATUS`
**When**: On client connection and when bot state changes.

**Payload Structure**:
```typescript
{
  message?: string;     // Optional human-readable status
  running: boolean;     // Bot running state
  mode: "paper" | "live";  // Trading mode
  strategy: string;     // Current strategy name
}
```

**Example Message**: *"Bot is ready in LIVE mode using ai_consensus strategy. Click Start to begin trading."*

---

### 2. `PORTFOLIO_UPDATE` ⭐ NEW
**When**: Every trading cycle (every 1 minute when bot is running).

**Payload Structure**:
```typescript
{
  message: string;           // Human-readable balance summary
  balance: number;          // Total portfolio value in USD
  currencies: object;       // Raw balance data from Kraken
  summary: string;          // Formatted currency list
}
```

**Example**:
```json
{
  "message": "Portfolio balance updated: $12,458.32 USD",
  "balance": 12458.32,
  "currencies": { "ZUSD": "10000.00", "XXBT": "0.0523" },
  "summary": "10000.0000 ZUSD, 0.0523 XXBT"
}
```

---

### 3. `MARKET_UPDATE`
**When**: Every trading cycle with fresh market data.

**Payload Structure**:
```typescript
{
  message: string;      // Summary of all markets
  snapshots: array;     // Full market data
  summary: string;      // Condensed market summary
}
```

**Example Message**: *"Market data received for 3 assets. XBTUSD: $68,420.50 (+2.34%) - RSI: 65.2; ETHUSD: $3,520.10 (-0.82%) - RSI: 58.4; SOLUSD: $142.80 (+5.21%) - RSI: 72.1"*

---

### 4. `SYSTEM_MESSAGE` ⭐ NEW
**When**: Throughout the trading cycle to inform users of actions being taken.

**Payload Structure**:
```typescript
{
  message: string;      // Human-readable description
  type: string;         // Message category
  // ...additional context fields
}
```

**Types**:
- `"info"` - General information
- `"opportunity"` - Trading opportunities found
- `"submitting"` - Trade being submitted to RiskRouter
- `"approved"` - Trade approved by RiskRouter
- `"opening"` - Position opening
- `"opened"` - Position successfully opened
- `"skip"` - Trade skipped (with reason)
- `"watcher_started"` - Position monitoring started
- `"watcher_stopped"` - Position monitoring stopped

**Example Messages**:
- *"AI is analyzing 3 markets for trading opportunities..."*
- *"AI identified 2 potential trade(s) for execution."*
- *"Submitting BUY trade for XBTUSD worth $1,250.00 to RiskRouter for approval..."*
- *"RiskRouter approved BUY XBTUSD trade! Transaction hash: 0x3f2a8b..."*
- *"Opening BUY position for XBTUSD at $68,420.50 with stop-loss at $66,052.89 and take-profit at $73,010.14."*
- *"Position opened successfully! Monitoring XBTUSD for stop-loss at $66,052.89 or take-profit at $73,010.14."*
- *"Skipping ETHUSD trade - position already open for this asset."*

---

### 5. `TRADE_OPENED`
**When**: A new position is successfully opened.

**Payload Structure**:
```typescript
{
  message: string;      // Human-readable position details
  position: object;     // Full position data
}
```

**Example Message**: *"New BUY position opened for XBTUSD at $68,420.50. Position size: $1,250.00 (0.018280 units). Stop-loss: $66,052.89, Take-profit: $73,010.14."*

---

### 6. `TRADE_CLOSED`
**When**: A position is closed (stop-loss, take-profit, manual, or error).

**Payload Structure**:
```typescript
{
  message: string;      // Human-readable close details with emoji
  position: object;     // Full position data
  reason: string;       // Close reason (STOP_LOSS, TAKE_PROFIT, etc.)
  pnl: number;          // Profit/loss in USD
  pnlPct: number;       // Profit/loss percentage
  summary: string;       // Brief summary
}
```

**Example Message**: *"XBTUSD position closed due to take profit. Final profit: $245.50 (3.59%) 🟢"*

**Close Reasons**:
- `STOP_LOSS` - Position hit stop-loss
- `TAKE_PROFIT` - Position hit take-profit
- `BREAK_EVEN` - Position closed at break-even
- `MANUAL` - Manually closed by user
- `ERROR` - Closed due to error

---

### 7. `POSITION_UPDATE`
**When**: Position monitoring updates (significant PnL changes >5% or 10% of ticks).

**Payload Structure**:
```typescript
{
  message: string;      // Human-readable update with PnL
  id: string;           // Position ID
  pair: string;         // Trading pair
  currentPrice: number; // Current market price
  stopLoss: number;     // Stop-loss price
  takeProfit: number;   // Take-profit price
  pnl: number;          // Current PnL
  pnlPct: number;       // Current PnL %
  summary: string;      // Brief PnL summary
}
```

**Example Message**: *"XBTUSD position update: Current PnL $145.20 (+2.14%) 🟢 | Price: $69,890.00 | Entry: $68,420.50"*

**Special Case - Break-Even**:
```typescript
{
  message: string;      // Break-even notification
  id: string;
  stopLoss: number;
  reason: "BREAK_EVEN_MOVE";
  type: "break_even";
}
```

**Example**: *"Stop-loss moved to break-even ($68,420.50) for position 3f2a8b... Position is now risk-free!"*

---

### 8. `ERROR`
**When**: An error occurs during trading.

**Payload Structure**:
```typescript
{
  message: string;      // Human-readable error description
  // Error details
}
```

**Example Messages**:
- *"Invalid trade amount $0.00 for XBTUSD. Trade skipped."*
- *"RiskRouter rejected the SELL trade for ETHUSD. Trade will not be executed."*

---

### 9. `RISK_APPROVED` / `RISK_REJECTED`
**When**: Risk assessment completes (legacy events, now mostly superseded by SYSTEM_MESSAGE).

---

## Recommended Frontend Implementation

### 1. Message Display Component
```typescript
interface LogEntry {
  type: string;
  message: string;
  timestamp: number;
  payload: any;
}

// Display the `message` field prominently
// Use `type` for styling (colors, icons)
// Keep full `payload` for detailed views
```

### 2. Color Coding by Type
```typescript
const typeColors = {
  'info': 'blue',
  'opportunity': 'green',
  'submitting': 'yellow',
  'approved': 'green',
  'opening': 'blue',
  'opened': 'green',
  'skip': 'gray',
  'break_even': 'purple',
  'error': 'red'
};
```

### 3. Emoji Support
The backend sends emojis (🟢 🔴) for PnL indicators. Ensure your font supports these.

---

## Migration Guide (from old system)

### Before (JSON-focused):
```typescript
socket.on('aegis_event', (data) => {
  console.log(data.payload); // Raw JSON
  // Had to parse manually to show user-friendly text
});
```

### After (Message-focused):
```typescript
socket.on('aegis_event', (data) => {
  displayMessage(data.payload.message); // Ready to display!
  // Full data still available in payload for details
});
```

---

## Key Improvements

1. **All events now include a `message` field** - No more guessing what happened
2. **PORTFOLIO_UPDATE** - Real-time balance tracking from Kraken (no more hardcoded $10,000)
3. **SYSTEM_MESSAGE** - Step-by-step visibility into AI decisions and trade execution
4. **Formatted numbers** - All prices, PnL values formatted to 2 decimal places
5. **Emojis** - Visual indicators for profit/loss (🟢 🔴)
6. **Smart throttling** - POSITION_UPDATE only emits on >5% PnL moves (not every tick)

---

## Connection Events

On initial connection, the bot sends:
1. `BOT_STATUS` - Current bot state

The frontend should request or wait for:
2. `PORTFOLIO_UPDATE` - Current balance (sent every cycle)
3. `MARKET_UPDATE` - Current market data (sent every cycle)

---

*Last Updated: April 2026*
