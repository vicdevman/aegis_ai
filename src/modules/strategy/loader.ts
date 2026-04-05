import type { StrategyInput, StrategyOutput } from "../../types/index.js";
import { meanReversion } from "./meanReversion.js";
import { breakout } from "./breakout.js";

export type StrategyFn = (input: StrategyInput) => Promise<StrategyOutput>;

const registry: Record<string, StrategyFn> = {
  meanReversion,
  breakout,
};

export function getStrategy(name: string): StrategyFn {
  const s = registry[name];
  if (!s) throw new Error(`Unknown strategy: "${name}". Available: ${Object.keys(registry).join(", ")}`);
  return s;
}

export function listStrategies(): string[] {
  return Object.keys(registry);
}
