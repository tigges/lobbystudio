import type { FlowState, Source } from "@dental-bot/db/schema";
import { parseCommands, type Command, type HandoverReason } from "./commands.ts";
import { NO_ANSWER, parseSentence, SentenceSplitter } from "./compose.ts";
import type { BookedAppointment, OfferedSlot } from "../booking/types.ts";
import { wantedDays } from "../booking/when.ts";
import { packFor } from "../packs/index.ts";
import {
  applyBookingSlot,
  type BookingContext,
  bookingOptions,
  bookingPrompt,
  nextBookingStep,
  PART_OF_DAY,
  quickReplyValue,
  SLOT_STEP,
  startBooking,
  withDates,
} from "./flows/booking.ts";
import { BOOKING_SLOTS } from "./flows/booking-request.ts";
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
import { OPEN_NOW, openNowAnswer, parseHours } from "./hours.ts";
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
/** Practice-local time for "are you open now?" and for dating "tomorrow" in booking requests. */
const TIME_ZONE = "Europe/London";
/** A bill or payment question the team can only act on with a little more detail. */
const BILLING = /\b(?:bills?|invoices?|payments?|paid|pay|charged?|refunds?|receipts?|statements?|balance|direct debit)\b/i;
/** "prices", "how much?" and similar: a topic, answered with a short menu rather than a guess. */
const PRICE_TOPIC = /^(?:(?:your |the )?(?:prices?|costs?|fees?|charges?|price list)|how much(?: is it| does it cost| do you charge)?|what (?:are|do) (?:your|you) (?:prices|charge))[?.! ]*$/i;
/** Below this match score an answer must share a distinctive word with the question, so a near topic isn't served as the answer. */
const RELEVANCE_CHECK_BELOW = 0.75;
const GENERIC_WORDS = new Set(
  "about also anything appointment appointments available could dental dentist does doing have harbour help know like long make many much need offer offered offering please practice provide should tell that their there these they this treat treated treatment treatments what when where which will with would your youre".split(" "),
);
/** "None of these", "different time": the visitor turns down the times offered from the booking system. */
const NO_TIME_SUITS = /\b(?:none|neither|no(?:ne)? of (?:these|them|those)|don'?t (?:suit|work)|doesn'?t (?:suit|work)|other times?|different (?:time|day)|later|another day)\b/i;
/** Minimum notice for a booking made from the chat, so the salon isn't surprised by a walk-in minutes away. */
const MIN_NOTICE_HOURS = 2;
const PATCH_TEST_HOURS = 48;
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
  bookingSlots: readonly string[] = BOOKING_SLOTS,
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
    if (c.cmd === "set_slot" && (!bookingActive || !bookingSlots.includes(c.slot))) {
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
  const pack = packFor(bundle.vertical);
  const def = pack.booking;
  const bctx: BookingContext = { online: bundle.booking?.mode === "online" && Boolean(deps.booking && pack.online) };
  const out = new ReplyWriter(emit, now);

  const result: TurnResult = {
    segments: out.segments,
    flow: ctx.flow,
    status: ctx.status === "handed_over" ? "handed_over" : "active",
    handover: null,
    booking: null,
    bookedOnline: null,
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
    // Once someone from the team has replied, the visitor is talking to them: the bot asks nothing more.
    if (said && isCollectingContact(ctx.flow) && !ctx.teamReplied) {
      const step = collectContact(ctx.flow, said);
      result.flow = step.flow;
      if (step.changed) result.contact = { ...step.flow.slots };
      if (ctx.flow.step === "details" && pack.redFlags.test(said)) out.template("handover", pack.redFlagReminder);
      if (step.reply) out.template("flow", step.reply, [], step.options);
      trace.guardrails.push({ rule: "handover_contact", result: step.changed ? "hit" : "pass", detail: `${ctx.flow.step} → ${step.flow.step}` });
      return finish();
    }
    // Pressing a button, or writing before anyone from the team has replied, gets one acknowledgement
    // so the visitor isn't left wondering; once the team is talking, the bot stays out of the way.
    const waiting = pack.waitingForTeam(practice);
    const lastBot = ctx.history.findLast((h) => h.role === "bot")?.text;
    const teamReplied = ctx.teamReplied || ctx.history.some((h) => h.role === "staff");
    if (ctx.action || (!teamReplied && lastBot !== waiting)) out.template("acknowledge", waiting);
    return finish();
  }

  const text = ctx.visitorText?.trim() ?? "";
  let commands: Command[] = [];
  let handoverTrigger: "precheck" | "planner" | "visitor_button" = "planner";
  const bookingStep = ctx.flow?.name === "booking_request" ? nextStepOf(ctx.flow) : null;
  const timeChoice = bookingStep === SLOT_STEP && ctx.flow?.slots.slot_choice ? readTimeChoice(text) : null;
  const tappedTime = bookingStep === SLOT_STEP && ctx.flow ? pickTime(ctx.flow, text) : null;
  let timeNoteOnly = false;
  let rebook = false;

  if (ctx.action === "handover") {
    commands = [{ cmd: "handover", reason: "visitor_request" }];
    handoverTrigger = "visitor_button";
    trace.plannerSkipped = "exit_button";
  } else if (ctx.action === "book" || text.toLowerCase() === T.BOOK_OPTION.toLowerCase() || (offerPending() && yesNo(text) === "yes")) {
    rebook = ctx.flow?.name === "booking_request";
    commands = rebook ? [] : [{ cmd: "start_flow", flow: "booking_request" }];
    trace.plannerSkipped = ctx.action ? "exit_button" : "booking_offer";
  } else if (askTeamPending() && (text === T.ASK_TEAM_OPTIONS[0] || yesNo(text) === "yes")) {
    commands = [{ cmd: "handover", reason: "visitor_request" }];
    handoverTrigger = "visitor_button";
    trace.plannerSkipped = "ask_team_offer";
  } else {
    const pre = clinicalPrecheck(text, pack.precheck);
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
    } else if (timeChoice) {
      trace.plannerSkipped = "deterministic_option";
    } else if (tappedTime) {
      commands = [{ cmd: "set_slot", slot: SLOT_STEP, value: text }];
      trace.plannerSkipped = "deterministic_option";
    } else if (bookingStep && bookingStep !== "done" && bookingStep !== "change" && quickReplyValue(def, bookingStep, text) !== null) {
      commands = [{ cmd: "set_slot", slot: bookingStep, value: quickReplyValue(def, bookingStep, text)! }];
      trace.plannerSkipped = "deterministic_option";
    } else if ((offerPending() || askTeamPending() || askedAnythingElse()) && OFFER_DECLINE.test(text)) {
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
        out.template("suggest", pack.acknowledgeWithOffer, [], T.OFFER_OPTIONS);
      } else {
        out.template("acknowledge", T.ACKNOWLEDGE);
      }
      return finish();
    } else if (!ctx.flow && isGreeting(text)) {
      result.act = "acknowledged";
      trace.plannerSkipped = "greeting";
      out.template("acknowledge", T.GREET_BACK, [], pack.greetOptions);
      return finish();
    } else if (!bookingStep && OPEN_NOW.test(text) && (await openNow())) {
      return finish();
    } else if (!bookingStep && PRICE_TOPIC.test(text)) {
      result.act = "clarify";
      trace.plannerSkipped = "price_topic";
      const chunks = await deps.retrieve(pack.price.query, bundle);
      const page = chunks.find((c) => /price/i.test(c.page)) ?? chunks[0];
      out.template("clarify", pack.price.lead, page ? [sourceOf(page)] : [], pack.price.options);
      return finish();
    } else if (bookingStep && bookingStep !== "done" && bookingStep !== SLOT_STEP && asksForFixedTime(text)) {
      timeNoteOnly = true;
      trace.plannerSkipped = "booking_time_note";
      out.template("flow", def.timeNote);
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
        out.template("error", pack.technicalProblem(practice));
        return finish();
      }
    }
  }

  const { kept, dropped } = normaliseCommands(commands, ctx.flow, def.slots);
  trace.rejected.push(...dropped);
  commands = kept;

  if (ctx.lastBotAct === "clarify" && text && commands.length > 0 && commands.every((c) => c.cmd === "clarify")) {
    trace.rejected.push(...commands.map((c) => ({ raw: c, error: "clarify straight after clarify" })));
    commands = [{ cmd: "answer_from_knowledge", query: text }];
    trace.guardrails.push({ rule: "no_double_clarify", result: "hit", detail: "answered the chosen option instead" });
  }

  if (!timeNoteOnly && !timeChoice && commands.length === 0 && bookingStep && bookingStep !== "done" && bookingStep !== "change" && text) {
    const value = bookingStep === "confirm" ? yesNo(text) : text;
    if (value) {
      commands = [{ cmd: "set_slot", slot: bookingStep, value }];
      trace.guardrails.push({ rule: "slot_fallback", result: "hit", detail: `filled ${bookingStep} from visitor text` });
    }
  }
  trace.commands = commands.map((c) => ({ ...c }));

  let flow: FlowState | null = ctx.flow ? { ...ctx.flow, slots: { ...ctx.flow.slots } } : null;
  let flowTouched = false;
  let startedLead = "";
  let invalidSlot: string | null = null;
  let enquiry = false;

  if (timeChoice && flow) {
    const { slot_choice: _choice, offered: _offered, times_after: _after, ...slots } = flow.slots;
    flowTouched = true;
    if (timeChoice.kind === "call") {
      flow = applyBookingSlot(def, { ...flow, slots: { ...slots, offered: flow.slots.offered! } }, SLOT_STEP, "none");
    } else if (timeChoice.kind === "more") {
      const last = offeredTimes(flow).at(-1)?.start;
      flow = { ...flow, slots: last ? { ...slots, times_after: last } : slots };
    } else {
      const { preferred_time: _time, time_of_day: _part, ...rest } = slots;
      flow = { ...flow, slots: rest };
      if (timeChoice.value) flow = applyBookingSlot(def, flow, "preferred_time", withDates(timeChoice.value, new Date(now()), TIME_ZONE));
    }
  }

  for (const c of commands) {
    switch (c.cmd) {
      case "answer_from_knowledge":
        await answer(c.query);
        break;
      case "start_flow":
        flow = startBooking(def, def.prefill?.(knownTexts({ withOffer: offerPending() })));
        startedLead = Object.keys(flow.slots).length ? (def.startedWith?.(flow.slots) ?? "") : "";
        flowTouched = true;
        break;
      case "set_slot": {
        if (!flow || flow.name !== "booking_request") break;
        flowTouched = true;
        if (c.slot === SLOT_STEP) {
          const picked = pickTime(flow, c.value);
          if (picked === "none" && !flow.slots.slot_choice) {
            // Turning the times down first gets more times or another day, not straight to a call-back.
            flow = { ...flow, slots: { ...flow.slots, slot_choice: "pending" } };
          } else if (picked) {
            const { slot_choice: _choice, ...slots } = flow.slots;
            flow = applyBookingSlot(def, { ...flow, slots }, SLOT_STEP, picked === "none" ? "none" : picked.label);
            if (picked !== "none") flow.slots = { ...flow.slots, slot_id: picked.id, slot_start: picked.start };
          } else {
            invalidSlot = SLOT_STEP;
            trace.guardrails.push({ rule: "slot_validation", result: "hit", detail: `${SLOT_STEP}: not one of the times offered` });
          }
          break;
        }
        const v = def.validate(c.slot, c.value);
        if (v.ok) {
          const value = c.slot === "preferred_time" ? withDates(v.value, new Date(now()), TIME_ZONE) : v.value;
          flow = applyBookingSlot(def, flow, c.slot, value);
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
        out.template("cannot_handle", pack.cannotHandle(practice, c.reason), [], c.reason === "out_of_scope" ? pack.steerBackOptions : []);
        break;
      case "handover":
        doHandover(c.reason, handoverTrigger);
        return finish();
    }
  }

  if (enquiry && !flow) {
    doHandover("visitor_request", "planner", pack.enquiry!.message(practice));
    return finish();
  }

  if (flow?.name === "booking_request") {
    if (flow.slots.confirm === "yes") {
      const { offered: _offered, ...details } = flow.slots;
      result.booking = details;
      const booked = flow.slots.slot_id && pack.online ? await bookTime(flow) : null;
      result.bookedOnline = booked;
      out.template(
        "flow",
        booked ? pack.online!.booked(flow.slots, practice) : flow.slots.slot_id && pack.online ? pack.online.failed(flow.slots) : def.done(flow.slots),
      );
      flow = null;
      result.act = "flow_completed";
      result.topic ??= "flow:booking_request";
    } else if (flow.slots.confirm === "no") {
      const { confirm: _drop, ...rest } = flow.slots;
      flow = { ...flow, step: "change", slots: rest };
      out.template("flow", def.changePrompt);
      result.act = "flow";
    } else {
      let step = nextBookingStep(def, flow, bctx);
      if (step === SLOT_STEP && !flow.slots.offered) {
        const times = await findTimes(flow);
        if (times.length) {
          flow = { ...flow, slots: { ...flow.slots, offered: JSON.stringify(times) } };
        } else {
          out.template("flow", pack.online!.noTimes);
          flow = applyBookingSlot(def, flow, SLOT_STEP, "none");
          step = nextBookingStep(def, flow, bctx);
        }
      }
      if (step !== "done") {
        flow = { ...flow, step };
        const invalid = invalidSlot !== null && invalidSlot === step && (step === SLOT_STEP || Boolean(def.invalid[step]));
        const context = def.contextQuery[step];
        if (context && !invalid && !rebook) await answer(context, { quiet: true });
        const choosing = step === SLOT_STEP && Boolean(flow.slots.slot_choice);
        const ask = choosing ? pack.online!.moreTimes : step === SLOT_STEP ? pack.online!.slotPrompt(flow.slots) : bookingPrompt(def, step, flow.slots);
        const prompt = invalid
          ? step === SLOT_STEP
            ? choosing
              ? pack.online!.moreTimes
              : pack.online!.slotInvalid
            : def.invalid[step]!
          : rebook && step === "confirm"
            ? def.ready
            : `${rebook ? `${def.continue} ` : ""}${startedLead ? `${startedLead} ` : ""}${ask}`;
        const options = choosing ? TIME_CHOICES : step === SLOT_STEP ? timeOptions(flow) : bookingOptions(def, step);
        out.template("flow", prompt, [], options);
        if (result.answered === 0 || flowTouched) result.act = "flow";
      }
      result.topic ??= "flow:booking_request";
    }
  }
  result.flow = flow;

  const answeredTotal = (ctx.answeredBefore ?? 0) + result.answered;
  if (!flow && result.act === "answered" && result.answered > 0) {
    const followUp = pack.followUp?.({ headings: citedHeadings(), slots: def.prefill?.(knownTexts()) ?? {} }) ?? null;
    if (followUp && mayFollowUp(followUp)) {
      trace.guardrails.push({ rule: "booking_offer", result: "hit", detail: "follow-up" });
      out.template("suggest", followUp, [], T.OFFER_OPTIONS);
    } else if (mayOffer() && (answeredTotal >= 2 || pack.visitIntent.test(text))) {
      trace.guardrails.push({ rule: "booking_offer", result: "hit", detail: answeredTotal >= 2 ? "second answer" : "visit question" });
      out.template("suggest", pack.bookingOffer, [], T.OFFER_OPTIONS);
    }
  }

  if (out.segments.length === 0) {
    result.act = "fallback";
    result.fallbacks += 1;
    out.template("fallback", T.dontKnow(practice), [], T.ASK_TEAM_OPTIONS);
  }
  return finish();

  function doHandover(reason: HandoverReason, trigger: "precheck" | "planner" | "visitor_button", message = pack.handoverMessage(practice, reason)) {
    const sources = T.isUrgentReason(reason)
      ? bundle.handoverSources.urgent
      : reason === "clinical_advice"
        ? bundle.handoverSources.clinical
        : [];
    out.template("handover", message, sources);
    const details =
      trigger === "visitor_button"
        ? null
        : T.isUrgentReason(reason)
          ? pack.urgentDetails
          : reason === "visitor_request" && BILLING.test(text)
            ? pack.billingDetails
            : null;
    const contact = startContact(knownContact(ctx.flow, text), details);
    if (contact.prompt) out.template("flow", contact.prompt, [], contact.options);
    result.handover = { reason, trigger };
    result.contact = { ...contact.flow.slots };
    result.status = "handed_over";
    result.flow = contact.flow;
    result.act = "handover";
    result.topic = `handover:${reason}`;
  }

  /** A service the content doesn't cover goes to the team with contact details; the handover is made once the commands have run. */
  function asksTeamEnquiry(query: string) {
    if (!pack.enquiry || !(pack.enquiry.pattern.test(query) || pack.enquiry.pattern.test(text))) return false;
    trace.guardrails.push({ rule: "enquiry_handover", result: "hit", detail: query });
    enquiry = true;
    return true;
  }

  /** One gentle booking offer per conversation, and none once a booking or the team is involved. */
  function mayOffer() {
    return !ctx.bookingOffered && !ctx.flow;
  }

  /** A follow-up may come after an earlier offer the visitor let pass, but not after "Not right now", and never twice. */
  function mayFollowUp(offer: string) {
    if (ctx.flow || ctx.bookingClosed) return false;
    return !ctx.history.some((h) => h.role === "bot" && (h.text === offer || h.text === T.OFFER_DECLINED));
  }

  function citedHeadings() {
    return [...new Set(out.segments.filter((s) => s.kind === "answer").flatMap((s) => s.sources.map((src) => src.heading)))];
  }

  /** What the visitor has said in this chat, oldest first, plus the offer they're accepting. */
  function knownTexts({ withOffer = false } = {}) {
    const texts = ctx.history.filter((h) => h.role === "visitor").map((h) => h.text);
    const lastBot = ctx.history.findLast((h) => h.role === "bot");
    if (withOffer && lastBot) texts.push(lastBot.text);
    if (text) texts.push(text);
    return texts;
  }

  function askedAnythingElse() {
    return /anything else I can help with(?: before your visit)?\?$/.test(ctx.history.findLast((h) => h.role === "bot")?.text ?? "");
  }

  function askTeamPending() {
    const lastBot = ctx.history.findLast((h) => h.role === "bot")?.text;
    return lastBot === T.dontKnow(practice);
  }

  /** Answers from the published opening hours and the practice clock; false when the hours can't be read. */
  async function openNow(): Promise<boolean> {
    const chunks = await deps.retrieve("opening hours", bundle);
    const hoursChunk = chunks.find((c) => /opening hours/i.test(c.heading) && Object.keys(parseHours(c.text)).length >= 5);
    const reply = hoursChunk ? openNowAnswer(parseHours(hoursChunk.text), new Date(now()), TIME_ZONE) : null;
    if (!hoursChunk || !reply) return false;
    trace.plannerSkipped = "open_now";
    trace.guardrails.push({ rule: "open_now", result: "hit", detail: reply });
    out.template("answer", reply, [sourceOf(hoursChunk)]);
    result.answered += 1;
    result.topic ??= `${hoursChunk.slug}#${hoursChunk.anchor}`;
    return true;
  }

  function offerPending() {
    const lastBot = ctx.history.findLast((h) => h.role === "bot");
    return lastBot?.kind === "suggest" || lastBot?.text === pack.bookingOffer || lastBot?.text === pack.acknowledgeWithOffer;
  }

  function nextStepOf(f: FlowState) {
    if (f.step === "change") return "change" as const;
    return nextBookingStep(def, f, bctx);
  }

  /** Free times from the booking system for what the visitor asked for; none when it can't be reached. */
  async function findTimes(f: FlowState): Promise<OfferedSlot[]> {
    const system = deps.booking!;
    const hours = f.slots.patch_test === "needed" ? PATCH_TEST_HOURS : MIN_NOTICE_HOURS;
    try {
      const times = await system.availability({
        service: f.slots.service ?? "",
        stylist: f.slots.stylist ?? null,
        earliest: new Date(Math.max(now() + hours * 3_600_000, f.slots.times_after ? Date.parse(f.slots.times_after) + 60_000 : 0)),
        preferredTime: f.slots.preferred_time ?? null,
        partOfDay: f.slots.time_of_day ?? null,
        timeZone: TIME_ZONE,
      });
      trace.guardrails.push({ rule: "booking_system", result: times.length ? "pass" : "hit", detail: `${system.name}: ${times.length} free time(s)` });
      return times.slice(0, 3);
    } catch (err) {
      trace.guardrails.push({ rule: "booking_system", result: "hit", detail: `${system.name} availability failed: ${(err as Error).message}` });
      return [];
    }
  }

  async function bookTime(f: FlowState): Promise<BookedAppointment | null> {
    const system = deps.booking;
    const slot = offeredTimes(f).find((o) => o.id === f.slots.slot_id);
    if (!system || !slot) return null;
    const note = [
      "Booked by the website assistant.",
      f.slots.length ? `Hair: ${f.slots.length}.` : "",
      f.slots.patch_test === "needed" ? "Patch test needed at least 48 hours before." : "",
    ]
      .filter(Boolean)
      .join(" ");
    try {
      const booked = await system.book({ slot, service: f.slots.service ?? "", client: { name: f.slots.name ?? "", phone: f.slots.phone ?? "" }, note });
      trace.guardrails.push({ rule: "booking_system", result: "pass", detail: `${system.name}: booked ${booked.ref}` });
      return booked;
    } catch (err) {
      trace.guardrails.push({ rule: "booking_system", result: "hit", detail: `${system.name} booking failed: ${(err as Error).message}` });
      return null;
    }
  }

  /** `quiet` serves the answer only if one is found, for context inside a flow, where a fallback would interrupt it. */
  async function answer(query: string, { quiet = false } = {}) {
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
      if (quiet) return;
      trace.guardrails.push({
        rule: "retrieval_threshold",
        result: "hit",
        detail: `${query}: top ${top ? round(top.score) : "none"} < ${threshold}`,
      });
      if (asksTeamEnquiry(query)) return;
      result.fallbacks += 1;
      out.template("fallback", T.dontKnow(practice), [], T.ASK_TEAM_OPTIONS);
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
      if (top.score < RELEVANCE_CHECK_BELOW && !sharesTopic(query, citedText)) {
        blocked += 1;
        trace.guardrails.push({ rule: "off_topic", result: "dropped", detail: `"${query}" vs ${cited[0]!.heading}` });
        return;
      }
      for (const check of [checkGrounding(s.text, citedText), clinicalOutputCheck(s.text, pack.unsafeOutput)]) {
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
    if (quiet) return;
    const topics = blocked === 0 ? topicOptions(query, chunks, threshold) : [];
    if (topics.length >= 2) {
      trace.guardrails.push({ rule: "topic_menu", result: "hit", detail: `${query}: ${topics.join(" · ")}` });
      if (result.act === "answered") result.act = "clarify";
      out.template("clarify", T.TOPIC_LEAD, [], topics);
      return;
    }
    if (blocked === 0 && asksTeamEnquiry(query)) return;
    result.fallbacks += 1;
    if (blocked > 0) {
      trace.guardrails.push({ rule: "grounding", result: "blocked", detail: `all ${blocked} sentence(s) failed checks` });
      result.act = "blocked";
    } else if (result.act === "answered") {
      result.act = "fallback";
    }
    if (noAnswer) trace.guardrails.push({ rule: "compose_no_answer", result: "hit", detail: query });
    out.template("fallback", T.dontKnow(practice), [], T.ASK_TEAM_OPTIONS);
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

/** True when the question has no distinctive words, or at least one of them appears in the cited text. */
export function sharesTopic(query: string, citedText: string): boolean {
  const words = query.toLowerCase().replace(/[’']/g, "").match(/[a-z][a-z-]{3,}/g) ?? [];
  const distinctive = words.filter((w) => !GENERIC_WORDS.has(w));
  if (distinctive.length === 0) return true;
  const haystack = citedText.toLowerCase();
  return distinctive.some((w) => haystack.includes(w.length > 5 ? w.slice(0, 5) : w));
}

function offeredTimes(flow: FlowState): OfferedSlot[] {
  try {
    return flow.slots.offered ? (JSON.parse(flow.slots.offered) as OfferedSlot[]) : [];
  } catch {
    return [];
  }
}

function timeOptions(flow: FlowState): string[] {
  const offered = offeredTimes(flow);
  return offered.length ? [...offered.map((o) => o.label), NONE_OF_THESE] : [];
}

export const NONE_OF_THESE = "None of these suit me";

export const MORE_TIMES = "Show more times";
export const OTHER_DAY = "A different day";
export const CALL_ME = "Ask the team to call me";
const TIME_CHOICES = [MORE_TIMES, OTHER_DAY, CALL_ME];

/** After "none of these suit me": more times, another day (perhaps already named), or a call-back. */
export function readTimeChoice(text: string): { kind: "more" } | { kind: "call" } | { kind: "day"; value: string | null } | null {
  const t = text.trim();
  if (!t) return null;
  if (t === CALL_ME || /\b(?:call|ring|phone) me\b|\bcall ?back\b|\bthe team\b/i.test(t)) return { kind: "call" };
  if (t === OTHER_DAY || /^(?:an? )?(?:different|another|other) (?:day|date|time)s?[.!]?$/i.test(t)) return { kind: "day", value: null };
  if (wantedDays(t) || /\b(?:next week|week after|weekend)\b/i.test(t) || (PART_OF_DAY.test(t) && !/\bmore\b/i.test(t))) {
    return { kind: "day", value: t.replace(/\b(?:instead|please|then|how about|what about|maybe)\b/gi, "").replace(/\s+/g, " ").replace(/^[\s,?]+|[\s,?.!]+$/g, "") || t };
  }
  if (t === MORE_TIMES || /\b(?:more|later|next|others?|any (?:other|more))\b/i.test(t)) return { kind: "more" };
  return null;
}

/** "1", "the second one", "last": a choice by position, when the visitor doesn't repeat the time. */
const ORDINALS = [
  /^(?:the )?(?:1|1st|first|top)(?: one| time)?(?: please)?[.!]?$/,
  /^(?:the )?(?:2|2nd|second|middle)(?: one| time)?(?: please)?[.!]?$/,
  /^(?:the )?(?:3|3rd|third)(?: one| time)?(?: please)?[.!]?$/,
  /^(?:the )?(?:last)(?: one| time)?(?: please)?[.!]?$/,
];

/** The offered time the visitor chose, "none" when none suit, or null when it isn't clear. */
export function pickTime(flow: FlowState, text: string): OfferedSlot | "none" | null {
  const offered = offeredTimes(flow);
  const t = text.trim().toLowerCase();
  if (!t || offered.length === 0) return null;
  const exact = offered.find((o) => o.label.toLowerCase() === t);
  if (exact) return exact;
  if (t === NONE_OF_THESE.toLowerCase() || NO_TIME_SUITS.test(t)) return "none";
  const nth = ORDINALS.findIndex((re) => re.test(t));
  if (nth >= 0) return (nth === 3 ? offered.at(-1) : offered[nth]) ?? null;
  const words = t.match(/[a-z0-9:]+/g)?.filter((w) => w.length > 1 && !["with", "the", "at", "on", "please", "one", "that", "ok"].includes(w)) ?? [];
  if (words.length === 0) return null;
  const matches = offered.filter((o) => words.every((w) => o.label.toLowerCase().includes(w)));
  return matches.length === 1 ? matches[0]! : null;
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
