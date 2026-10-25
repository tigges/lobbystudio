import type { FlowState } from "@dental-bot/db/schema";
import { isPhoneLike, tokenKind } from "../../pii/detect.ts";

export const BOOKING_SLOTS = ["reason", "patient", "care", "nhs_route", "preferred_time", "time_of_day", "name", "phone", "confirm"] as const;
export type BookingSlot = (typeof BOOKING_SLOTS)[number];

const PROMPTS: Record<Exclude<BookingSlot, "confirm">, string> = {
  reason: "Happy to help. What would you like to book? Pick one below or tell me in your own words.",
  name: "Thanks. And what name should the team ask for?",
  phone: "What's the best phone number for the team to call you back on?",
  patient: "Are you new to the practice, or an existing patient?",
  care: "Would this be NHS or private treatment?",
  nhs_route: "Is the appointment for a child under 18, or would you like to join the adult waiting list or book privately instead?",
  preferred_time: "Which days or times usually suit you?",
  time_of_day: "And is morning, afternoon or evening best?",
};

/** Asked only when they apply: the NHS route for a new NHS patient, the part of day when only a day was given. */
const CONDITIONAL: Partial<Record<BookingSlot, (slots: Record<string, string>) => boolean>> = {
  nhs_route: (s) => s.patient === "new" && s.care === "NHS",
  time_of_day: (s) => Boolean(s.preferred_time) && !PART_OF_DAY.test(s.preferred_time!.replace(/\s*\([^)]*\)/g, "")),
};

const PART_OF_DAY =
  /\b(?:mornings?|afternoons?|evenings?|lunch\w*|am|pm|\d{1,2}(?::\d{2})?\s*(?:am|pm)?|any ?time|whenever|flexible|after work|before work|after school)\b/i;

/** Steps with a short, fixed set of likely answers get quick replies; the chips are sent back as the visitor's text. */
export const BOOKING_OPTIONS: Partial<Record<BookingSlot, string[]>> = {
  reason: ["Check-up", "Hygienist", "Consultation"],
  patient: ["New patient", "Existing patient"],
  care: ["NHS", "Private", "Not sure"],
  nhs_route: ["For a child", "Join the waiting list", "Book privately"],
  time_of_day: ["Morning", "Afternoon", "Evening", "Any time"],
  confirm: ["Yes, send it", "Change something"],
};

/** Free-text steps whose chips are only shortcuts: typed answers still go through the planner. */
const EXACT_ONLY: readonly BookingSlot[] = ["reason"];

/** The slot value when the visitor's text can be filled without the planner, else null. */
export function quickReplyValue(step: BookingSlot, text: string): string | null {
  const options = BOOKING_OPTIONS[step];
  if (!options || step === "confirm" || text.includes("?")) return null;
  const tapped = options.find((o) => o.toLowerCase() === text.trim().toLowerCase());
  if (EXACT_ONLY.includes(step)) return tapped ?? null;
  return validateSlot(step, text).ok ? text : null;
}

export function bookingOptions(step: BookingSlot | "done" | "change"): string[] {
  return step === "done" || step === "change" ? [] : (BOOKING_OPTIONS[step] ?? []);
}

export type SlotResult = { ok: true; value: string } | { ok: false; error: string };

/** Words that pass a letters-only pattern but are clearly an answer to a different question. */
const NOT_A_NAME =
  /\b(check-?ups?|appointments?|hygien\w*|clean(ing)?|fillings?|consult\w*|book\w*|routine|whitening|emergency|tooth|teeth|dentist|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|yes|no|hi|hello|thanks?)\b/i;

export function validateSlot(slot: string, value: string): SlotResult {
  const v = value.trim();
  switch (slot) {
    case "reason":
      return v.length >= 2 && v.length <= 80 ? { ok: true, value: v } : { ok: false, error: "reason length" };
    case "name": {
      if (tokenKind(v) === "NAME") return { ok: true, value: v };
      if (/^[\p{L}][\p{L}' .-]{0,58}$/u.test(v) && v.split(/\s+/).length <= 4 && !NOT_A_NAME.test(v))
        return { ok: true, value: v };
      return { ok: false, error: "not a name" };
    }
    case "phone":
      if (tokenKind(v) === "PHONE" || isPhoneLike(v)) return { ok: true, value: v };
      return { ok: false, error: "not a UK phone number" };
    case "patient":
      if (/\b(new|never been|first time|not (?:yet )?registered)\b/i.test(v)) return { ok: true, value: "new" };
      if (/\b(existing|already|registered|been before|current)\b/i.test(v)) return { ok: true, value: "existing" };
      return { ok: false, error: "new or existing" };
    case "care":
      if (/\bnhs\b/i.test(v)) return { ok: true, value: "NHS" };
      if (/\b(private|plan|harbour care|insurance|insured)\b/i.test(v)) return { ok: true, value: "private" };
      if (/\b(not sure|unsure|don'?t know|either|no idea)\b/i.test(v)) return { ok: true, value: "not sure" };
      return { ok: false, error: "NHS, private or not sure" };
    case "nhs_route":
      if (/\b(child|kid|son|daughter|under 18|teen\w*|boy|girl)\b/i.test(v)) return { ok: true, value: "child" };
      if (/\bwait\w*/i.test(v)) return { ok: true, value: "waiting list" };
      if (/\bprivate\w*/i.test(v)) return { ok: true, value: "private" };
      return { ok: false, error: "child, waiting list or private" };
    case "time_of_day":
      if (/\bmorning/i.test(v)) return { ok: true, value: "morning" };
      if (/\bafternoon/i.test(v)) return { ok: true, value: "afternoon" };
      if (/\bevening/i.test(v)) return { ok: true, value: "evening" };
      if (/\b(any|whenever|flexible|don'?t mind|either)\b/i.test(v)) return { ok: true, value: "any time" };
      return { ok: false, error: "morning, afternoon, evening or any time" };
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
    if (flow.slots[slot]) continue;
    const applies = CONDITIONAL[slot];
    if (applies && !applies(flow.slots)) continue;
    return slot;
  }
  return "done";
}

export function applyBookingSlot(flow: FlowState, slot: string, value: string): FlowState {
  const slots = { ...flow.slots, [slot]: value };
  if (slot !== "confirm") delete slots.confirm;
  if (slot === "patient" || slot === "care") delete slots.nhs_route;
  if (slot === "preferred_time") delete slots.time_of_day;
  return { ...flow, slots };
}

export function bookingPrompt(step: BookingSlot, slots: Record<string, string>): string {
  if (step === "confirm") {
    return (
      `Thanks. Here's what I have: ${slots.reason} for ${slots.name} (${patientLabel(slots)}, ${careSummary(slots)}), ` +
      `call back on ${slots.phone}, ` +
      `best time ${timeSummary(slots)}. Shall I send this to the team?`
    );
  }
  return PROMPTS[step];
}

function patientLabel(slots: Record<string, string>) {
  return slots.patient === "new" ? "new patient" : "existing patient";
}

export function careSummary(slots: Record<string, string>) {
  if (slots.care === "NHS" && slots.nhs_route === "child") return "NHS, for a child";
  if (slots.care === "NHS" && slots.nhs_route === "waiting list") return "NHS waiting list";
  if (slots.care === "NHS" && slots.nhs_route === "private") return "private";
  return slots.care === "not sure" ? "NHS or private to be decided" : slots.care === "NHS" ? "NHS" : "private";
}

export function timeSummary(slots: Record<string, string>) {
  const part = slots.time_of_day && slots.time_of_day !== "any time" ? `, ${slots.time_of_day}` : "";
  return `${slots.preferred_time ?? ""}${part}`;
}

/** "tomorrow" means nothing to the team reading it later, so relative days get the date alongside. */
export function withDates(value: string, now: Date, timeZone: string): string {
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(d);
  return value
    .replace(/\btoday\b/i, (m) => `${m} (${fmt(now)})`)
    .replace(/\btomorrow\b/i, (m) => `${m} (${fmt(new Date(now.getTime() + 24 * 60 * 60 * 1000))})`);
}

export const BOOKING_INVALID: Record<string, string> = {
  patient: "Sorry, are you new to us or an existing patient?",
  care: "Sorry, would this be NHS or private treatment? If you're not sure, the team can explain.",
  phone: "That doesn't look like a UK phone number. Could you check it? For example 07700 900123.",
  name: "Sorry, I didn't catch your name. What should the team call you?",
  confirm: "Shall I send these details to the team? Please answer yes or no.",
};

export const BOOKING_READY = "Your request is ready. Shall I send it to the team?";

export const BOOKING_CONTINUE = "Let's carry on with your booking.";

export const BOOKING_CHANGE_PROMPT =
  "No problem. Which detail would you like to change: the appointment type, your name, phone number, new or existing patient, NHS or private, or preferred times?";

export const BOOKING_TIME_NOTE =
  "I can't confirm a date or time in the chat. The team calls you back to agree one, usually the same working day.";

export function bookingDone(slots: Record<string, string>): string {
  return (
    `Done. The team will call you on ${slots.phone} to agree a time, usually the same working day. ` +
    `Is there anything else I can help with before your visit?`
  );
}
