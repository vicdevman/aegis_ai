/**
 * On-Chain Logger – ERC-8004 Integration Stub
 * ─────────────────────────────────────────────
 * Records every trade decision as a verifiable on-chain event.
 * This is what makes Aegis AI "trustless" — every signal,
 * risk decision, and trade is logged to an ERC-8004 registry.
 *
 * Current state: STUB — logs locally, ready for chain integration.
 *
 * To implement ERC-8004:
 *  1. Deploy an Agent Identity registry (ERC-721) on Base/testnet
 *  2. Use ethers.js to sign TradeIntent structs (EIP-712)
 *  3. Submit signed intents to the Risk Router contract
 *  4. Record Validation artifacts after each trade
 *
 * Nothing else in the codebase needs to change — just implement
 * the functions below and wire up your wallet/provider.
 *
 * Reference: docs/kraken/AGENTS.md, EIP-8004 spec
 */

import { logger } from "../../utils/logger.js";
import type { Position, StrategyOutput, RiskOutput } from "../../types/index.js";

// ── Types ─────────────────────────────────────────────────────

export interface TradeIntent {
  agentId: string;           // ERC-721 token ID of the agent
  pair: string;
  direction: "buy" | "sell";
  volume: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  strategyName: string;
  strategyReason: string;
  confidence: number;
  timestamp: number;
  signature?: string;        // EIP-712 signature (added after signing)
}

export interface ValidationArtifact {
  positionId: string;
  openedAt: Date;
  closedAt: Date;
  pnl: number;
  closeReason: string;
  tradeIntentHash: string;   // keccak256 of the TradeIntent
  onchainTxHash?: string;    // set after successful chain submission
}

// ── In-memory log (replace with on-chain calls) ───────────────

const intents: TradeIntent[] = [];
const artifacts: ValidationArtifact[] = [];

/**
 * Called before opening a position.
 * Future: sign with EIP-712 and submit to Risk Router contract.
 */
export async function recordTradeIntent(
  signal: StrategyOutput,
  risk: RiskOutput,
  pair: string,
  direction: "buy" | "sell"
): Promise<TradeIntent> {
  const intent: TradeIntent = {
    agentId: process.env["AGENT_ID"] ?? "aegis-dev",
    pair,
    direction,
    volume: risk.volume,
    entryPrice: signal.confidence, // placeholder — replace with actual entry
    stopLoss: risk.stopLoss,
    takeProfit: risk.takeProfit,
    strategyName: signal.pair,     // TODO: pass strategy name explicitly
    strategyReason: signal.reason,
    confidence: signal.confidence,
    timestamp: Date.now(),
  };

  intents.push(intent);
  logger.info(`[OnChain] TradeIntent recorded: ${pair} ${direction} @ confidence ${(intent.confidence * 100).toFixed(0)}%`);

  // TODO: Replace with actual EIP-712 signing + contract call:
  // const signer = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  // const signature = await signer.signTypedData(domain, types, intent);
  // intent.signature = signature;
  // await riskRouter.submitIntent(intent);

  return intent;
}

/**
 * Called after a position closes.
 * Future: submit ValidationArtifact to on-chain Validation Registry.
 */
export async function recordValidationArtifact(position: Position): Promise<void> {
  const artifact: ValidationArtifact = {
    positionId: position.id,
    openedAt: position.openedAt,
    closedAt: position.closedAt ?? new Date(),
    pnl: position.pnl ?? 0,
    closeReason: position.closeReason ?? "UNKNOWN",
    tradeIntentHash: `stub-hash-${position.id}`, // TODO: keccak256(TradeIntent)
  };

  artifacts.push(artifact);
  logger.info(`[OnChain] ValidationArtifact recorded: ${position.id} | PnL $${artifact.pnl.toFixed(2)} | ${artifact.closeReason}`);

  // TODO: Replace with actual registry call:
  // await validationRegistry.record(artifact, signature);
}

/** Returns all logged intents (for dashboard / API) */
export function getTradeIntents(): TradeIntent[] {
  return [...intents];
}

/** Returns all logged artifacts (for dashboard / API) */
export function getValidationArtifacts(): ValidationArtifact[] {
  return [...artifacts];
}
