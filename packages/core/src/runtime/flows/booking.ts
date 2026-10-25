import type { FlowState } from "@dental-bot/db/schema";
import { isPhoneLike, tokenKind } from "../../pii/detect.ts";

export type SlotResult = { ok: true; value: string } | { ok: false; error: string };

/** What the booking flow knows about the business: whether it can book straight into a booking system. */
export type BookingContext = { online: boolean };

/** The step that offers real times from the business's booking system. Only asked when bookings go online. */
export const SLOT_STEP = "slot";

/** A business pack's booking steps. The executor runs any definition the same way. */
export type BookingDef = {
  /** Steps in the order they're asked. "confirm" is always last. */
  slots: readonly string[];
  /** Short step names for the console and the flow map. */
  titles: Record<string, string>;
  prompts: Record<string, string>;
  /** Steps with a short, fixed set of likely answers get quick replies; the chips are sent back as the visitor's text. */
  options: Record<string, string[]>;
  /** Free-text steps whose chips are only shortcuts: typed answers still go through the planner. */
  exactOnly: readonly string[];
  /** Steps asked only when they apply. */
  conditional: Record<string, (slots: Record<string, string>, ctx: BookingContext) => boolean>;
  /** Changing a slot clears the answers that depended on it. */
  dependents: Record<string, string[]>;
  validate(slot: string, value: string): SlotResult;
  invalid: Record<string, string>;
  /** Answered quietly before a step, so the visitor has the facts behind the choice. */
  contextQuery: Record<string, string>;
  /** The read-back before sending. */
  summary(slots: Record<string, string>): string;
  /** After a call-back request is sent. */
  done(slots: Record<string, string>): string;
  changePrompt: string;
  timeNote: string;
  ready: string;
  continue: string;
  /** Columns of the console's booking table. */
  columns: { title: string; value(slots: Record<string, string>): string | null }[];
  /** How the planner should fill the slots. */
  plannerNotes: string;
  /** Offline planner: which slot a "change my …" message is about. */
  changeSlot(text: string): string;
  /** Offline planner: the first slot's value when the booking request already names it, e.g. "book a hygienist". */
  firstValueFrom(text: string): string | null;
  /** Slots the visitor has already told us, from their messages, oldest first; later messages win. */
  prefill?(texts: string[]): Record<string, string>;
  /** Said before the first question when a booking starts with slots already filled. */
  startedWith?(slots: Record<string, string>): string;
};

export const PART_OF_DAY =
  /\b(?:mornings?|afternoons?|evenings?|lunch\w*|am|pm|\d{1,2}(?::\d{2})?\s*(?:am|pm)?|any ?time|whenever|flexible|after work|before work|after school)\b/i;

/** The part of day is asked only when the preferred time doesn't already say it. */
export function needsPartOfDay(slots: Record<string, string>): boolean {
  return Boolean(slots.preferred_time) && !PART_OF_DAY.test(slots.preferred_time!.replace(/\s*\([^)]*\)/g, ""));
}

export const TIME_OF_DAY_OPTIONS = ["Morning", "Afternoon", "Evening", "Any time"];
export const CONFIRM_OPTIONS = ["Yes, send it", "Change something"];

/** Steps every business asks the same way: name, phone, times and the final yes or no. */
export function commonSlot(slot: string, value: string, notAName: RegExp): SlotResult {
  const v = value.trim();
  switch (slot) {
    case "name": {
      if (tokenKind(v) === "NAME") return { ok: true, value: v };
      if (/^[\p{L}][\p{L}' .-]{0,58}$/u.test(v) && v.split(/\s+/).length <= 4 && !notAName.test(v)) return { ok: true, value: v };
      return { ok: false, error: "not a name" };
    }
    case "phone":
      if (tokenKind(v) === "PHONE" || isPhoneLike(v)) return { ok: true, value: v };
      return { ok: false, error: "not a UK phone number" };
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

export function startBooking(def: BookingDef, slots: Record<string, string> = {}): FlowState {
  const known = Object.fromEntries(Object.entries(slots).filter(([k]) => def.slots.includes(k)));
  return { name: "booking_request", step: def.slots[0]!, slots: known };
}

/** The first slot still missing, in catalogue order. */
export function nextBookingStep(def: BookingDef, flow: FlowState, ctx: BookingContext): string | "done" {
  for (const slot of def.slots) {
    if (flow.slots[slot]) continue;
    const applies = def.conditional[slot];
    if (applies && !applies(flow.slots, ctx)) continue;
    return slot;
  }
  return "done";
}

/** The slot value when the visitor's text can be filled without the planner, else null. */
export function quickReplyValue(def: BookingDef, step: string, text: string): string | null {
  const options = def.options[step];
  if (!options || step === "confirm" || text.includes("?")) return null;
  const tapped = options.find((o) => o.toLowerCase() === text.trim().toLowerCase());
  if (def.exactOnly.includes(step)) return tapped ?? null;
  return def.validate(step, text).ok ? text : null;
}

export function bookingOptions(def: BookingDef, step: string): string[] {
  return step === "done" || step === "change" ? [] : (def.options[step] ?? []);
}

export function applyBookingSlot(def: BookingDef, flow: FlowState, slot: string, value: string): FlowState {
  const slots = { ...flow.slots, [slot]: value };
  if (slot !== "confirm") delete slots.confirm;
  for (const d of def.dependents[slot] ?? []) delete slots[d];
  return { ...flow, slots };
}

export function bookingPrompt(def: BookingDef, step: string, slots: Record<string, string>): string {
  return step === "confirm" ? def.summary(slots) : def.prompts[step]!;
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
