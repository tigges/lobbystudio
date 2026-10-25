export const OUTCOMES = [
  "resolved_by_bot",
  "resolved_after_handover",
  "abandoned",
  "escalated_unresolved",
  "out_of_scope",
  "blocked_by_guardrail",
] as const;
export type Outcome = (typeof OUTCOMES)[number];
export type OutcomeBasis = "confirmed" | "assumed" | "reversed";

export const ASSUME_AFTER_MS = 24 * 60 * 60 * 1000;
export const REVERSAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type ConversationFacts = {
  handedOver: boolean;
  humanReplied: boolean;
  answeredCount: number;
  fallbackCount: number;
  lastBotAct: string | null;
  lastActivityAt: Date;
  negativeFeedbackOnLastAnswer: boolean;
  rating: number | null;
};

/**
 * Confirmed: the visitor affirms (thanks, a completed booking, or a 4-5 star rating).
 * Who resolved it depends on whether a human replied.
 */
export function confirmedOutcome(facts: Pick<ConversationFacts, "humanReplied">): Outcome {
  return facts.humanReplied ? "resolved_after_handover" : "resolved_by_bot";
}

/**
 * Assumed: after 24 hours with no activity. Returns null while the conversation is still live.
 * "No human and no return" is what licenses assuming the bot resolved it.
 */
export function assumedOutcome(facts: ConversationFacts, now: Date): Outcome | null {
  if (now.getTime() - facts.lastActivityAt.getTime() < ASSUME_AFTER_MS) return null;
  if (facts.handedOver) return facts.humanReplied ? "resolved_after_handover" : "escalated_unresolved";
  if (facts.rating !== null && facts.rating <= 2) return "abandoned";
  if (facts.lastBotAct === "blocked") return "blocked_by_guardrail";
  if (facts.lastBotAct === "out_of_scope" && facts.answeredCount === 0) return "out_of_scope";
  if (facts.lastBotAct === "flow") return "abandoned";
  if (facts.answeredCount > 0 && !facts.negativeFeedbackOnLastAnswer && facts.lastBotAct !== "fallback") {
    return "resolved_by_bot";
  }
  return "abandoned";
}

/**
 * Reversed: the visitor came back within 7 days about the same topic, so the earlier
 * resolution did not hold. Only resolved outcomes can be reversed.
 */
export function reversedOutcome(previous: Outcome): Outcome | null {
  if (previous === "resolved_by_bot") return "abandoned";
  if (previous === "resolved_after_handover") return "escalated_unresolved";
  return null;
}

/** Topics are "page#section" for knowledge answers, "flow:<name>" or "handover:<reason>". */
export function isSameTopic(a: string | null, b: string | null): boolean {
  return Boolean(a && b && a === b);
}

export function withinReversalWindow(previousLastActivity: Date, returnedAt: Date): boolean {
  const gap = returnedAt.getTime() - previousLastActivity.getTime();
  return gap >= 0 && gap <= REVERSAL_WINDOW_MS;
}
