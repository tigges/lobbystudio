import type { HandoverReason } from "./commands.ts";

export type Practice = { name: string; phone: string };

export function greeting(p: Practice): string {
  return (
    `Hi, I can answer questions using the ${p.name} website: opening hours, prices, NHS and private care, ` +
    `emergencies and booking. If you're in pain or worried about a symptom, I'll pass you straight to the team.`
  );
}

export function dontKnow(p: Practice): string {
  return `I'm not sure about that from our website, and I'd rather not guess. The team can help on ${p.phone}.`;
}

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

export const HANDOVER_CALLBACK_OFFER = "If you'd like a call back, leave your phone number here.";

export function cannotHandle(p: Practice, reason: "out_of_scope" | "unsupported_request" | "abusive"): string {
  if (reason === "abusive") return "I can't help with that.";
  if (reason === "unsupported_request") return `I can't do that in the chat. The team can help on ${p.phone}.`;
  return `I can only help with questions about ${p.name}, such as opening hours, prices, NHS and private care, emergencies or booking.`;
}

export const CLARIFY_LEAD = "Just to check, which of these do you mean?";

export const ACKNOWLEDGE = "You're welcome. Is there anything else I can help with?";

export const WAITING_FOR_TEAM = "The practice team has your message and will reply here.";
