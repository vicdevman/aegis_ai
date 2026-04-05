// ─────────────────────────────────────────────────────────────
// Aegis AI – Shared Types
// All modules depend on this. Change here, changes everywhere.
// ─────────────────────────────────────────────────────────────

// ── Market ──────────────────────────────────────────────────
export interface MarketData {
  pair: string;
  price: number;
  bid: number;
  ask: number;
  volume24h?: number;
  timestamp: number;
  signal?: SignalDirection;
  confidence?: number;
}

export type SignalDirection = "BUY" | "SELL" | "HOLD";

// ── Strategy ────────────────────────────────────────────────
export interface StrategyInput {
  marketData: MarketData;
  priceHistory: number[];
}

export interface StrategyOutput {
  action: SignalDirection;
  confidence: number; // 0–1
  pair: string;
  reason: string;
}

// ── Risk ────────────────────────────────────────────────────
export interface RiskInput {
  entryPrice: number;
  direction: "buy" | "sell";
  pair: string;
  availableBalance: number;
}

export interface RiskOutput {
  approved: boolean;
  reason: string;
  positionSizeUSD: number;
  volume: number; // calculated from positionSizeUSD / entryPrice
  stopLoss: number;
  takeProfit: number;
  breakEvenTrigger?: number;
}

// ── Position ────────────────────────────────────────────────
export type PositionStatus = "open" | "closed" | "cancelled";
export type PositionDirection = "buy" | "sell";

export interface Position {
  id: string;
  pair: string;
  direction: PositionDirection;
  entryPrice: number;
  currentPrice?: number;
  volume: number;
  positionSizeUSD: number;
  stopLoss: number;
  takeProfit: number;
  breakEvenTrigger?: number;
  stopLossAdjusted: boolean;
  status: PositionStatus;
  strategy: string;
  orderId?: string;
  openedAt: Date;
  closedAt?: Date;
  closeReason?: CloseReason;
  pnl?: number;
  pnlPct?: number;
}

export type CloseReason =
  | "STOP_LOSS"
  | "TAKE_PROFIT"
  | "BREAK_EVEN"
  | "MANUAL"
  | "ERROR";

// ── Events ──────────────────────────────────────────────────
export type AegisEventType =
  | "MARKET_UPDATE"
  | "STRATEGY_SIGNAL"
  | "RISK_APPROVED"
  | "RISK_REJECTED"
  | "TRADE_OPENED"
  | "TRADE_CLOSED"
  | "POSITION_UPDATE"
  | "BOT_STATUS"
  | "ERROR"
  | "LOG";

export interface AegisEvent<T = unknown> {
  type: AegisEventType;
  payload: T;
  timestamp: number;
}

// ── Bot State ────────────────────────────────────────────────
export interface BotState {
  running: boolean;
  strategy: string;
  mode: "paper" | "live";
  activePositions: number;
  dailyPnL: number;
  startedAt?: Date;
}

// ── Kraken CLI ───────────────────────────────────────────────
export interface KrakenTickerResponse {
  [pair: string]: {
    a: [string, number, string]; // ask [price, whole lot volume, lot volume]
    b: [string, number, string]; // bid
    c: [string, number];          // last trade [price, lot volume]
    v: [string, string];          // volume [today, last 24h]
    p: [string, string];          // vwap
    t: [number, number];          // trades count
    l: [string, string];          // low
    h: [string, string];          // high
    o: string;                    // open
  };
}

export interface KrakenOrderResponse {
  txid?: string[];
  descr?: {
    order: string;
  };
}

export interface KrakenBalanceResponse {
  [currency: string]: string;
}

// ── Config ───────────────────────────────────────────────────
export interface AegisConfig {
  krakenBinaryPath: string;
  krakenApiKey: string;
  krakenApiSecret: string;
  mode: "paper" | "live";
  mongodbUri: string;
  prismApiKey?: string;
  port: number;
  frontendUrl: string;
  activeStrategy: string;
  risk: {
    maxPositionSizeUSD: number;
    dailyLossLimitUSD: number;
    stopLossPct: number;
    takeProfitPct: number;
    breakEvenTriggerPct: number;
  };
}
