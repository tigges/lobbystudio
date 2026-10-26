import { DENTAL_BOOKING } from "../runtime/flows/booking-request.ts";
import { CLINICAL_OUTPUT, DENTAL_PRECHECK } from "../runtime/guardrails.ts";
import * as T from "../runtime/templates.ts";
import { COMMON_SYNONYMS } from "./synonyms.ts";
import type { Pack } from "./types.ts";

/** Offers that carry on from the answer; accepting one starts the booking with what it names. */
function dentalFollowUp({ headings, slots }: { headings: string[]; slots: Record<string, string> }): string | null {
  const on = (h: string) => headings.includes(h);
  const reason = slots.reason?.toLowerCase();
  if (on("Are you taking new NHS patients?") || on("Do I need to be registered with you?") || on("Your first visit")) {
    return "Would you like me to ask the team to call you about joining as a new patient?";
  }
  if (on("Check-ups and hygiene")) {
    return `Would you like me to ask the team to call you to book ${reason ? `${/^[aeiou]/.test(reason) ? "an" : "a"} ${reason}` : "an appointment"}?`;
  }
  if (on("Do you see children?")) return "Would you like me to ask the team to call you to book a check-up for your child?";
  if (on("Cosmetic treatments") || on("Implants")) {
    return `Would you like me to ask the team to call you about ${reason ? `${/^[aeiou]/.test(reason) ? "an" : "a"} ${reason}` : "a consultation"}?`;
  }
  return null;
}

export const DENTAL_PACK: Pack = {
  vertical: "dental",
  kind: "a dental practice",
  place: "practice",
  labels: { assistant: "Practice assistant", talk: "Talk to the practice", footer: "Demo practice · not medical advice" },
  greeting: T.greeting,
  cannotHandle: T.cannotHandle,
  technicalProblem: T.technicalProblem,
  waitingForTeam: T.waitingForTeam,
  handoverMessage: T.handoverMessage,
  released: "The practice team has handed you back to the assistant.",
  price: { lead: T.PRICE_LEAD, page: "treatments" },
  menu: {
    start: [
      { label: "Services", sections: { page: "treatments", mode: "overview" } },
      { label: "Opening hours", heading: "Opening hours", ask: "What are your opening hours?" },
      { label: "Find us", heading: "Getting here", ask: "How do I get to you?" },
    ],
    pages: { treatments: "overview" },
    quiet: ["book", "emergencies"],
    skip: /^(?:NHS charges|Paying|How to contact us)\b/i,
  },
  careGate: {
    question: "Are you an NHS or private patient?",
    options: ["NHS", "Private", "Not sure"],
    nhsHeading: "NHS charges",
    explainHeading: "What is the difference between NHS and private treatment?",
  },
  precheck: DENTAL_PRECHECK,
  unsafeOutput: CLINICAL_OUTPUT,
  urgentDetails: T.URGENT_DETAILS,
  redFlags: /\b(?:breath\w*|swallow\w*|eyes?|won'?t stop|can'?t stop)\b/i,
  redFlagReminder: T.RED_FLAG_REMINDER,
  billingDetails: T.BILLING_DETAILS,
  visitIntent:
    /\b(?:new (?:\w+ )?patients?|regist\w*|join|taking on|accepting|how much|cost\w*|price\w*|fees?|park\w*|step-?free|wheelchair|access\w*|get there|find you|directions|first visit)\b/i,
  bookingOffer: T.BOOKING_OFFER,
  acknowledgeWithOffer: T.ACKNOWLEDGE_WITH_OFFER,
  followUp: dentalFollowUp,
  booking: DENTAL_BOOKING,
  online: null,
  synonyms: [
    ...COMMON_SYNONYMS,
    { words: /\b(?:scale and polish|clean(?:ing)?|descale|tartar|plaque)\b/i, search: "Check-ups and hygiene" },
    { words: /\b(?:braces|straighten\w*|crooked)\b/i, search: "Cosmetic treatments" },
  ],
  handoverSources: { slug: "emergencies", urgent: /^(call-999|urgent-dental-problems|when-we-are-closed)/, clinical: /^what-we-cannot-do/ },
};
