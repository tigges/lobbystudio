import type { HandoverReason } from "./commands.ts";

export type Practice = { name: string; phone: string };

export function greeting(p: Practice): string {
  return (
    `Hi, I'm the ${p.name} assistant. I can help with opening hours, prices, NHS and private care, ` +
    `emergencies and booking. If you're in pain or worried about a symptom, I'll pass you straight to the team.`
  );
}

export function dontKnow(p: Practice): string {
  return `I'm afraid I can't answer that one, and I'd rather not guess. Shall I pass your question to the team? Or call us on ${p.phone}.`;
}

/** Chips under the don't-know reply, so it isn't a dead end. */
export const ASK_TEAM_OPTIONS = ["Yes, ask the team", "No thanks"];

export function technicalProblem(p: Practice): string {
  return `Sorry, I'm having a technical problem. Please call the practice on ${p.phone}.`;
}

const URGENT: HandoverReason[] = ["emergency", "pain_or_symptoms"];

export function isUrgentReason(reason: HandoverReason): boolean {
  return URGENT.includes(reason);
}

export function handoverMessage(p: Practice, reason: HandoverReason): string {
  if (isUrgentReason(reason)) {
    return (
      `I'm sorry you're dealing with this. I can't give clinical advice, so I've passed your message to the practice team. ` +
      `If swelling is affecting your breathing, swallowing or eye, or bleeding won't stop after 15 minutes of pressure, call 999 or go to A&E. ` +
      `Otherwise please call us on ${p.phone}; we keep emergency appointments free every weekday and on Saturday mornings. ` +
      `When we're closed, call NHS 111.`
    );
  }
  if (reason === "clinical_advice") {
    return (
      `I can't give clinical advice in the chat, so I've passed your question to the practice team. ` +
      `They'll reply here during opening hours, or you can call us on ${p.phone}.`
    );
  }
  return `I've passed this to the practice team. Someone will reply here during opening hours, or you can call us on ${p.phone}.`;
}


export function cannotHandle(p: Practice, reason: "out_of_scope" | "unsupported_request" | "abusive"): string {
  if (reason === "abusive") return "I can't help with that.";
  if (reason === "unsupported_request") return `I can't do that in the chat. The team can help on ${p.phone}.`;
  return `I can't help with that one, I'm afraid. I'm here for anything about visiting ${p.name}: opening hours, prices, NHS and private care, or booking an appointment.`;
}

export const CLARIFY_LEAD = "Just to check, which of these do you mean?";

export const GREET_BACK = "Hello! What would you like to know?";

export const GREET_OPTIONS = ["What are your opening hours?", "How much is a check-up?", "Do you see NHS patients?"];

export function nearMiss(heading: string): string {
  return `Just to check, do you mean “${heading}”${heading.endsWith("?") ? "" : "?"}`;
}

export function nearMissHeading(text: string): string | null {
  return /^Just to check, do you mean “(.+)”\??$/.exec(text)?.[1] ?? null;
}

export const SOMETHING_ELSE = "Something else";

export const TOPIC_LEAD = "That covers a few things. Which would you like to know about?";

export const ACKNOWLEDGE = "You're welcome. Is there anything else I can help with?";

/** After an out-of-scope message, steer back to what the visitor most likely came for. */
export const STEER_BACK_OPTIONS = ["Book an appointment", "What are your opening hours?", "How much is a check-up?"];

export const BILLING_DETAILS =
  "Of course. What's it about? If you have an invoice number, add it so the team can look it up before they reply.";

export const URGENT_DETAILS =
  "So the team can prioritise you: how bad is the pain right now, from 1 to 10, and is there any swelling or bleeding?";

export const RED_FLAG_REMINDER = "If it's affecting your breathing, swallowing or eye, please call 999 or go to A&E now.";

export const PRICE_LEAD = "Prices depend on the treatment. Which would you like to know about?";

export const PRICE_OPTIONS = ["How much is a check-up?", "How much is the hygienist?", "How much is teeth whitening?", "What are the NHS charges?"];

/** Offered at most once per conversation, and never after a handover or a booking. */
export const BOOKING_OFFER = "If you're thinking of coming in, I can pass a booking request to the team and they'll call you to find a time.";

export const ACKNOWLEDGE_WITH_OFFER = "You're welcome. If you'd like to come in, I can ask the team to call you to arrange a visit.";

export const BOOK_OPTION = "Book an appointment";

export const OFFER_OPTIONS = [BOOK_OPTION, "Not right now"];

export const OFFER_DECLINED = "No problem. Just ask if anything else comes up.";

export function waitingForTeam(p: Practice): string {
  return `The practice team has your message and will reply here. If it's urgent, please call us on ${p.phone}.`;
}
