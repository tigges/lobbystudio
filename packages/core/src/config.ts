import { anthropicKey } from "./llm/anthropic.ts";

export type LlmMode = "live" | "offline";

export function llmMode(): LlmMode {
  const forced = process.env.LLM_MODE;
  if (forced === "live" || forced === "offline") return forced;
  return anthropicKey() ? "live" : "offline";
}

export const DEFAULT_TENANT = "harbour-dental";

export const MODEL_ROLES = {
  chat: "claude-haiku-5-5",
  reflection: "claude-opus-5-5",
} as const;
