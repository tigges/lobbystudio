import type { HandoverReason } from "../runtime/commands.ts";
import type { BookingDef } from "../runtime/flows/booking.ts";
import type { PrecheckRule } from "../runtime/guardrails.ts";
import type { Practice } from "../runtime/templates.ts";
import type { Synonym } from "./synonyms.ts";

export type Vertical = "dental" | "salon";

/** How a page's section pills answer: what the section covers, or its prices. */
export type MenuMode = "overview" | "prices";

/** A topic pill: either the sections of a page, or one section answered directly. */
export type MenuItem = { label: string; page: string } | { label: string; heading: string; ask: string };

export type Menu = {
  /** Topics a visitor can tap or type, e.g. "Services", "Hours", "Find us". */
  topics: MenuItem[];
  /** The pills a chat opens with on the home page, and offered again after "hello": topic labels or the Book pill. */
  start: string[];
  /** How a page's section pills answer; pages not listed say what the section covers. */
  pages: Record<string, MenuMode>;
  /** Pages that open with no pills, e.g. booking and emergencies. */
  quiet: string[];
  /** Sections never offered as pills: payment, cancellations and the like. */
  skip: RegExp;
};

/** Asked before any price, when the answer depends on it, e.g. NHS or private. */
export type CareGate = {
  question: string;
  options: string[];
  /** The section prices come from for the first option, e.g. "NHS charges". */
  nhsHeading: string;
  /** The section that explains the difference, answered for "Not sure". */
  explainHeading: string;
};

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
  /** The opening message; `page` is the website page the chat was opened on, e.g. "prices". */
  greeting(b: Practice, page?: string | null): string;
  cannotHandle(b: Practice, reason: "out_of_scope" | "unsupported_request" | "abusive"): string;
  technicalProblem(b: Practice): string;
  waitingForTeam(b: Practice): string;
  handoverMessage(b: Practice, reason: HandoverReason): string;
  /** Sent when the team hands the chat back to the assistant. */
  released: string;
  /** "Prices?" with no service named: the lead, and the page whose sections are offered. */
  price: { lead: string; page: string };
  menu: Menu;
  careGate?: CareGate;
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
  /**
   * A booking offer that follows on from what was just answered and what the visitor has told us,
   * e.g. "Would you like me to find you a time on Saturdays for a cut & style?". Null for the plain offer.
   */
  followUp?(input: { headings: string[]; slots: Record<string, string> }): string | null;
  booking: BookingDef;
  /** Wording for booking straight into the business's booking system. */
  online: {
    slotPrompt(slots: Record<string, string>): string;
    noTimes: string;
    /** After the visitor turns the times down: more times, another day or a call-back. */
    moreTimes: string;
    slotInvalid: string;
    booked(slots: Record<string, string>, b: Practice): string;
    failed(slots: Record<string, string>): string;
  } | null;
  /**
   * Questions about a service the content doesn't cover, e.g. wedding hair: when there's no answer, they go
   * straight to the team with the visitor's contact details rather than ending at "I can't answer that".
   */
  enquiry?: { pattern: RegExp; message(b: Practice): string };
  /** Other words for what the website covers, so retrieval finds the section. */
  synonyms: Synonym[];
  /** The page and section anchors the fixed handover messages cite. */
  handoverSources: { slug: string; urgent: RegExp; clinical: RegExp };
};
