import type { HandoverReason } from "../runtime/commands.ts";
import type { BookingDef } from "../runtime/flows/booking.ts";
import type { PrecheckRule } from "../runtime/guardrails.ts";
import type { Practice } from "../runtime/templates.ts";

export type Vertical = "dental" | "salon";

/**
 * Everything that makes the assistant right for one kind of business: its booking steps, the
 * safety rules that hand over before the planner runs, and its wording. The engine is shared.
 */
export type Pack = {
  vertical: Vertical;
  /** How the planner is told what the business is, e.g. "a dental practice". */
  kind: string;
  /** How the assistant refers to the business, e.g. "practice". */
  place: string;
  /** Widget wording. */
  labels: { assistant: string; talk: string; footer: string };
  greeting(b: Practice): string;
  cannotHandle(b: Practice, reason: "out_of_scope" | "unsupported_request" | "abusive"): string;
  technicalProblem(b: Practice): string;
  waitingForTeam(b: Practice): string;
  handoverMessage(b: Practice, reason: HandoverReason): string;
  /** Sent when the team hands the chat back to the assistant. */
  released: string;
  greetOptions: string[];
  steerBackOptions: string[];
  price: { lead: string; options: string[]; query: string };
  precheck: PrecheckRule[];
  /** Sentences the assistant must never say, e.g. medical advice. */
  unsafeOutput: RegExp;
  /** Asked first on an urgent handover, so the team can prioritise. */
  urgentDetails: string;
  redFlags: RegExp;
  redFlagReminder: string;
  billingDetails: string;
  /** Questions that suggest a visit is being planned, so a booking offer after the first answer is welcome. */
  visitIntent: RegExp;
  bookingOffer: string;
  acknowledgeWithOffer: string;
  booking: BookingDef;
  /** Wording for booking straight into the business's booking system. */
  online: {
    slotPrompt(slots: Record<string, string>): string;
    noTimes: string;
    slotInvalid: string;
    booked(slots: Record<string, string>, b: Practice): string;
    failed(slots: Record<string, string>): string;
  } | null;
  /** The page and section anchors the fixed handover messages cite. */
  handoverSources: { slug: string; urgent: RegExp; clinical: RegExp };
};
