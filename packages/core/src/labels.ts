/** Admin labels for one turn. Each points at the layer where a fix would most likely go. */
export const TURN_LABELS = [
  { key: "good", title: "Good", goal: "good", layer: null, hint: "Right answer, natural, nothing to change." },
  { key: "wrong_answer", title: "Wrong or outdated answer", goal: "correctness", layer: "content", hint: "Facts are wrong, outdated or incomplete." },
  { key: "missing_knowledge", title: "Missing knowledge", goal: "correctness", layer: "content", hint: "The website doesn't cover this yet." },
  { key: "wrong_question", title: "Answered a different question", goal: "correctness", layer: "runtime", hint: "Picked the wrong section or misread the question." },
  { key: "unnatural", title: "Unnatural", goal: "flow", layer: "behaviour", hint: "Robotic, too long, or repeats itself." },
  { key: "missed_next_step", title: "Missed next step", goal: "flow", layer: "behaviour", hint: "Should have offered or asked something next." },
  { key: "quick_replies", title: "Wrong or missing quick replies", goal: "flow", layer: "behaviour", hint: "Pills missing, wrong, or shouldn't be there." },
  { key: "unnecessary_handover", title: "Unnecessary handover", goal: "workload", layer: "behaviour", hint: "The assistant could have handled this itself." },
  { key: "should_hand_over", title: "Should have handed over", goal: "workload", layer: "behaviour", hint: "Safety: the team should have taken this." },
  { key: "could_automate", title: "Needed the team, could be automated", goal: "workload", layer: "capability", hint: "A missing capability, such as a calendar." },
] as const;

export type TurnLabelKey = (typeof TURN_LABELS)[number]["key"];

export const LABEL_GOALS = [
  { key: "good", title: "Good" },
  { key: "correctness", title: "Correctness" },
  { key: "flow", title: "Natural flow" },
  { key: "workload", title: "Workload and resolution" },
] as const;

export function isTurnLabel(key: string): key is TurnLabelKey {
  return TURN_LABELS.some((l) => l.key === key);
}

export function labelTitle(key: string): string {
  return TURN_LABELS.find((l) => l.key === key)?.title ?? key;
}

/**
 * Where a conversation stands in the learning loop: not looked at yet, has problems waiting for a fix,
 * every problem addressed by a release, or looked at with nothing to fix.
 */
export const REVIEW_STATES = [
  { key: "to_review", title: "To review" },
  { key: "open", title: "Labelled, waiting for a fix" },
  { key: "actioned", title: "Fixed in a release" },
  { key: "reviewed", title: "Reviewed, nothing to fix" },
] as const;

export type ReviewState = (typeof REVIEW_STATES)[number]["key"];

export function reviewState(c: { reviewedAt: Date | string | null; labels: string[]; openLabels: number; actionedLabels: number }): ReviewState {
  if (c.openLabels > 0) return "open";
  if (c.actionedLabels > 0) return "actioned";
  if (c.reviewedAt || c.labels.length > 0) return "reviewed";
  return "to_review";
}
