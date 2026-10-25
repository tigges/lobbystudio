/**
 * USD per million tokens. Update from the providers' pricing pages when models change;
 * the ledger stores the computed cost so historical rows keep the price they were served at.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 1, output: 5 },
  "claude-sonnet-5-5": { input: 3, output: 15 },
  "claude-opus-5-5": { input: 5, output: 25 },
  offline: { input: 0, output: 0 },
};

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model];
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
