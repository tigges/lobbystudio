import type { Command } from "./commands.ts";
import { nextBookingStep } from "./flows/booking-request.ts";
import { yesNo } from "./guardrails.ts";
import type { ComposeResult, PlannerResult, ScoredChunk, TurnContext } from "./types.ts";

/**
 * Deterministic stand-ins for the chat model. Used when no API key is configured, for
 * seeding demo conversations, and in tests. They are intentionally simple.
 */

const BOOK = /\b(book|booking|appointment|make an appt|come in|register|sign up)\b/i;
const PERSON = /\b(speak|talk) (to|with) (someone|a person|a human|reception|the practice|staff)|\breal person\b|\bhuman\b|\bcall me back\b/i;
const COMPLAINT = /\b(complain|complaint|refund|unhappy with my treatment)\b/i;
const RECORD = /\b(my (records?|x-?rays?|results|notes|account|bill|invoice))\b/i;
const OFF_TOPIC = /\b(weather|football|recipe|capital of|joke|bitcoin|stock market|write me|poem)\b/i;
const QUESTION_START = /^(how|what|when|where|which|who|why|do|does|did|are|is|can|could|will|would|should)\b/i;

function looksLikeQuestion(text: string) {
  return text.includes("?") || QUESTION_START.test(text.trim());
}

function splitQuestions(text: string): string[] {
  const parts = text
    .split(/\?|\band (?=(?:how|what|when|where|do|does|are|is|can)\b)/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 3);
  return parts.length ? parts.slice(0, 3) : [text.trim()];
}

function reasonFrom(text: string): string | null {
  if (/hygien/i.test(text)) return "Hygienist appointment";
  if (/whiten/i.test(text)) return "Whitening consultation";
  if (/implant/i.test(text)) return "Implant consultation";
  if (/aligner|invisalign|straighten/i.test(text)) return "Clear aligner consultation";
  if (/check[- ]?up|exam/i.test(text)) return "Check-up";
  return null;
}

export async function offlinePlan(ctx: TurnContext): Promise<PlannerResult> {
  const text = (ctx.visitorText ?? "").trim();
  const commands: Command[] = [];

  if (PERSON.test(text)) commands.push({ cmd: "handover", reason: "visitor_request" });
  else if (COMPLAINT.test(text)) commands.push({ cmd: "handover", reason: "complaint" });
  else if (RECORD.test(text)) commands.push({ cmd: "handover", reason: "patient_record" });
  else if (OFF_TOPIC.test(text)) commands.push({ cmd: "cannot_handle", reason: "out_of_scope" });
  else if (ctx.flow?.name === "booking_request" && !looksLikeQuestion(text)) {
    const step = ctx.flow.step === "change" ? null : nextBookingStep(ctx.flow);
    if (step === "confirm") {
      const yn = yesNo(text);
      if (yn) commands.push({ cmd: "set_slot", slot: "confirm", value: yn });
    } else if (step && step !== "done") {
      commands.push({ cmd: "set_slot", slot: step, value: text });
    } else if (ctx.flow.step === "change") {
      const slot = /phone|number/i.test(text)
        ? "phone"
        : /name/i.test(text)
          ? "name"
          : /nhs|private/i.test(text)
            ? "care"
            : /new|existing/i.test(text)
              ? "patient"
              : /time|day/i.test(text)
                ? "preferred_time"
                : "reason";
      const value = text.replace(/^.*?\b(?:to|is)\b\s*/i, "");
      if (value && value !== text) commands.push({ cmd: "set_slot", slot, value });
    }
  } else if (BOOK.test(text) && !looksLikeQuestion(text.replace(/^(can|could) i\b/i, ""))) {
    commands.push({ cmd: "start_flow", flow: "booking_request" });
    const reason = reasonFrom(text);
    if (reason) commands.push({ cmd: "set_slot", slot: "reason", value: reason });
  } else {
    for (const q of splitQuestions(text)) commands.push({ cmd: "answer_from_knowledge", query: q });
  }
  return { commands, call: null };
}

const STOP = new Set(
  "a an the and or of to for in on at is are do does you your we our i me my it can how much what when where which with be have has there this that".split(
    " ",
  ),
);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9£]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** Picks the lines of the top chunks that best overlap the query and cites them. */
export function offlineCompose(query: string, chunks: ScoredChunk[]): ComposeResult {
  const q = terms(query);
  const scored: { line: string; idx: number; score: number }[] = [];
  const best = chunks[0]?.score ?? 0;
  chunks.forEach((c, i) => {
    if (c.score < best - 0.03) return;
    for (const line of c.text.split(/\n+|(?<=\.)\s+(?=[A-Z])/)) {
      const clean = line.replace(/^[-*]\s*/, "").trim();
      if (clean.length < 8) continue;
      const lt = terms(clean);
      const overlap = q.filter((t) => lt.some((l) => l.startsWith(t.slice(0, 5)))).length;
      scored.push({ line: clean, idx: i + 1, score: overlap - i * 0.1 });
    }
  });
  scored.sort((a, b) => b.score - a.score);
  const picked = scored.filter((s) => s.score > 0).slice(0, 2);
  const text = picked.length
    ? picked.map((p) => `${p.line.replace(/[.]$/, "")} [${p.idx}].`).join(" ")
    : "NO_ANSWER";
  async function* stream() {
    yield text;
  }
  return { stream: stream(), done: Promise.resolve(null) };
}
