import { isStatement, namedDays } from "./salon-booking.ts";
import { type BookingDef, commonSlot, CONFIRM_OPTIONS, needsPartOfDay, type SlotResult, TIME_OF_DAY_OPTIONS, timeSummary } from "./booking.ts";

export { timeSummary, withDates } from "./booking.ts";

/** Dental booking: a call-back request the practice team confirms by phone. */
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

export const BOOKING_OPTIONS: Partial<Record<BookingSlot, string[]>> = {
  reason: ["Check-up", "Hygienist", "Consultation"],
  patient: ["New patient", "Existing patient"],
  care: ["NHS", "Private", "Not sure"],
  nhs_route: ["For a child", "Join the waiting list", "Book privately"],
  time_of_day: TIME_OF_DAY_OPTIONS,
  confirm: CONFIRM_OPTIONS,
};

/** Words that pass a letters-only pattern but are clearly an answer to a different question. */
const NOT_A_NAME =
  /\b(check-?ups?|appointments?|hygien\w*|clean(ing)?|fillings?|consult\w*|book\w*|routine|whitening|emergency|tooth|teeth|dentist|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|yes|no|hi|hello|thanks?)\b/i;

export function validateSlot(slot: string, value: string): SlotResult {
  const v = value.trim();
  switch (slot) {
    case "reason":
      return v.length >= 2 && v.length <= 80 ? { ok: true, value: v } : { ok: false, error: "reason length" };
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
    default:
      return commonSlot(slot, v, NOT_A_NAME);
  }
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

/** "Are you taking new NHS patients?" says as much about the visitor as "I'm a new patient". */
const NEW_PATIENT = /\b(?:new (?:nhs |private )?patients?|not (?:yet )?registered|never been (?:to you|before|here)|first (?:visit|appointment|time))\b/i;
const EXISTING_PATIENT = /\b(?:existing patient|already (?:a patient|registered)|i'?m registered|been (?:to you |here )?before|my (?:usual )?dentist (?:there|at))\b/i;

function dentalPrefill(texts: string[]): Record<string, string> {
  const slots: Record<string, string> = {};
  for (const text of texts) {
    const reason = DENTAL_BOOKING.firstValueFrom(text);
    if (reason) slots.reason = reason;
    if (NEW_PATIENT.test(text)) slots.patient = "new";
    else if (EXISTING_PATIENT.test(text)) slots.patient = "existing";
    if (/\bnhs (?:patients?|treatment|appointment|check-?up)\b/i.test(text) || (/\bnhs\b/i.test(text) && isStatement(text))) slots.care = "NHS";
    else if (/\b(?:private(?:ly)? (?:patients?|treatment|appointment)|go private|pay privately|harbour care plan)\b/i.test(text)) slots.care = "private";
    const days = namedDays(text);
    if (days) slots.preferred_time = days;
  }
  return slots;
}

export const DENTAL_BOOKING: BookingDef = {
  slots: BOOKING_SLOTS,
  titles: {
    reason: "What for",
    patient: "New or existing",
    care: "NHS or private",
    nhs_route: "NHS route",
    preferred_time: "When",
    time_of_day: "Time of day",
    name: "Name",
    phone: "Phone",
    confirm: "Confirm",
  },
  prompts: PROMPTS,
  options: BOOKING_OPTIONS,
  exactOnly: ["reason"],
  conditional: {
    nhs_route: (s) => s.patient === "new" && s.care === "NHS",
    time_of_day: needsPartOfDay,
  },
  dependents: { patient: ["nhs_route"], care: ["nhs_route"], preferred_time: ["time_of_day"] },
  validate: validateSlot,
  invalid: {
    patient: "Sorry, are you new to us or an existing patient?",
    care: "Sorry, would this be NHS or private treatment? If you're not sure, the team can explain.",
    phone: "That doesn't look like a UK phone number. Could you check it? For example 07700 900123.",
    name: "Sorry, I didn't catch your name. What should the team call you?",
    confirm: "Shall I send these details to the team? Please answer yes or no.",
  },
  contextQuery: { nhs_route: "Are you taking new NHS patients?" },
  summary: (slots) =>
    `Thanks. Here's what I have: ${slots.reason} for ${slots.name} (${patientLabel(slots)}, ${careSummary(slots)}), ` +
    `call back on ${slots.phone}, ` +
    `best time ${timeSummary(slots)}. Shall I send this to the team?`,
  done: (slots) =>
    `Done. The team will call you on ${slots.phone} to agree a time, usually the same working day. ` +
    `Is there anything else I can help with before your visit?`,
  changePrompt:
    "No problem. Which detail would you like to change: the appointment type, your name, phone number, new or existing patient, NHS or private, or preferred times?",
  timeNote: "I can't confirm a date or time in the chat. The team calls you back to agree one, usually the same working day.",
  ready: "Your request is ready. Shall I send it to the team?",
  continue: "Let's carry on with your booking.",
  columns: [
    { title: "Reason", value: (s) => s.reason ?? null },
    { title: "Patient", value: (s) => s.patient ?? null },
    { title: "NHS / private", value: (s) => (s.care ? careSummary(s) : null) },
    { title: "Preferred time", value: (s) => (s.preferred_time ? timeSummary(s) : null) },
  ],
  plannerNotes: [
    `- booking_request: collects slots ${BOOKING_SLOTS.join(", ")} in that order. patient is "new" or "existing"; care is "NHS", "private" or "not sure"; confirm is "yes" or "no".`,
    `  nhs_route ("child", "waiting list" or "private") is only asked of a new NHS patient; time_of_day ("morning", "afternoon", "evening" or "any time") only when preferred_time names no part of the day.`,
  ].join("\n"),
  changeSlot: (text) =>
    /phone|number/i.test(text)
      ? "phone"
      : /name/i.test(text)
        ? "name"
        : /nhs|private/i.test(text)
          ? "care"
          : /new|existing/i.test(text)
            ? "patient"
            : /time|day/i.test(text)
              ? "preferred_time"
              : "reason",
  prefill: dentalPrefill,
  startedWith: (slots) => (slots.reason ? `Of course, ${/^[aeiou]/i.test(slots.reason) ? "an" : "a"} ${slots.reason.toLowerCase()}.` : ""),
  firstValueFrom(text) {
    if (/hygien/i.test(text)) return "Hygienist appointment";
    if (/whiten/i.test(text)) return "Whitening consultation";
    if (/implant/i.test(text)) return "Implant consultation";
    if (/aligner|invisalign|straighten/i.test(text)) return "Clear aligner consultation";
    if (/check[- ]?up|exam/i.test(text)) return "Check-up";
    return null;
  },
};
