import type { Command } from "./commands.ts";
import { packFor } from "../packs/index.ts";
import { nextBookingStep } from "./flows/booking.ts";
import { yesNo } from "./guardrails.ts";
import { REFERS_BACK, withProfile } from "./profile.ts";
import type { ComposeContext, ComposeResult, PlannerResult, ScoredChunk, TurnContext } from "./types.ts";

/**
 * Deterministic stand-ins for the chat model. Used when no API key is configured, for
 * seeding demo conversations, and in tests. They are intentionally simple.
 */

const BOOK = /\b(book|booking|appointment|make an appt|come in|register|sign up)\b/i;
const PERSON = /\b(speak|talk) (to|with) (someone|a person|a human|reception|the practice|the salon|staff)|\breal person\b|\bhuman\b|\bcall me back\b/i;
const COMPLAINT = /\b(complain|complaint|refund|unhappy with my (treatment|colou?r|cut|hair)|(ruined|hate) my hair)\b/i;
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

/** One standalone question with nothing for the planner to decide: no booking, handover, follow-up or second question. */
export function isSimpleQuestion(text: string): boolean {
  return (
    looksLikeQuestion(text) &&
    splitQuestions(text).length === 1 &&
    text.split(/\s+/).length <= 15 &&
    ![BOOK, PERSON, COMPLAINT, RECORD, OFF_TOPIC, REFERS_BACK].some((p) => p.test(text))
  );
}

export async function offlinePlan(ctx: TurnContext): Promise<PlannerResult> {
  const text = (ctx.visitorText ?? "").trim();
  const commands: Command[] = [];
  const def = packFor(ctx.bundle.vertical).booking;

  if (PERSON.test(text)) commands.push({ cmd: "handover", reason: "visitor_request" });
  else if (COMPLAINT.test(text)) commands.push({ cmd: "handover", reason: "complaint" });
  else if (RECORD.test(text)) commands.push({ cmd: "handover", reason: "patient_record" });
  else if (OFF_TOPIC.test(text)) commands.push({ cmd: "cannot_handle", reason: "out_of_scope" });
  else if (ctx.flow?.name === "booking_request" && !looksLikeQuestion(text)) {
    const step = ctx.flow.step === "change" ? null : nextBookingStep(def, ctx.flow, { online: ctx.bundle.booking?.mode === "online" });
    if (step === "confirm") {
      const yn = yesNo(text);
      if (yn) commands.push({ cmd: "set_slot", slot: "confirm", value: yn });
    } else if (step && step !== "done") {
      commands.push({ cmd: "set_slot", slot: step, value: text });
    } else if (ctx.flow.step === "change") {
      const slot = def.changeSlot(text);
      const value = text.replace(/^.*?\b(?:to|is)\b\s*/i, "");
      if (value && value !== text) commands.push({ cmd: "set_slot", slot, value });
    }
  } else if (BOOK.test(text) && !looksLikeQuestion(text.replace(/^(can|could) i\b/i, ""))) {
    commands.push({ cmd: "start_flow", flow: "booking_request" });
    const first = def.firstValueFrom(text);
    if (first) commands.push({ cmd: "set_slot", slot: def.slots[0]!, value: first });
  } else {
    for (const q of splitQuestions(text)) commands.push({ cmd: "answer_from_knowledge", query: withProfile(q, ctx.profile ?? {}, def) });
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

/**
 * A price list line, e.g. "Cut and blow-dry: graduate stylist £45; stylist £62; senior stylist £75", cut to the
 * option the question names: "Cut and blow-dry with a senior stylist: £75". Unchanged when none is named.
 */
export function onlyAskedFor(line: string, query: string): string {
  const m = /^([^:]+):\s*(.+)$/.exec(line);
  if (!m) return line;
  const options = m[2]!.replace(/[.]$/, "").split(/;\s*/).map((o) => /^(.+?)\s+(£\d.*)$/.exec(o));
  if (options.length < 2 || options.some((o) => !o)) return line;
  const q = query.toLowerCase();
  const named = options
    .filter((o) => new RegExp(`\\b${o![1]!.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(q))
    .sort((a, b) => b![1]!.length - a![1]!.length)[0];
  if (!named) return line;
  const [, option, price] = named;
  const who = /(?:stylist|director)$/i.test(option!) ? ` with ${/^[aeiou]/i.test(option!) ? "an" : "a"} ${option}` : ` (${option})`;
  return `${m[1]}${who}: ${price}`;
}

/** Picks the lines of the top chunks that best overlap the query and cites them. */
export function offlineCompose(query: string, chunks: ScoredChunk[], context?: ComposeContext): ComposeResult {
  const q = [...new Set(terms(`${query} ${context?.related?.join(" ") ?? ""}`))];
  const p = terms(Object.values(context?.profile ?? {}).join(" ")).filter((t) => !q.includes(t));
  const scored: { line: string; idx: number; score: number }[] = [];
  const best = chunks[0]?.score ?? 0;
  chunks.forEach((c, i) => {
    if (c.score < best - 0.06) return;
    for (const line of c.text.split(/\n+|(?<=\.)\s+(?=[A-Z])/)) {
      const clean = line.replace(/^[-*]\s*/, "").trim();
      if (clean.length < 8) continue;
      const lt = terms(clean);
      const overlap = q.filter((t) => lt.some((l) => l.startsWith(t.slice(0, 5)))).length;
      const label = /^([^:]{3,60}):/.exec(clean)?.[1]?.toLowerCase();
      const named = label && query.toLowerCase().includes(label) ? 0.5 : 0;
      // What the visitor told us earlier breaks ties, e.g. the senior stylist's price over the others.
      const fits = Math.min(0.45, 0.15 * p.filter((t) => lt.some((l) => l.startsWith(t.slice(0, 5)))).length);
      scored.push({ line: clean, idx: i + 1, score: overlap + named + (overlap > 0 ? fits : 0) - i * 0.1 });
    }
  });
  scored.sort((a, b) => b.score - a.score);
  const covers = (line: string) => q.filter((t) => terms(line).some((l) => l.startsWith(t.slice(0, 5))));
  let picked: typeof scored = [];
  for (const s of scored) {
    if (s.score <= 0 || picked.length === 2) break;
    // A second line only when it answers part of the question the first didn't, so a fact isn't said twice.
    const covered = new Set(picked.flatMap((x) => covers(x.line)));
    if (picked.length && covers(s.line).every((t) => covered.has(t))) continue;
    picked.push(s);
  }
  // The visitor's word isn't on the website, but the section it stands for was found: its first sentence answers.
  if (picked.length === 0 && chunks[0] && context?.related?.includes(chunks[0].heading)) {
    picked = [{ line: chunks[0].text.split(/\n+|(?<=\.)\s+(?=[A-Z])/)[0]!.trim(), idx: 1, score: 1 }];
  }
  const text = picked.length
    ? picked.map((p) => `${onlyAskedFor(p.line, query).replace(/[.]$/, "")} [${p.idx}].`).join(" ")
    : "NO_ANSWER";
  async function* stream() {
    yield text;
  }
  return { stream: stream(), done: Promise.resolve(null) };
}
