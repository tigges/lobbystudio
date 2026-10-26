import { anthropicKey } from "./llm/anthropic.ts";

export type LlmMode = "live" | "offline";

export function llmMode(): LlmMode {
  const forced = process.env.LLM_MODE;
  if (forced === "live" || forced === "offline") return forced;
  return anthropicKey() ? "live" : "offline";
}

/** Spending cap per turn in US dollars, from MAX_TURN_COST_USD; null (no cap) unless set. */
export function maxTurnCostUsd(): number | null {
  const cap = Number(process.env.MAX_TURN_COST_USD);
  return Number.isFinite(cap) && cap > 0 ? cap : null;
}

export const DEFAULT_TENANT = "harbour-dental";

export const MODEL_ROLES = {
  chat: "claude-haiku-5-5",
  reflection: "claude-opus-5-5",
} as const;
