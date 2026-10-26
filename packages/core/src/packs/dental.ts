import { DENTAL_BOOKING } from "../runtime/flows/booking-request.ts";
import { CLINICAL_OUTPUT, DENTAL_PRECHECK } from "../runtime/guardrails.ts";
import * as T from "../runtime/templates.ts";
import { COMMON_SYNONYMS } from "./synonyms.ts";
import type { Pack } from "./types.ts";

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
  greetOptions: T.GREET_OPTIONS,
  steerBackOptions: T.STEER_BACK_OPTIONS,
  price: { lead: T.PRICE_LEAD, options: T.PRICE_OPTIONS, query: "treatments and prices" },
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
  booking: DENTAL_BOOKING,
  online: null,
  synonyms: [
    ...COMMON_SYNONYMS,
    { words: /\b(?:scale and polish|clean(?:ing)?|descale|tartar|plaque)\b/i, search: "Check-ups and hygiene" },
    { words: /\b(?:braces|straighten\w*|crooked)\b/i, search: "Cosmetic treatments" },
  ],
  handoverSources: { slug: "emergencies", urgent: /^(call-999|urgent-dental-problems|when-we-are-closed)/, clinical: /^what-we-cannot-do/ },
};
