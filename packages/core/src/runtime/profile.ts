import type { FlowState } from "@dental-bot/db/schema";
import type { BookingDef } from "./flows/booking.ts";

/** What the visitor has told us in this conversation, keyed like the booking steps. */
export type Profile = Record<string, string>;

/** Booking answers that are personal, or only mean something inside one booking. */
const NOT_KEPT = new Set(["name", "phone", "confirm", "slot", "slot_id", "slot_start", "offered", "slot_choice", "times_after"]);

const EXTRA_TITLES: Record<string, string> = { client: "New or returning client" };

/** The profile after this turn: earlier facts, overwritten by anything said now or answered in the booking. */
export function updateProfile(def: BookingDef, before: Profile, texts: string[], flow: FlowState | null): Profile {
  const next: Profile = { ...before, ...def.prefill?.(texts) };
  if (flow?.name === "booking_request") {
    for (const [k, v] of Object.entries(flow.slots)) if (v && !NOT_KEPT.has(k)) next[k] = v;
  }
  return next;
}

/** "Service: Balayage; Stylist: Senior stylist", or "" when we know nothing yet. */
export function profileLine(profile: Profile, def: BookingDef): string {
  return Object.entries(profile)
    .filter(([k, v]) => v && !NOT_KEPT.has(k))
    .map(([k, v]) => `${def.titles[k] ?? EXTRA_TITLES[k] ?? k}: ${v}`)
    .join("; ");
}

export const REFERS_BACK = /\b(it|that|this|one|them|those)\b/i;
const ASKS_PRICE = /\b(how much|cost\w*|price\w*|charge)\b/i;

/**
 * A follow-up such as "how long does it take?" written as a standalone question, using the service the
 * visitor told us about, so retrieval finds the right section. Questions that name a service are unchanged.
 */
export function withProfile(query: string, profile: Profile, def: BookingDef): string {
  const service = profile.service ?? profile.reason;
  if (!service || def.firstValueFrom(query) || !REFERS_BACK.test(query)) return query;
  const level = ASKS_PRICE.test(query) && profile.stylist && /stylist|director/i.test(profile.stylist) ? ` with a ${profile.stylist.toLowerCase()}` : "";
  return `${query.replace(/[?.!]+$/, "")} (${service.toLowerCase()}${level})?`;
}
