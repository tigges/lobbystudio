import type { FlowState } from "@dental-bot/db/schema";
import { isPhoneLike, tokenKind } from "../../pii/detect.ts";

export const BOOKING_SLOTS = ["reason", "name", "phone", "preferred_time", "confirm"] as const;
export type BookingSlot = (typeof BOOKING_SLOTS)[number];

const PROMPTS: Record<Exclude<BookingSlot, "confirm">, string> = {
  reason: "What would you like to book? For example a check-up, a hygienist appointment or a consultation.",
  name: "What's your name?",
  phone: "What's the best phone number for the team to call you back on?",
  preferred_time: "Which days or times usually suit you?",
};

export type SlotResult = { ok: true; value: string } | { ok: false; error: string };

export function validateSlot(slot: string, value: string): SlotResult {
  const v = value.trim();
  switch (slot) {
    case "reason":
      return v.length >= 2 && v.length <= 80 ? { ok: true, value: v } : { ok: false, error: "reason length" };
    case "name": {
      if (tokenKind(v) === "NAME") return { ok: true, value: v };
      if (/^[\p{L}][\p{L}' .-]{0,58}$/u.test(v) && v.split(/\s+/).length <= 4) return { ok: true, value: v };
      return { ok: false, error: "not a name" };
    }
    case "phone":
      if (tokenKind(v) === "PHONE" || isPhoneLike(v)) return { ok: true, value: v };
      return { ok: false, error: "not a UK phone number" };
    case "preferred_time":
      return v.length >= 2 && v.length <= 120 ? { ok: true, value: v } : { ok: false, error: "time length" };
    case "confirm": {
      const norm = v.toLowerCase();
      if (["yes", "no"].includes(norm)) return { ok: true, value: norm };
      return { ok: false, error: "confirm must be yes or no" };
    }
    default:
      return { ok: false, error: `unknown slot ${slot}` };
  }
}

export function startBooking(): FlowState {
  return { name: "booking_request", step: "reason", slots: {} };
}

/** The first slot still missing, in catalogue order. */
export function nextBookingStep(flow: FlowState): BookingSlot | "done" {
  for (const slot of BOOKING_SLOTS) {
    if (!flow.slots[slot]) return slot;
  }
  return "done";
}

export function applyBookingSlot(flow: FlowState, slot: string, value: string): FlowState {
  const slots = { ...flow.slots, [slot]: value };
  if (slot !== "confirm") delete slots.confirm;
  return { ...flow, slots };
}

export function bookingPrompt(step: BookingSlot, slots: Record<string, string>): string {
  if (step === "confirm") {
    return (
      `Thanks. Here's what I have: ${slots.reason} for ${slots.name}, call back on ${slots.phone}, ` +
      `usually free ${slots.preferred_time}. Shall I send this to the team?`
    );
  }
  return PROMPTS[step];
}

export const BOOKING_INVALID: Record<string, string> = {
  phone: "That doesn't look like a UK phone number. Could you check it? For example 07700 900123.",
  name: "Sorry, I didn't catch your name. What should the team call you?",
  confirm: "Shall I send these details to the team? Please answer yes or no.",
};

export const BOOKING_CHANGE_PROMPT =
  "No problem. Which detail would you like to change: the appointment type, your name, phone number or preferred times?";

export function bookingDone(slots: Record<string, string>): string {
  return `Done. The team will call you on ${slots.phone} to confirm a time, usually the same working day.`;
}
