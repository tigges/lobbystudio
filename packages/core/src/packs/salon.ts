import { bookingWhat, COLOUR_SERVICE, PATCH_NOTE, SALON_BOOKING, serviceWithStylist, stylistPhrase } from "../runtime/flows/salon-booking.ts";
import { CLINICAL_OUTPUT, type PrecheckRule } from "../runtime/guardrails.ts";
import type { Practice } from "../runtime/templates.ts";
import type { Pack } from "./types.ts";

/** Offers that carry on from the answer: the topic decides the wording, the visitor's own details fill it in. */
function salonFollowUp({ headings, slots }: { headings: string[]; slots: Record<string, string> }): string | null {
  const on = (h: string) => headings.includes(h);
  const colour = slots.service && COLOUR_SERVICE.test(slots.service) ? slots : { ...slots, service: "colour" };
  if (on("Patch tests before colour")) {
    return `A patch test takes five minutes and you can walk in for one. Would you like me to book ${serviceWithStylist(colour, "your")} for at least 48 hours after?`;
  }
  if (on("Midweek colour days")) {
    return `Would you like me to look for a Tuesday or Wednesday time for ${serviceWithStylist(colour, "your")}?`;
  }
  if (on("Do you take walk-ins?")) {
    return "Would you like me to book you a time instead, so you're sure of a stylist?";
  }
  const what = serviceWithStylist(slots);
  if (!what && !slots.preferred_time) return null;
  return `Would you like me to find you a time${slots.preferred_time ? ` on ${slots.preferred_time}` : ""}${what ? ` for ${what}` : ""}?`;
}

/** Allergic reactions and sore or burnt scalps after a treatment always go to the team, whatever the model would say. */
const SALON_PRECHECK: PrecheckRule[] = [
  {
    reason: "emergency",
    pattern:
      /\b(emergenc(y|ies)|999|a\s?&\s?e|anaphyla\w*|can'?t (breathe|swallow)|(hard|difficult|struggling) to (breathe|swallow)|(face|lips?|tongue|throat|eyes?) (is |are )?(swell\w*|swollen|puff\w*))\b/i,
  },
  {
    reason: "pain_or_symptoms",
    pattern:
      /\b(reactions?|react(ed|ing)|allergic|rash|hives|itch(y|ing)?|burn(s|t|ing|ed)?(?! (?:orange|copper|sienna|umber|red))|blister\w*|swell\w*|swollen|sore scalp|scalp (is |feels )?(sore|red|tender|raw|burning|itchy|bleeding)|bleed\w*|weeping|oozing|hair (is )?(falling|coming) out|clumps)\b/i,
  },
  {
    reason: "clinical_advice",
    pattern:
      /\b(pregnan\w*|breastfeed\w*|medications?|medicines?|antihistamines?|steroid|psoriasis|eczema|dermatitis|alopecia|hair loss|scalp condition|is (it|this|that) (safe|normal)|should i (take|be worried|worry|see a doctor))\b/i,
  },
];

const SALON_UNSAFE = new RegExp(
  `${CLINICAL_OUTPUT.source}|\\b(take an antihistamine|hydrocortisone|steroid cream|it (is|sounds|looks) (probably |likely )?(fine|normal|nothing to worry about))\\b`,
  "i",
);

const URGENT = ["emergency", "pain_or_symptoms"];

export const SALON_PACK: Pack = {
  vertical: "salon",
  kind: "a hair salon",
  place: "salon",
  labels: { assistant: "Salon assistant", talk: "Talk to the salon", footer: "Demo salon · fictional business" },
  greeting: (b) =>
    `Hi, I'm the ${b.name} assistant. I can help with prices, patch tests, opening hours and booking. ` +
    `If you've had a reaction to a treatment, I'll pass you straight to the team.`,
  cannotHandle(b, reason) {
    if (reason === "abusive") return "I can't help with that.";
    if (reason === "unsupported_request") return `I can't do that in the chat. The team can help on ${b.phone}.`;
    return `I can't help with that one, I'm afraid. I'm here for anything about visiting ${b.name}: prices, patch tests, opening hours or booking an appointment.`;
  },
  technicalProblem: (b: Practice) => `Sorry, I'm having a technical problem. Please call the salon on ${b.phone}.`,
  waitingForTeam: (b) => `The salon team has your message and will reply here. If it's urgent, please call us on ${b.phone}.`,
  handoverMessage(b, reason) {
    if (URGENT.includes(reason)) {
      return (
        `I'm sorry, that sounds uncomfortable. I can't give medical advice, so I've passed your message to the salon team. ` +
        `If your face, lips, tongue or throat are swelling, or you're finding it hard to breathe, call 999 now. ` +
        `Otherwise please call us on ${b.phone}, and contact NHS 111 or a pharmacist for medical advice.`
      );
    }
    if (reason === "clinical_advice") {
      return (
        `I can't give medical advice in the chat, so I've passed your question to the salon team. ` +
        `They'll reply here during opening hours, or you can call us on ${b.phone}.`
      );
    }
    return `I've passed this to the salon team. Someone will reply here during opening hours, or you can call us on ${b.phone}.`;
  },
  released: "The salon team has handed you back to the assistant.",
  greetOptions: ["How much is a cut and blow-dry?", "Do I need a patch test?", "When are you open?"],
  steerBackOptions: ["Book an appointment", "When are you open?", "How much is a cut and blow-dry?"],
  price: {
    lead: "Prices depend on the service and the stylist. Which would you like to know about?",
    options: ["How much is a cut and blow-dry?", "How much is a full head colour?", "How much is balayage?", "How much is a smoothing treatment?"],
    query: "services and prices",
  },
  precheck: SALON_PRECHECK,
  unsafeOutput: SALON_UNSAFE,
  urgentDetails:
    "So the team can help quickly: which treatment did you have and when, and what are you noticing, for example itching, redness or swelling?",
  redFlags: /\b(?:breath\w*|swallow\w*|throat|tongue|lips?|face)\b/i,
  redFlagReminder: "If your face, lips, tongue or throat are swelling or you're finding it hard to breathe, please call 999 now.",
  billingDetails: "Of course. What's it about? If you have the date of your visit or a receipt, add it so the team can look it up before they reply.",
  visitIntent:
    /\b(?:new clients?|first (?:visit|time)|how much|cost\w*|price\w*|fees?|park\w*|step-?free|wheelchair|access\w*|get there|find you|directions|patch tests?|free (?:today|tomorrow|on))\b/i,
  bookingOffer: "If you'd like to come in, I can help you book an appointment.",
  acknowledgeWithOffer: "You're welcome. If you'd like to come in, I can help you book.",
  followUp: salonFollowUp,
  booking: SALON_BOOKING,
  online: {
    slotPrompt: (slots) =>
      `Here are the next free times ${stylistPhrase(slots.stylist)}` +
      `${slots.patch_test === "needed" ? ", from 48 hours ahead to leave time for your patch test" : ""}. Which suits you?`,
    noTimes: "I couldn't find a free time that matches online, so I'll pass your request to the team and they'll call you to find one.",
    slotInvalid: "Sorry, which of these times would you like? Or choose \"None of these suit me\" and the team will call you.",
    booked: (slots, b) =>
      `You're booked in: ${bookingWhat(slots)}.` +
      `${slots.patch_test === "needed" ? ` ${PATCH_NOTE}` : ""} To change it, call us on ${b.phone}. ` +
      `Is there anything else I can help with before your visit?`,
    failed: (slots) =>
      `Sorry, I couldn't book that time just now, so I've sent your request to the team instead. ` +
      `They'll call you on ${slots.phone} to book you in. Is there anything else I can help with before your visit?`,
  },
  handoverSources: { slug: "patch-tests", urgent: /^(if-you-have-a-reaction|call-999)/, clinical: /^what-we-can/ },
};
