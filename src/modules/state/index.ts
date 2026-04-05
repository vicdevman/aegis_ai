/**
 * Bot Runtime State
 * ─────────────────
 * Single mutable singleton shared between bot.ts and API routes.
 * Nothing is stored here that should survive a restart — that lives in DB.
 */

export interface RuntimeState {
  running: boolean;
  strategy: string;
  mode: "paper" | "live";
  startedAt: Date | null;
}

export const botState: RuntimeState = {
  running: false,
  strategy: process.env["ACTIVE_STRATEGY"] ?? "meanReversion",
  mode: (process.env["MODE"] ?? "paper") as "paper" | "live",
  startedAt: null,
};

export function startBot(): void {
  botState.running = true;
  botState.startedAt = new Date();
}

export function stopBot(): void {
  botState.running = false;
  botState.startedAt = null;
}

export function setStrategy(name: string): void {
  botState.strategy = name;
}
