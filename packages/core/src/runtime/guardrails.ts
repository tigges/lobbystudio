import type { HandoverReason } from "./commands.ts";

type Rule = { reason: HandoverReason; pattern: RegExp };

const PRECHECK_RULES: Rule[] = [
  {
    reason: "emergency",
    pattern:
      /\b(emergenc(y|ies)|urgent(ly)?|a\s?&\s?e|999|can'?t (breathe|swallow|open my mouth)|knocked out|hit my (face|head|mouth)|accident|fell|fallen)\b/i,
  },
  {
    reason: "pain_or_symptoms",
    pattern:
      /\b(pain|painful|hurts?|hurting|sore|ache|aching|toothache|throbb\w*|swell\w*|swollen|bleed\w*|blood|abscess|infect\w*|pus|fever|lump|broken tooth|cracked|chipped|lost (a )?(filling|crown)|sensitiv\w*|numb)\b/i,
  },
  {
    reason: "clinical_advice",
    pattern:
      /\b(painkillers?|ibuprofen|paracetamol|antibiotics?|amoxicillin|medicines?|medication|prescri\w*|diagnos\w*|symptoms?|is (it|this|that) normal|should i (take|be worried|worry)|what (should|can) i (do|take|use) (about|for))\b/i,
  },
];

export type PrecheckResult = { hit: false } | { hit: true; reason: HandoverReason; matched: string };

/** Deterministic and runs before the planner: these always hand over, whatever the model would say. */
export function clinicalPrecheck(text: string): PrecheckResult {
  for (const rule of PRECHECK_RULES) {
    const m = rule.pattern.exec(text);
    if (m) return { hit: true, reason: rule.reason, matched: m[0] };
  }
  return { hit: false };
}

const AFFIRMATION =
  /^(?:(?:ok(?:ay)?|great|perfect|brilliant|lovely|amazing|super|cool|fab|excellent|that'?s? (?:great|perfect|brilliant|lovely|helpful|all|everything|fine)|that helps|got it|sorted|cheers|ta)[,!. ]*)*(?:thanks?(?: you)?(?: so much| very much| a lot)?|thank you|cheers|ta|perfect|great|brilliant|lovely|got it|that helps|sorted|that'?s (?:all|everything|great|perfect|helpful))[!. ]*$/i;

export function isAffirmation(text: string): boolean {
  const t = text.trim();
  return t.length <= 60 && !t.includes("?") && AFFIRMATION.test(t);
}

const GREETING = /^(?:hi|hiya|hello|hey|hey there|hi there|hello there|good (?:morning|afternoon|evening))[!., ]*$/i;

export function isGreeting(text: string): boolean {
  return GREETING.test(text.trim());
}

/** A booking request cannot fix a date or time; only the team can, by phone. */
export function asksForFixedTime(text: string): boolean {
  return /\b(?:confirm\w*|exact|specific|guarantee\w*|fixed)\b/i.test(text) && /\b(?:time|date|slot|appointment|when)\b/i.test(text);
}

const YES = /^(?:yes|yeah|yep|yup|sure|correct|that'?s right|please do|go ahead|ok(?:ay)?|y)\b[ ,.!]*(?:please|thanks?|thank you|send it)?[.! ]*$/i;
const NO = /^(?:no|nope|nah|not quite|wrong|that'?s wrong|change something|n)\b/i;

export function yesNo(text: string): "yes" | "no" | null {
  const t = text.trim();
  if (YES.test(t)) return "yes";
  if (NO.test(t)) return "no";
  return null;
}

/** Numbers that must be traceable to a cited chunk: prices, times, durations, phone numbers, counts. */
export function numericFacts(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/£\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:[.:]\d+)?/g)) {
    out.push(normaliseNumber(m[0]));
  }
  return out;
}

function normaliseNumber(raw: string): string {
  return raw.replace(/\s/g, "").replace(/,/g, "").replace(/\.00$/, "");
}

export type GroundingCheck =
  | { ok: true }
  | { ok: false; rule: "ungrounded_number" | "price_qualifier" | "clinical_output"; detail: string };

/**
 * Every number in a composed sentence must appear in the cited text, and a price the
 * page qualifies with "from" must keep that qualifier.
 */
export function checkGrounding(sentence: string, citedText: string): GroundingCheck {
  const available = new Set(numericFacts(citedText));
  for (const fact of numericFacts(sentence)) {
    const bare = fact.replace(/^£/, "");
    if (!available.has(fact) && !available.has(bare) && !available.has(`£${bare}`)) {
      return { ok: false, rule: "ungrounded_number", detail: fact };
    }
  }
  const citedNorm = citedText.replace(/,/g, "").toLowerCase();
  const sentenceNorm = sentence.replace(/,/g, "").toLowerCase();
  for (const m of sentenceNorm.matchAll(/£\s?(\d+(?:\.\d{1,2})?)/g)) {
    const amount = m[1]!;
    const qualified = new RegExp(`from\\s+£\\s?${amount.replace(".", "\\.")}\\b`).test(citedNorm);
    if (!qualified) continue;
    const before = sentenceNorm.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
    if (!/\b(from|starting at|starts at|at least)\b/.test(before)) {
      return { ok: false, rule: "price_qualifier", detail: `£${amount} is a "from" price` };
    }
  }
  return { ok: true };
}

const CLINICAL_OUTPUT =
  /\b(you should (take|use|rinse|apply|try)|take (some )?(ibuprofen|paracetamol|painkillers?|antibiotics?)|rinse with|salt water|apply (ice|a cold)|it (is|sounds|could be) (probably |likely )?(an? )?(infection|abscess|decay|normal|nothing))\b/i;

export function clinicalOutputCheck(sentence: string): GroundingCheck {
  const m = CLINICAL_OUTPUT.exec(sentence);
  return m ? { ok: false, rule: "clinical_output", detail: m[0] } : { ok: true };
}
