import type { FlowState, Source } from "@dental-bot/db/schema";
import { parseCommands, type Command, type HandoverReason } from "./commands.ts";
import { NO_ANSWER, parseSentence, SentenceSplitter } from "./compose.ts";
import {
  applyBookingSlot,
  BOOKING_CHANGE_PROMPT,
  BOOKING_INVALID,
  BOOKING_SLOTS,
  BOOKING_TIME_NOTE,
  bookingDone,
  bookingOptions,
  bookingPrompt,
  nextBookingStep,
  quickReplyValue,
  startBooking,
  validateSlot,
} from "./flows/booking-request.ts";
import { collectContact, isCollectingContact, knownContact, startContact } from "./flows/handover-contact.ts";
import {
  asksForFixedTime,
  checkGrounding,
  clinicalOutputCheck,
  clinicalPrecheck,
  isAffirmation,
  isGreeting,
  yesNo,
} from "./guardrails.ts";
import * as T from "./templates.ts";
import type {
  ExecutorDeps,
  ExecutorEvent,
  ScoredChunk,
  Segment,
  SegmentKind,
  TurnContext,
  TurnResult,
} from "./types.ts";

type Emit = (event: ExecutorEvent) => void;

/** Once the top chunk clears the threshold, nearby chunks are also given to compose as context. */
const CONTEXT_MARGIN = 0.1;
/** Queries this short that compose cannot answer are treated as a topic, not a question. */
const TOPIC_MAX_WORDS = 3;
/** Questions that suggest the visitor is planning a visit, so a booking offer after the first answer is welcome. */
const VISIT_INTENT =
  /\b(?:new patients?|regist\w*|join|taking on|accepting|how much|cost\w*|price\w*|fees?|park\w*|step-?free|wheelchair|access\w*|get there|find you|directions|first visit)\b/i;
const OFFER_DECLINE = /^(?:not right now|not now|not yet|maybe later|no(?:,? thanks?(?: you)?)?|i'?m (?:ok|fine|good)(?:,? thanks?)?)[.! ]*$/i;

class ReplyWriter {
  readonly segments: Segment[] = [];
  private open: { segment: Segment; key: string } | null = null;
  private counter = 0;
  firstOutputAt: number | null = null;

  constructor(
    private readonly emit: Emit,
    private readonly now: () => number,
  ) {}

  private begin(kind: SegmentKind, key: string): Segment {
    const segment: Segment = { id: `s${++this.counter}`, kind, text: "", sources: [], options: [] };
    this.open = { segment, key };
    this.segments.push(segment);
    this.emit({ type: "segment_start", id: segment.id, kind });
    return segment;
  }

  private write(segment: Segment, text: string) {
    const delta = segment.text ? ` ${text}` : text;
    segment.text += delta;
    this.firstOutputAt ??= this.now();
    this.emit({ type: "delta", id: segment.id, text: delta });
  }

  /** Appends a grounded sentence, starting a new segment when its sources differ from the open one. */
  sentence(text: string, sources: Source[]) {
    const key = sources.map((s) => s.chunkId).join(",");
    const seg = this.open && this.open.key === key ? this.open.segment : (this.close(), this.begin("answer", key));
    seg.sources = sources;
    this.write(seg, text);
  }

  template(kind: SegmentKind, text: string, sources: Source[] = [], options: string[] = []) {
    this.close();
    const seg = this.begin(kind, `template:${this.counter}`);
    seg.sources = sources;
    seg.options = options;
    this.write(seg, text);
    this.close();
  }

  close() {
    if (!this.open) return;
    const { segment } = this.open;
    this.emit({ type: "segment_end", id: segment.id, sources: segment.sources, options: segment.options });
    this.open = null;
  }
}

function sourceOf(c: ScoredChunk): Source {
  return { page: c.page, slug: c.slug, heading: c.heading, anchor: c.anchor, chunkId: c.chunkId };
}

/** Resolves conflicts between commands so one turn has one coherent intent. */
export function normaliseCommands(
  commands: Command[],
  flow: FlowState | null,
): { kept: Command[]; dropped: { raw: Command; error: string }[] } {
  const dropped: { raw: Command; error: string }[] = [];
  const handover = commands.find((c) => c.cmd === "handover");
  if (handover) {
    for (const c of commands) if (c !== handover) dropped.push({ raw: c, error: "superseded by handover" });
    return { kept: [handover], dropped };
  }
  const startHandover = commands.find((c) => c.cmd === "start_flow" && c.flow === "handover");
  if (startHandover) {
    for (const c of commands) if (c !== startHandover) dropped.push({ raw: c, error: "superseded by handover" });
    return { kept: [{ cmd: "handover", reason: "visitor_request" }], dropped };
  }

  const startsBooking = commands.some((c) => c.cmd === "start_flow" && c.flow === "booking_request");
  const bookingActive = flow?.name === "booking_request" || startsBooking;

  const applicable: Command[] = [];
  for (const c of commands) {
    if (c.cmd === "set_slot" && (!bookingActive || !(BOOKING_SLOTS as readonly string[]).includes(c.slot))) {
      dropped.push({ raw: c, error: bookingActive ? `unknown slot ${c.slot}` : "set_slot without an active flow" });
    } else if (c.cmd === "start_flow" && flow?.name === "booking_request") {
      dropped.push({ raw: c, error: "flow already active" });
    } else {
      applicable.push(c);
    }
  }
  const substantive = applicable.filter((c) => c.cmd === "answer_from_knowledge" || c.cmd === "start_flow" || c.cmd === "set_slot");

  const kept: Command[] = [];
  for (const c of applicable) {
    if ((c.cmd === "clarify" || c.cmd === "cannot_handle") && substantive.length > 0) {
      dropped.push({ raw: c, error: `${c.cmd} mixed with substantive commands` });
    } else if (c.cmd === "clarify" && kept.some((k) => k.cmd === "clarify" || k.cmd === "cannot_handle")) {
      dropped.push({ raw: c, error: "duplicate terminal command" });
    } else {
      kept.push(c);
    }
  }
  const order: Record<Command["cmd"], number> = {
    answer_from_knowledge: 0,
    start_flow: 1,
    set_slot: 2,
    clarify: 3,
    cannot_handle: 3,
    handover: 4,
  };
  kept.sort((a, b) => order[a.cmd] - order[b.cmd]);
  return { kept, dropped };
}

export async function runExecutor(ctx: TurnContext, deps: ExecutorDeps, emit: Emit = () => {}): Promise<TurnResult> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const { bundle } = ctx;
  const practice = bundle.practice;
  const out = new ReplyWriter(emit, now);

  const result: TurnResult = {
    segments: out.segments,
    flow: ctx.flow,
    status: ctx.status === "handed_over" ? "handed_over" : "active",
    handover: null,
    booking: null,
    contact: null,
    act: "answered",
    answered: 0,
    fallbacks: 0,
    topic: null,
    affirmed: false,
    trace: {
      commands: [],
      rejected: [],
      retrieved: [],
      guardrails: [],
      modelCalls: [],
      firstTokenMs: null,
      plannerSkipped: null,
      error: null,
    },
  };
  const trace = result.trace;
  const finish = () => {
    out.close();
    trace.firstTokenMs = out.firstOutputAt === null ? null : out.firstOutputAt - started;
    return result;
  };

  if (ctx.status === "handed_over") {
    result.act = "waiting";
    trace.plannerSkipped = "handed_over";
    const said = ctx.visitorText?.trim();
    if (said && isCollectingContact(ctx.flow)) {
      const step = collectContact(ctx.flow, said);
      result.flow = step.flow;
      if (step.changed) result.contact = { ...step.flow.slots };
      if (step.reply) out.template("flow", step.reply, [], step.options);
      trace.guardrails.push({ rule: "handover_contact", result: step.changed ? "hit" : "pass", detail: `${ctx.flow.step} → ${step.flow.step}` });
      return finish();
    }
    // Pressing a button, or writing before anyone from the team has replied, gets one acknowledgement
    // so the visitor isn't left wondering; once the team is talking, the bot stays out of the way.
    const waiting = T.waitingForTeam(practice);
    const lastBot = ctx.history.findLast((h) => h.role === "bot")?.text;
    const teamReplied = ctx.history.some((h) => h.role === "staff");
    if (ctx.action || (!teamReplied && lastBot !== waiting)) out.template("acknowledge", waiting);
    return finish();
  }

  const text = ctx.visitorText?.trim() ?? "";
  let commands: Command[] = [];
  let handoverTrigger: "precheck" | "planner" | "visitor_button" = "planner";
  const bookingStep = ctx.flow?.name === "booking_request" ? nextStepOf(ctx.flow) : null;
  let timeNoteOnly = false;

  if (ctx.action === "handover") {
    commands = [{ cmd: "handover", reason: "visitor_request" }];
    handoverTrigger = "visitor_button";
    trace.plannerSkipped = "exit_button";
  } else if (ctx.action === "book" || text.toLowerCase() === T.BOOK_OPTION.toLowerCase() || (offerPending() && yesNo(text) === "yes")) {
    // The "Book a check-up" button knows the reason; the offer's "Book an appointment" chip asks for it.
    const tapped = !ctx.action;
    commands =
      ctx.flow?.name === "booking_request"
        ? []
        : tapped
          ? [{ cmd: "start_flow", flow: "booking_request" }]
          : [
              { cmd: "start_flow", flow: "booking_request" },
              { cmd: "set_slot", slot: "reason", value: "Check-up" },
            ];
    trace.plannerSkipped = tapped ? "booking_offer" : "exit_button";
  } else {
    const pre = clinicalPrecheck(text);
    trace.guardrails.push(
      pre.hit
        ? { rule: "clinical_precheck", result: "hit", detail: `${pre.reason}: "${pre.matched}"` }
        : { rule: "clinical_precheck", result: "pass" },
    );
    if (pre.hit) {
      commands = [{ cmd: "handover", reason: pre.reason }];
      handoverTrigger = "precheck";
      trace.plannerSkipped = "clinical_precheck";
    } else if (bookingStep === "confirm" && yesNo(text)) {
      commands = [{ cmd: "set_slot", slot: "confirm", value: yesNo(text)! }];
      trace.plannerSkipped = "deterministic_confirm";
    } else if (bookingStep && bookingStep !== "done" && bookingStep !== "change" && quickReplyValue(bookingStep, text) !== null) {
      commands = [{ cmd: "set_slot", slot: bookingStep, value: quickReplyValue(bookingStep, text)! }];
      trace.plannerSkipped = "deterministic_option";
    } else if (offerPending() && OFFER_DECLINE.test(text)) {
      result.act = "acknowledged";
      trace.plannerSkipped = "booking_offer_declined";
      out.template("acknowledge", T.OFFER_DECLINED);
      return finish();
    } else if (isAffirmation(text)) {
      result.affirmed = true;
      result.act = "acknowledged";
      trace.plannerSkipped = "affirmation";
      if (mayOffer() && (ctx.answeredBefore ?? 0) > 0) {
        trace.guardrails.push({ rule: "booking_offer", result: "hit", detail: "on thanks" });
        out.template("suggest", T.ACKNOWLEDGE_WITH_OFFER, [], T.OFFER_OPTIONS);
      } else {
        out.template("acknowledge", T.ACKNOWLEDGE);
      }
      return finish();
    } else if (!ctx.flow && isGreeting(text)) {
      result.act = "acknowledged";
      trace.plannerSkipped = "greeting";
      out.template("acknowledge", T.GREET_BACK, [], T.GREET_OPTIONS);
      return finish();
    } else if (bookingStep && bookingStep !== "done" && asksForFixedTime(text)) {
      timeNoteOnly = true;
      trace.plannerSkipped = "booking_time_note";
      out.template("flow", BOOKING_TIME_NOTE);
    } else {
      try {
        const planned = await deps.plan(ctx);
        if (planned.call) trace.modelCalls.push(planned.call);
        const parsed = parseCommands(planned.commands);
        commands = parsed.valid;
        trace.rejected.push(...parsed.rejected);
      } catch (err) {
        trace.error = `planner: ${(err as Error).message}`;
        result.act = "error";
        out.template("error", T.technicalProblem(practice));
        return finish();
      }
    }
  }

  const { kept, dropped } = normaliseCommands(commands, ctx.flow);
  trace.rejected.push(...dropped);
  commands = kept;

  if (ctx.lastBotAct === "clarify" && text && commands.length > 0 && commands.every((c) => c.cmd === "clarify")) {
    trace.rejected.push(...commands.map((c) => ({ raw: c, error: "clarify straight after clarify" })));
    commands = [{ cmd: "answer_from_knowledge", query: text }];
    trace.guardrails.push({ rule: "no_double_clarify", result: "hit", detail: "answered the chosen option instead" });
  }

  if (!timeNoteOnly && commands.length === 0 && bookingStep && bookingStep !== "done" && bookingStep !== "change" && text) {
    const value = bookingStep === "confirm" ? yesNo(text) : text;
    if (value) {
      commands = [{ cmd: "set_slot", slot: bookingStep, value }];
      trace.guardrails.push({ rule: "slot_fallback", result: "hit", detail: `filled ${bookingStep} from visitor text` });
    }
  }
  trace.commands = commands.map((c) => ({ ...c }));

  let flow: FlowState | null = ctx.flow ? { ...ctx.flow, slots: { ...ctx.flow.slots } } : null;
  let flowTouched = false;
  let invalidSlot: string | null = null;

  for (const c of commands) {
    switch (c.cmd) {
      case "answer_from_knowledge":
        await answer(c.query);
        break;
      case "start_flow":
        flow = startBooking();
        flowTouched = true;
        break;
      case "set_slot": {
        if (!flow || flow.name !== "booking_request") break;
        const v = validateSlot(c.slot, c.value);
        flowTouched = true;
        if (v.ok) {
          flow = applyBookingSlot(flow, c.slot, v.value);
        } else {
          invalidSlot = c.slot;
          trace.guardrails.push({ rule: "slot_validation", result: "hit", detail: `${c.slot}: ${v.error}` });
        }
        break;
      }
      case "clarify": {
        const unsafe = c.options.find((o) => /[\d£]/.test(o));
        if (unsafe) {
          trace.guardrails.push({ rule: "clarify_options", result: "dropped", detail: unsafe });
          break;
        }
        result.act = "clarify";
        out.template("clarify", T.CLARIFY_LEAD, [], c.options);
        break;
      }
      case "cannot_handle":
        result.act = c.reason === "out_of_scope" ? "out_of_scope" : "cannot_handle";
        if (c.reason === "abusive") trace.guardrails.push({ rule: "abuse", result: "blocked" });
        out.template("cannot_handle", T.cannotHandle(practice, c.reason));
        break;
      case "handover":
        doHandover(c.reason, handoverTrigger);
        return finish();
    }
  }

  if (flow?.name === "booking_request") {
    if (flow.slots.confirm === "yes") {
      result.booking = { ...flow.slots };
      out.template("flow", bookingDone(flow.slots));
      flow = null;
      result.act = "flow_completed";
      result.topic ??= "flow:booking_request";
    } else if (flow.slots.confirm === "no") {
      const { confirm: _drop, ...rest } = flow.slots;
      flow = { ...flow, step: "change", slots: rest };
      out.template("flow", BOOKING_CHANGE_PROMPT);
      result.act = "flow";
    } else {
      const step = nextBookingStep(flow);
      if (step !== "done") {
        flow = { ...flow, step };
        const prompt = invalidSlot && invalidSlot === step && BOOKING_INVALID[step] ? BOOKING_INVALID[step]! : bookingPrompt(step, flow.slots);
        out.template("flow", prompt, [], bookingOptions(step));
        if (result.answered === 0 || flowTouched) result.act = "flow";
      }
      result.topic ??= "flow:booking_request";
    }
  }
  result.flow = flow;

  const answeredTotal = (ctx.answeredBefore ?? 0) + result.answered;
  if (!flow && result.act === "answered" && result.answered > 0 && mayOffer() && (answeredTotal >= 2 || VISIT_INTENT.test(text))) {
    trace.guardrails.push({ rule: "booking_offer", result: "hit", detail: answeredTotal >= 2 ? "second answer" : "visit question" });
    out.template("suggest", T.BOOKING_OFFER, [], T.OFFER_OPTIONS);
  }

  if (out.segments.length === 0) {
    result.act = "fallback";
    result.fallbacks += 1;
    out.template("fallback", T.dontKnow(practice));
  }
  return finish();

  function doHandover(reason: HandoverReason, trigger: "precheck" | "planner" | "visitor_button") {
    const sources = T.isUrgentReason(reason)
      ? bundle.handoverSources.urgent
      : reason === "clinical_advice"
        ? bundle.handoverSources.clinical
        : [];
    out.template("handover", T.handoverMessage(practice, reason), sources);
    const contact = startContact(knownContact(ctx.flow, text));
    if (contact.prompt) out.template("flow", contact.prompt, [], contact.options);
    result.handover = { reason, trigger };
    result.contact = { ...contact.flow.slots };
    result.status = "handed_over";
    result.flow = contact.flow;
    result.act = "handover";
    result.topic = `handover:${reason}`;
  }

  /** One gentle booking offer per conversation, and none once a booking or the team is involved. */
  function mayOffer() {
    return !ctx.bookingOffered && !ctx.flow;
  }

  function offerPending() {
    const lastBot = ctx.history.findLast((h) => h.role === "bot")?.text;
    return lastBot === T.BOOKING_OFFER || lastBot === T.ACKNOWLEDGE_WITH_OFFER;
  }

  async function answer(query: string) {
    const threshold = bundle.config.retrievalThreshold;
    const chunks = await deps.retrieve(query, bundle);
    const top = chunks[0];
    for (const c of chunks) {
      if (trace.retrieved.some((r) => r.chunkId === c.chunkId)) continue;
      trace.retrieved.push({
        chunkId: c.chunkId,
        page: c.page,
        heading: c.heading,
        score: round(c.score),
        keywordScore: round(c.keywordScore),
        used: c.score >= threshold ? "context" : "below_threshold",
      });
    }
    if (!top || top.score < threshold) {
      trace.guardrails.push({
        rule: "retrieval_threshold",
        result: "hit",
        detail: `${query}: top ${top ? round(top.score) : "none"} < ${threshold}`,
      });
      result.fallbacks += 1;
      out.template("fallback", T.dontKnow(practice));
      if (result.act === "answered") result.act = "fallback";
      return;
    }

    const context = chunks.filter((c) => c.score >= threshold - CONTEXT_MARGIN).slice(0, bundle.config.maxChunks);
    for (const r of trace.retrieved) {
      if (context.some((c) => c.chunkId === r.chunkId)) r.used = "context";
    }
    const composed = deps.compose(query, context, bundle);
    const splitter = new SentenceSplitter();
    let emitted = 0;
    let blocked = 0;
    let noAnswer = false;

    const handle = (raw: string) => {
      if (raw.trim().startsWith(NO_ANSWER)) {
        noAnswer = true;
        return;
      }
      // Citations only ever close a sentence, so earlier sentences in the same span are uncited.
      const pieces = raw.trim().split(/(?<=[.!?])\s+(?=[A-Z])/);
      for (const uncited of pieces.slice(0, -1)) {
        blocked += 1;
        trace.guardrails.push({ rule: "uncited_sentence", result: "dropped", detail: uncited.slice(0, 120) });
      }
      const s = parseSentence(pieces.at(-1)!);
      const cited = s.cites.map((i) => context[i - 1]).filter((c): c is ScoredChunk => Boolean(c));
      if (!s.text || s.text === ".") return;
      if (cited.length === 0) {
        blocked += 1;
        trace.guardrails.push({ rule: "uncited_sentence", result: "dropped", detail: s.text.slice(0, 120) });
        return;
      }
      const citedText = cited.map((c) => `${c.heading} ${c.text}`).join("\n");
      for (const check of [checkGrounding(s.text, citedText), clinicalOutputCheck(s.text)]) {
        if (!check.ok) {
          blocked += 1;
          trace.guardrails.push({ rule: check.rule, result: "dropped", detail: `${check.detail} in "${s.text.slice(0, 100)}"` });
          return;
        }
      }
      for (const c of cited) {
        const r = trace.retrieved.find((x) => x.chunkId === c.chunkId);
        if (r) r.used = "cited";
      }
      result.topic ??= `${cited[0]!.slug}#${cited[0]!.anchor}`;
      emitted += 1;
      out.sentence(s.text, cited.map(sourceOf));
    };

    try {
      for await (const delta of composed.stream) for (const s of splitter.push(delta)) handle(s);
      for (const s of splitter.flush()) handle(s);
      const call = await composed.done;
      if (call) trace.modelCalls.push(call);
    } catch (err) {
      trace.error = `compose: ${(err as Error).message}`;
    }
    out.close();

    if (emitted > 0) {
      result.answered += 1;
      trace.guardrails.push({ rule: "grounding", result: blocked ? "dropped" : "pass", detail: `${emitted} sentence(s) served` });
      return;
    }
    const topics = blocked === 0 ? topicOptions(query, chunks, threshold) : [];
    if (topics.length >= 2) {
      trace.guardrails.push({ rule: "topic_menu", result: "hit", detail: `${query}: ${topics.join(" · ")}` });
      if (result.act === "answered") result.act = "clarify";
      out.template("clarify", T.TOPIC_LEAD, [], topics);
      return;
    }
    result.fallbacks += 1;
    if (blocked > 0) {
      trace.guardrails.push({ rule: "grounding", result: "blocked", detail: `all ${blocked} sentence(s) failed checks` });
      result.act = "blocked";
    } else if (result.act === "answered") {
      result.act = "fallback";
    }
    if (noAnswer) trace.guardrails.push({ rule: "compose_no_answer", result: "hit", detail: query });
    out.template("fallback", T.dontKnow(practice));
  }
}

/** Section headings of the best-matching page, offered when a short query names a topic rather than a question. */
function topicOptions(query: string, chunks: ScoredChunk[], threshold: number): string[] {
  const top = chunks[0];
  if (!top || query.trim().split(/\s+/).length > TOPIC_MAX_WORDS) return [];
  const headings: string[] = [];
  for (const c of chunks) {
    if (c.page !== top.page || c.score < threshold - CONTEXT_MARGIN) continue;
    if (c.heading === c.page || /[\d£]/.test(c.heading) || headings.includes(c.heading)) continue;
    headings.push(c.heading);
  }
  return headings.slice(0, 4);
}

function nextStepOf(flow: FlowState) {
  if (flow.step === "change") return "change" as const;
  return nextBookingStep(flow);
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
