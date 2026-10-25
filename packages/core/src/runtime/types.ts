import type { BookedAppointment, BookingSystem } from "../booking/types.ts";
import type { Vertical } from "../packs/types.ts";
import type {
  BookingConfig,
  BundleConfig,
  FlowState,
  GuardrailHit,
  ModelCall,
  Procedure,
  RetrievedChunk,
  Source,
  TraceCommand,
} from "@dental-bot/db/schema";
import type { HandoverReason } from "./commands.ts";
import type { Practice } from "./templates.ts";

export type ScoredChunk = {
  chunkId: number;
  page: string;
  slug: string;
  heading: string;
  anchor: string;
  text: string;
  score: number;
  keywordScore: number;
};

export type Bundle = {
  tenantId: string;
  versionId: number;
  versionNumber: number;
  contentVersionId: number;
  contentVersionNumber: number;
  guidance: string;
  procedures: Procedure[];
  flowCatalogue: string[];
  config: BundleConfig;
  practice: Practice;
  /** The business pack: booking steps, safety rules and wording. */
  vertical: Vertical;
  booking: BookingConfig;
  /** Pages the fixed handover templates are written from, shown as their sources. */
  handoverSources: { urgent: Source[]; clinical: Source[] };
};

/** `kind` is the message kind, e.g. "suggest" for a booking offer. */
export type HistoryItem = { role: "visitor" | "bot" | "staff" | "system"; text: string; kind?: string };

export type TurnContext = {
  visitorText: string | null;
  action: "book" | "handover" | null;
  flow: FlowState | null;
  status: "active" | "handed_over" | "closed";
  history: HistoryItem[];
  bundle: Bundle;
  /** The last substantive act of the bot in this conversation, e.g. "clarify". */
  lastBotAct?: string | null;
  /** Questions answered earlier in this conversation. */
  answeredBefore?: number;
  /** A booking was offered, requested or handed to the team earlier, so the bot doesn't offer again. */
  bookingOffered?: boolean;
  /** A booking was made or the chat was handed to the team, so no further offers, even a new follow-up. */
  bookingClosed?: boolean;
  /** Someone from the team has replied since the latest handover. */
  teamReplied?: boolean;
};

export type PlannerResult = { commands: unknown; call: ModelCall | null };

export type ComposeResult = { stream: AsyncIterable<string>; done: Promise<ModelCall | null> };

export type ExecutorDeps = {
  plan(ctx: TurnContext): Promise<PlannerResult>;
  retrieve(query: string, bundle: Bundle): Promise<ScoredChunk[]>;
  compose(query: string, chunks: ScoredChunk[], bundle: Bundle): ComposeResult;
  /** The business's booking system, when bookings go online. */
  booking?: BookingSystem | null;
  now?: () => number;
};

export type SegmentKind =
  | "answer"
  | "fallback"
  | "flow"
  | "clarify"
  | "handover"
  | "cannot_handle"
  | "acknowledge"
  | "suggest"
  | "error";

export type Segment = {
  id: string;
  kind: SegmentKind;
  text: string;
  sources: Source[];
  options: string[];
};

export type ExecutorEvent =
  | { type: "segment_start"; id: string; kind: SegmentKind }
  | { type: "delta"; id: string; text: string }
  | { type: "segment_end"; id: string; sources: Source[]; options: string[] };

export type BotAct =
  | "answered"
  | "fallback"
  | "blocked"
  | "clarify"
  | "flow"
  | "flow_completed"
  | "handover"
  | "out_of_scope"
  | "cannot_handle"
  | "acknowledged"
  | "waiting"
  | "error";

export type TurnResult = {
  segments: Segment[];
  flow: FlowState | null;
  status: "active" | "handed_over";
  handover: { reason: HandoverReason; trigger: "precheck" | "planner" | "visitor_button" } | null;
  booking: Record<string, string> | null;
  /** Set when the booking was made in the business's booking system rather than sent as a call-back request. */
  bookedOnline: BookedAppointment | null;
  /** Contact details collected for the open handover; set whenever they change. */
  contact: Record<string, string> | null;
  act: BotAct;
  answered: number;
  fallbacks: number;
  topic: string | null;
  affirmed: boolean;
  trace: {
    commands: TraceCommand[];
    rejected: unknown[];
    retrieved: RetrievedChunk[];
    guardrails: GuardrailHit[];
    modelCalls: ModelCall[];
    firstTokenMs: number | null;
    plannerSkipped: string | null;
    error: string | null;
  };
};
