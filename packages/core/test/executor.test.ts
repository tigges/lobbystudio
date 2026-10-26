import { describe, expect, it } from "vitest";
import { normaliseCommands, runExecutor } from "../src/runtime/executor.ts";
import { validateSlot } from "../src/runtime/flows/booking-request.ts";
import { offlineCompose, onlyAskedFor } from "../src/runtime/offline.ts";
import * as T from "../src/runtime/templates.ts";
import type { ExecutorEvent, ScoredChunk } from "../src/runtime/types.ts";
import { bundle, ctx, fakeDeps, fillingChunk, hoursChunk, hygieneChunk } from "./fixtures.ts";

describe("hard rules", () => {
  it.each([
    ["my tooth really hurts", "pain_or_symptoms", /how bad is the pain/],
    ["my face is swollen", "pain_or_symptoms", /how bad is the pain/],
    ["it's an emergency", "emergency", /how bad is the pain/],
    ["what painkiller should I take?", "clinical_advice", /what's your name/],
  ])("hands over %j without calling the planner", async (text, reason, nextQuestion) => {
    const { deps, calls } = fakeDeps({ commands: [{ cmd: "answer_from_knowledge", query: text }] });
    const r = await runExecutor(ctx({ visitorText: text }), deps);
    expect(calls.plan).toBe(0);
    expect(r.act).toBe("handover");
    expect(r.status).toBe("handed_over");
    expect(r.handover).toEqual({ reason, trigger: "precheck" });
    expect(r.trace.guardrails[0]).toMatchObject({ rule: "clinical_precheck", result: "hit" });
    expect(r.segments).toHaveLength(2);
    expect(r.segments[0]!.text).toContain(bundle.practice.phone);
    expect(r.segments[1]!.text).toMatch(nextQuestion);
  });

  it("gives 999 and A&E advice with the emergencies page as the source for urgent handovers", async () => {
    const { deps } = fakeDeps();
    const r = await runExecutor(ctx({ visitorText: "bleeding won't stop" }), deps);
    expect(r.segments[0]!.text).toMatch(/999 or go to A&E/);
    expect(r.segments[0]!.text).toMatch(/NHS 111/);
    expect(r.segments[0]!.sources.map((s) => s.slug)).toEqual(["emergencies"]);
  });

  it("handover from the planner supersedes every other command", async () => {
    const { deps, calls } = fakeDeps({
      commands: [
        { cmd: "answer_from_knowledge", query: "prices" },
        { cmd: "handover", reason: "complaint" },
      ],
    });
    const r = await runExecutor(ctx({ visitorText: "I want to complain about my bill" }), deps);
    expect(calls.retrieve).toEqual([]);
    expect(r.act).toBe("handover");
    expect(r.handover).toEqual({ reason: "complaint", trigger: "planner" });
    expect(r.trace.rejected).toHaveLength(1);
  });

  it("only acknowledges once the conversation is handed over, then stays quiet while the team talks", async () => {
    const { deps, calls } = fakeDeps();
    const first = await runExecutor(ctx({ visitorText: "hello?", status: "handed_over" }), deps);
    expect(calls.plan).toBe(0);
    expect(first.act).toBe("waiting");
    expect(first.segments.map((s) => s.text)).toEqual([expect.stringMatching(/has your message/)]);

    const again = await runExecutor(
      ctx({ visitorText: "anyone?", status: "handed_over", history: [{ role: "bot", text: first.segments[0]!.text }] }),
      deps,
    );
    expect(again.segments).toEqual([]);

    const talking = await runExecutor(
      ctx({ visitorText: "yes Wednesday works", status: "handed_over", history: [{ role: "staff", text: "Could you do Wednesday?" }] }),
      deps,
    );
    expect(talking.segments).toEqual([]);

    const button = await runExecutor(ctx({ visitorText: null, action: "book", status: "handed_over", history: [{ role: "staff", text: "Hi" }] }), deps);
    expect(button.segments).toHaveLength(1);
  });

  it("the talk-to-the-practice exit hands over without the planner", async () => {
    const { deps, calls } = fakeDeps();
    const r = await runExecutor(ctx({ visitorText: null, action: "handover" }), deps);
    expect(calls.plan).toBe(0);
    expect(r.handover).toEqual({ reason: "visitor_request", trigger: "visitor_button" });
  });
});

describe("answer_from_knowledge", () => {
  it("streams a grounded answer with its source", async () => {
    const { deps } = fakeDeps({
      commands: [{ cmd: "answer_from_knowledge", query: "hygienist price" }],
      // Under the confident margin, so the planner is asked.
      chunks: [{ ...hygieneChunk, score: 0.75 }],
      composed: "A 30-minute hygienist appointment is £75 [1].",
    });
    const events: ExecutorEvent[] = [];
    const r = await runExecutor(ctx({ visitorText: "how much is the hygienist", bookingOffered: true, bookingClosed: true }), deps, (e) => events.push(e));
    expect(r.act).toBe("answered");
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]).toMatchObject({ kind: "answer", text: "A 30-minute hygienist appointment is £75." });
    expect(r.segments[0]!.sources[0]).toMatchObject({ slug: "treatments", anchor: "check-ups-and-hygiene" });
    expect(events.map((e) => e.type)).toEqual(["segment_start", "delta", "segment_end"]);
    expect(r.topic).toBe("treatments#check-ups-and-hygiene");
    expect(r.trace.retrieved[0]).toMatchObject({ chunkId: 11, used: "cited" });
    expect(r.trace.modelCalls.map((c) => c.role)).toEqual(["planner", "compose"]);
    expect(r.trace.firstTokenMs).toBeGreaterThan(0);
  });

  it("says it does not know, with the phone number, below the relevancy threshold", async () => {
    const { deps, calls } = fakeDeps({
      commands: [{ cmd: "answer_from_knowledge", query: "botox" }],
      chunks: [{ ...hygieneChunk, score: 0.5 }],
    });
    const r = await runExecutor(ctx({ visitorText: "do you do botox" }), deps);
    expect(calls.compose).toEqual([]);
    expect(r.act).toBe("fallback");
    expect(r.segments[0]!.kind).toBe("fallback");
    expect(r.segments[0]!.text).toContain("020 7946 0321");
    expect(r.trace.guardrails).toContainEqual(expect.objectContaining({ rule: "retrieval_threshold", result: "hit" }));
    expect(r.trace.retrieved[0]!.used).toBe("below_threshold");
  });

  it("drops a sentence whose price is not in the cited chunk", async () => {
    const { deps } = fakeDeps({
      commands: [{ cmd: "answer_from_knowledge", query: "hygienist price" }],
      chunks: [hygieneChunk],
      composed: "A hygienist appointment is £65 [1]. It lasts 30 minutes [1].",
    });
    const r = await runExecutor(ctx({ visitorText: "hygienist?", bookingClosed: true }), deps);
    expect(r.segments.map((s) => s.text)).toEqual(["It lasts 30 minutes."]);
    expect(r.trace.guardrails).toContainEqual(expect.objectContaining({ rule: "ungrounded_number", result: "dropped" }));
  });

  it("drops a price that loses its \"from\" qualifier", async () => {
    const { deps } = fakeDeps({
      commands: [{ cmd: "answer_from_knowledge", query: "filling price" }],
      chunks: [fillingChunk],
      composed: "A white filling costs £140 [1].",
    });
    const r = await runExecutor(ctx({ visitorText: "how much is a filling" }), deps);
    expect(r.act).toBe("blocked");
    expect(r.segments[0]!.kind).toBe("fallback");
    expect(r.trace.guardrails).toContainEqual(expect.objectContaining({ rule: "price_qualifier" }));
  });

  it("keeps a \"from\" price that is qualified", async () => {
    const { deps } = fakeDeps({
      commands: [{ cmd: "answer_from_knowledge", query: "filling price" }],
      chunks: [fillingChunk],
      composed: "White fillings start from £140 [1].",
    });
    const r = await runExecutor(ctx({ visitorText: "how much is a filling" }), deps);
    expect(r.act).toBe("answered");
    expect(r.segments[0]!.text).toBe("White fillings start from £140.");
  });

  it("drops uncited sentences and clinical advice", async () => {
    const { deps } = fakeDeps({
      commands: [{ cmd: "answer_from_knowledge", query: "hygienist" }],
      chunks: [hygieneChunk],
      composed: "Brushing twice a day helps. You should take ibuprofen first [1]. Hygienist visits are 30 minutes [1].",
    });
    const r = await runExecutor(ctx({ visitorText: "hygienist", bookingClosed: true }), deps);
    expect(r.segments.map((s) => s.text)).toEqual(["Hygienist visits are 30 minutes."]);
    const rules = r.trace.guardrails.map((g) => g.rule);
    expect(rules).toContain("uncited_sentence");
    expect(rules).toContain("clinical_output");
  });

  it("falls back when compose says the extracts do not answer", async () => {
    const { deps } = fakeDeps({
      commands: [{ cmd: "answer_from_knowledge", query: "dogs" }],
      chunks: [hygieneChunk],
      composed: "NO_ANSWER",
    });
    const r = await runExecutor(ctx({ visitorText: "can I bring my dog" }), deps);
    expect(r.act).toBe("fallback");
    expect(r.segments.map((s) => s.kind)).toEqual(["fallback"]);
  });

  it("answers two questions in one turn with separate sources", async () => {
    const { deps } = fakeDeps({
      commands: [
        { cmd: "answer_from_knowledge", query: "hygienist price" },
        { cmd: "answer_from_knowledge", query: "saturday hours" },
      ],
      chunks: { "hygienist price": [hygieneChunk], "saturday hours": [hoursChunk] },
      composed: (q) => (q.includes("hygienist") ? "It is £75 [1]." : "On Saturday we open 9am to 1pm [1]."),
    });
    const r = await runExecutor(ctx({ visitorText: "price and saturday?", bookingOffered: true, bookingClosed: true }), deps);
    expect(r.answered).toBe(2);
    expect(r.segments.map((s) => s.sources[0]!.slug)).toEqual(["treatments", "contact"]);
  });
});

describe("booking_request flow", () => {
  it("runs the slots in order and creates a booking request on confirmation", async () => {
    let flow = null as ReturnType<typeof ctx>["flow"];
    const steps: [string | null, "book" | null, unknown[], RegExp][] = [
      [null, "book", [], /What would you like to book/],
      ["Check-up", null, [], /new to the practice/],
      ["New patient", null, [], /NHS or private/],
      ["NHS", null, [], /child under 18/],
      ["Join the waiting list", null, [], /days or times/],
      ["tuesday evenings", null, [{ cmd: "set_slot", slot: "preferred_time", value: "tuesday evenings" }], /what name/],
      ["‹NAME_1›", null, [{ cmd: "set_slot", slot: "name", value: "‹NAME_1›" }], /phone number/],
      ["‹PHONE_1›", null, [{ cmd: "set_slot", slot: "phone", value: "‹PHONE_1›" }], /Shall I send this/],
    ];
    for (const [text, action, commands, prompt] of steps) {
      const { deps } = fakeDeps({ commands });
      const r = await runExecutor(ctx({ visitorText: text, action, flow, profile: {} }), deps);
      expect(r.segments.at(-1)!.text).toMatch(prompt);
      flow = r.flow;
    }
    expect(flow?.slots).toEqual({
      reason: "Check-up",
      name: "‹NAME_1›",
      phone: "‹PHONE_1›",
      patient: "new",
      care: "NHS",
      nhs_route: "waiting list",
      preferred_time: "tuesday evenings",
    });

    const { deps, calls } = fakeDeps();
    const done = await runExecutor(ctx({ visitorText: "yes please", flow }), deps);
    expect(calls.plan).toBe(0);
    expect(done.act).toBe("flow_completed");
    expect(done.booking).toMatchObject({ phone: "‹PHONE_1›", confirm: "yes" });
    expect(done.flow).toBeNull();
    expect(done.segments[0]!.text).toContain("‹PHONE_1›");
  });

  it("re-asks when the phone number is invalid", async () => {
    const flow = { name: "booking_request" as const, step: "phone", slots: { reason: "Check-up", patient: "new", care: "NHS", nhs_route: "child", preferred_time: "mornings", name: "‹NAME_1›" } };
    const { deps } = fakeDeps({ commands: [{ cmd: "set_slot", slot: "phone", value: "12345" }] });
    const r = await runExecutor(ctx({ visitorText: "12345", flow }), deps);
    expect(r.segments[0]!.text).toMatch(/doesn't look like a UK phone number/);
    expect(r.flow?.slots.phone).toBeUndefined();
    expect(r.trace.guardrails).toContainEqual(expect.objectContaining({ rule: "slot_validation" }));
  });

  it("lets the visitor change a detail when they decline the summary", async () => {
    const flow = {
      name: "booking_request" as const,
      step: "confirm",
      slots: { reason: "Check-up", name: "‹NAME_1›", phone: "‹PHONE_1›", patient: "existing", care: "private", preferred_time: "mornings" },
    };
    const { deps } = fakeDeps();
    const r = await runExecutor(ctx({ visitorText: "no", flow }), deps);
    expect(r.flow?.step).toBe("change");
    expect(r.segments[0]!.text).toMatch(/Which detail/);

    const { deps: deps2 } = fakeDeps({ commands: [{ cmd: "set_slot", slot: "preferred_time", value: "afternoons" }] });
    const r2 = await runExecutor(ctx({ visitorText: "afternoons instead", flow: r.flow }), deps2);
    expect(r2.flow?.slots.preferred_time).toBe("afternoons");
    expect(r2.segments.at(-1)!.text).toMatch(/Shall I send this/);
  });

  it("answers a side question mid-flow, then repeats the current step", async () => {
    const flow = { name: "booking_request" as const, step: "phone", slots: { reason: "Check-up", patient: "new", care: "NHS", nhs_route: "child", preferred_time: "mornings", name: "‹NAME_1›" } };
    const { deps } = fakeDeps({
      commands: [{ cmd: "answer_from_knowledge", query: "saturday hours" }],
      chunks: [hoursChunk],
      composed: "On Saturday we open 9am to 1pm [1].",
    });
    const r = await runExecutor(ctx({ visitorText: "are you open saturday?", flow }), deps);
    expect(r.segments.map((s) => s.kind)).toEqual(["answer", "flow"]);
    expect(r.segments[1]!.text).toMatch(/phone number/);
  });

  it("explains that times are agreed by phone, then returns to the summary", async () => {
    const flow = {
      name: "booking_request" as const,
      step: "change",
      slots: {
        reason: "Check-up",
        name: "‹NAME_1›",
        phone: "‹PHONE_1›",
        patient: "new",
        care: "NHS",
        nhs_route: "child",
        preferred_time: "tomorrow",
        time_of_day: "morning",
      },
    };
    const { deps, calls } = fakeDeps({ commands: [{ cmd: "handover", reason: "visitor_request" }] });
    const r = await runExecutor(ctx({ visitorText: "I want a date/time confirmation for my appointment", flow }), deps);
    expect(calls.plan).toBe(0);
    expect(r.handover).toBeNull();
    expect(r.segments.map((s) => s.text)).toEqual([expect.stringMatching(/can't confirm a date or time/), expect.stringMatching(/Shall I send this/)]);
    expect(r.flow?.slots.preferred_time).toBe("tomorrow");
  });

  it("fills the expected slot from the visitor text when the planner emits nothing", async () => {
    const flow = { name: "booking_request" as const, step: "preferred_time", slots: { reason: "Check-up", name: "A", phone: "‹PHONE_1›", patient: "new", care: "not sure" } };
    const { deps } = fakeDeps({ commands: [] });
    const r = await runExecutor(ctx({ visitorText: "weekday mornings", flow }), deps);
    expect(r.flow?.slots.preferred_time).toBe("weekday mornings");
    expect(r.trace.guardrails).toContainEqual(expect.objectContaining({ rule: "slot_fallback" }));
  });

  it("does not take an answer to another question as a name", async () => {
    const flow = { name: "booking_request" as const, step: "name", slots: { reason: "Check-up", patient: "new", care: "NHS", nhs_route: "child", preferred_time: "mornings" } };
    const { deps } = fakeDeps({ commands: [{ cmd: "set_slot", slot: "name", value: "Routine check-up" }] });
    const r = await runExecutor(ctx({ visitorText: "Routine check-up", flow }), deps);
    expect(r.flow?.slots.name).toBeUndefined();
    expect(r.segments[0]!.text).toMatch(/didn't catch your name/);
    expect(validateSlot("name", "Sam Taylor")).toEqual({ ok: true, value: "Sam Taylor" });
    expect(validateSlot("name", "Tuesday evening").ok).toBe(false);
  });
});

describe("contact details after a handover", () => {
  const handedOver = (flow: { step: string; slots: Record<string, string> }) =>
    ctx({ status: "handed_over", flow: { name: "handover", ...flow } });

  it("asks for a name, then a phone number, then confirms", async () => {
    const { deps } = fakeDeps();
    const start = await runExecutor(ctx({ visitorText: null, action: "handover" }), deps);
    expect(start.flow).toMatchObject({ name: "handover", step: "name" });

    const named = await runExecutor({ ...handedOver(start.flow!), visitorText: "‹NAME_1›" }, deps);
    expect(named.segments[0]!.text).toMatch(/phone number/);
    expect(named.contact).toEqual({ name: "‹NAME_1›" });

    const done = await runExecutor({ ...handedOver(named.flow!), visitorText: "07700 900123" }, deps);
    expect(done.flow?.step).toBe("waiting");
    expect(done.contact).toEqual({ name: "‹NAME_1›", phone: "07700 900123" });
    expect(done.segments[0]!.text).toMatch(/call you on 07700 900123/);
    expect(done.status).toBe("handed_over");
  });

  it("reuses details from a booking in progress and a number typed in the message", async () => {
    const { deps } = fakeDeps();
    const booking = { name: "booking_request" as const, step: "patient", slots: { reason: "Check-up", name: "‹NAME_1›" } };
    const r = await runExecutor(ctx({ visitorText: "my tooth really hurts, call me on ‹PHONE_1›", flow: booking }), deps);
    expect(r.contact).toEqual({ name: "‹NAME_1›", phone: "‹PHONE_1›" });
    expect(r.flow?.step).toBe("details");
    expect(r.segments[1]!.text).toMatch(/how bad is the pain/);

    const told = await runExecutor({ ...handedOver(r.flow!), visitorText: "about 7, no swelling" }, deps);
    expect(told.flow).toMatchObject({ step: "waiting", slots: { details: "about 7, no swelling" } });
    expect(told.segments.map((s) => s.text)).toEqual([expect.stringMatching(/added that for the team/)]);
  });

  it("stops asking when the visitor declines, and stays quiet for longer messages to the team", async () => {
    const { deps } = fakeDeps();
    const declined = await runExecutor({ ...handedOver({ step: "name", slots: {} }), visitorText: "no thanks" }, deps);
    expect(declined.flow?.step).toBe("waiting");

    const message = await runExecutor(
      { ...handedOver({ step: "name", slots: {} }), visitorText: "it started hurting last night after dinner" },
      deps,
    );
    expect(message.segments).toHaveLength(0);
    expect(message.flow?.step).toBe("name");
  });
});

describe("booking quick replies", () => {
  it("offers chips for new or existing and NHS or private, and fills them without the planner", async () => {
    const flow = { name: "booking_request" as const, step: "patient", slots: { reason: "Check-up", name: "‹NAME_1›", phone: "‹PHONE_1›" } };
    const { deps, calls } = fakeDeps();
    const r = await runExecutor(ctx({ visitorText: "Existing patient", flow }), deps);
    expect(calls.plan).toBe(0);
    expect(r.flow?.slots.patient).toBe("existing");
    expect(r.segments[0]!.options).toEqual(["NHS", "Private", "Not sure"]);
    expect(validateSlot("care", "I have Denplan insurance")).toEqual({ ok: true, value: "private" });
  });
});

describe("booking offer", () => {
  const parking = () =>
    fakeDeps({
      commands: [{ cmd: "answer_from_knowledge", query: "parking" }],
      chunks: [hoursChunk],
      composed: "On Saturday we open 9am to 1pm [1].",
    });

  it("offers a booking once after a question about visiting, with quick replies", async () => {
    const { deps } = parking();
    const r = await runExecutor(ctx({ visitorText: "Is there parking near the practice?" }), deps);
    expect(r.segments.map((s) => s.kind)).toEqual(["answer", "suggest"]);
    expect(r.segments[1]!.options).toEqual(["Book an appointment", "Not right now"]);
    expect(r.segments[0]!.options).toEqual([]);

    const nhs = await runExecutor(ctx({ visitorText: "Do you take new NHS patients?" }), parking().deps);
    expect(nhs.segments.at(-1)!.kind).toBe("suggest");

    const again = await runExecutor(ctx({ visitorText: "Is there parking near the practice?", bookingOffered: true }), parking().deps);
    expect(again.segments.map((s) => s.kind)).toEqual(["answer"]);
  });

  it("offers on the second answer, or on thanks, but never during a flow or after a handover", async () => {
    const hours = () => fakeDeps({ commands: [{ cmd: "answer_from_knowledge", query: "saturday" }], chunks: [hoursChunk], composed: "On Saturday we open 9am to 1pm [1]." });
    expect((await runExecutor(ctx({ visitorText: "open saturday" }), hours().deps)).segments.map((s) => s.kind)).toEqual(["answer"]);
    expect((await runExecutor(ctx({ visitorText: "open saturday", answeredBefore: 1 }), hours().deps)).segments.at(-1)!.kind).toBe("suggest");

    const thanks = await runExecutor(ctx({ visitorText: "great thanks", answeredBefore: 2 }), fakeDeps().deps);
    expect(thanks.segments[0]).toMatchObject({ kind: "suggest", options: ["Book an appointment", "Not right now"] });
    expect(thanks.affirmed).toBe(true);
    const thanksAfterHandover = await runExecutor(ctx({ visitorText: "great thanks", answeredBefore: 2, bookingOffered: true }), fakeDeps().deps);
    expect(thanksAfterHandover.segments[0]!.kind).toBe("acknowledge");
  });

  it("starts a booking that asks what for when the offer is taken, and accepts a polite no", async () => {
    const history = [{ role: "bot" as const, text: T.BOOKING_OFFER }];
    for (const text of ["Book an appointment", "yes please"]) {
      const { deps, calls } = fakeDeps();
      const r = await runExecutor(ctx({ visitorText: text, history }), deps);
      expect(calls.plan).toBe(0);
      expect(r.flow).toMatchObject({ name: "booking_request", step: "reason" });
      expect(r.segments[0]!.options).toEqual(["Check-up", "Hygienist", "Consultation"]);
    }
    const { deps, calls } = fakeDeps();
    const no = await runExecutor(ctx({ visitorText: "Not right now", history }), deps);
    expect(calls.plan).toBe(0);
    expect(no.segments[0]!.text).toBe(T.OFFER_DECLINED);
  });
});

describe("quick replies", () => {
  it("fills the appointment type only from a tapped chip; typed reasons go to the planner", async () => {
    const flow = { name: "booking_request" as const, step: "reason", slots: {} };
    const tapped = fakeDeps();
    const r = await runExecutor(ctx({ visitorText: "Hygienist", flow }), tapped.deps);
    expect(tapped.calls.plan).toBe(0);
    expect(r.flow?.slots.reason).toBe("Hygienist");
    const typed = fakeDeps({ commands: [{ cmd: "set_slot", slot: "reason", value: "a broken crown" }] });
    await runExecutor(ctx({ visitorText: "a broken crown", flow }), typed.deps);
    expect(typed.calls.plan).toBe(1);
  });

  it("offers yes or change on the summary, and a way to skip contact details after a handover", async () => {
    const flow = { name: "booking_request" as const, step: "phone", slots: { reason: "Check-up", patient: "new", care: "NHS", nhs_route: "child", preferred_time: "mornings", name: "‹NAME_1›" } };
    const summary = await runExecutor(ctx({ visitorText: "‹PHONE_1›", flow }), fakeDeps({ commands: [{ cmd: "set_slot", slot: "phone", value: "‹PHONE_1›" }] }).deps);
    expect(summary.segments.at(-1)!.options).toEqual(["Yes, send it", "Change something"]);
    const change = await runExecutor(ctx({ visitorText: "Change something", flow: summary.flow }), fakeDeps().deps);
    expect(change.flow?.step).toBe("change");

    const handover = await runExecutor(ctx({ action: "handover", visitorText: null }), fakeDeps().deps);
    expect(handover.segments.at(-1)!.options).toEqual(["I'd rather not say"]);
    const skip = await runExecutor(ctx({ visitorText: "I'd rather not say", status: "handed_over", flow: handover.flow }), fakeDeps().deps);
    expect(skip.flow?.step).toBe("waiting");
    expect(skip.segments[0]!.options).toEqual([]);
  });
});

describe("command validation", () => {
  it("rejects malformed commands and over-limit batches", async () => {
    const { deps } = fakeDeps({
      commands: [
        { cmd: "write_reply", text: "Our prices are low!" },
        { cmd: "answer_from_knowledge" },
        { cmd: "set_slot", slot: "phone", value: "07700900123" },
        { cmd: "cannot_handle", reason: "out_of_scope" },
        { cmd: "cannot_handle", reason: "out_of_scope" },
      ],
    });
    const r = await runExecutor(ctx({ visitorText: "tell me a joke" }), deps);
    expect(r.act).toBe("out_of_scope");
    expect(r.segments).toHaveLength(1);
    expect(r.trace.rejected.length).toBeGreaterThanOrEqual(3);
  });

  it("never lets clarify options carry prices or numbers", async () => {
    const { deps } = fakeDeps({ commands: [{ cmd: "clarify", options: ["Check-up £55", "Hygienist £75"] }] });
    const r = await runExecutor(ctx({ visitorText: "how much for a family" }), deps);
    expect(r.act).toBe("fallback");
    expect(r.trace.guardrails).toContainEqual(expect.objectContaining({ rule: "clarify_options", result: "dropped" }));
  });

  it("renders clarify options as quick replies", async () => {
    const { deps } = fakeDeps({ commands: [{ cmd: "clarify", options: ["Private prices", "NHS charges"] }] });
    const r = await runExecutor(ctx({ visitorText: "how much for a family" }), deps);
    expect(r.act).toBe("clarify");
    expect(r.segments[0]!.options).toEqual(["Private prices", "NHS charges"]);
  });

  it("drops clarify and cannot_handle when mixed with substantive commands", () => {
    const { kept, dropped } = normaliseCommands(
      [
        { cmd: "clarify", options: ["A thing", "B thing"] },
        { cmd: "answer_from_knowledge", query: "hours" },
        { cmd: "cannot_handle", reason: "out_of_scope" },
      ],
      null,
    );
    expect(kept).toEqual([{ cmd: "answer_from_knowledge", query: "hours" }]);
    expect(dropped).toHaveLength(2);
  });

  it("rejects set_slot without an active flow", () => {
    const { kept, dropped } = normaliseCommands([{ cmd: "set_slot", slot: "name", value: "x" }], null);
    expect(kept).toEqual([]);
    expect(dropped[0]!.error).toMatch(/without an active flow/);
  });

  it("answers thanks without calling the planner and marks the visitor as affirming", async () => {
    const { deps, calls } = fakeDeps();
    const r = await runExecutor(ctx({ visitorText: "perfect, thanks!" }), deps);
    expect(calls.plan).toBe(0);
    expect(r.affirmed).toBe(true);
    expect(r.act).toBe("acknowledged");
  });

  it("greets back with starter questions without calling the planner", async () => {
    const { deps, calls } = fakeDeps();
    const r = await runExecutor(ctx({ visitorText: "hi" }), deps);
    expect(calls.plan).toBe(0);
    expect(r.act).toBe("acknowledged");
    expect(r.segments[0]!.options.length).toBeGreaterThan(0);
  });

  it("answers the chosen option instead of clarifying twice in a row", async () => {
    const { deps, calls } = fakeDeps({
      commands: [{ cmd: "clarify", options: ["Prices", "Opening hours"] }],
      chunks: [hoursChunk],
      composed: "On Saturday we open 9am to 1pm [1].",
    });
    const r = await runExecutor(ctx({ visitorText: "Ask about opening hours", lastBotAct: "clarify" }), deps);
    expect(calls.retrieve).toEqual(["Ask about opening hours"]);
    expect(r.act).toBe("answered");
    expect(r.trace.guardrails).toContainEqual(expect.objectContaining({ rule: "no_double_clarify" }));
  });

  it("offers the page's sections when a short topic cannot be answered directly", async () => {
    const intro = { ...hygieneChunk, chunkId: 10, heading: "Treatments and prices", score: 0.77 };
    const { deps } = fakeDeps({
      commands: [{ cmd: "answer_from_knowledge", query: "treatments" }],
      chunks: [intro, { ...hygieneChunk, score: 0.72 }, { ...fillingChunk, score: 0.7 }, { ...hoursChunk, score: 0.69 }],
      composed: "NO_ANSWER",
    });
    const r = await runExecutor(ctx({ visitorText: "treatments" }), deps);
    expect(r.act).toBe("clarify");
    expect(r.fallbacks).toBe(0);
    expect(r.segments[0]!.options).toEqual(["Check-ups and hygiene", "Fillings and root canal treatment"]);
  });

  it("serves a technical-problem message with the phone number when the planner fails", async () => {
    const { deps } = fakeDeps({ planThrows: true });
    const r = await runExecutor(ctx({ visitorText: "opening hours?" }), deps);
    expect(r.act).toBe("error");
    expect(r.trace.error).toMatch(/planner/);
    expect(r.segments[0]!.text).toContain("020 7946 0321");
  });
});

describe("next steps from labelled turns", () => {
  const weekHours: ScoredChunk = {
    ...hoursChunk,
    text: "| Monday | 8am to 6pm |\n| Tuesday | 8am to 8pm |\n| Wednesday | 8am to 6pm |\n| Thursday | 8am to 8pm |\n| Friday | 8am to 5pm |\n| Saturday | 9am to 1pm |\n| Sunday | Closed |",
  };
  const at = (iso: string) => () => Date.parse(iso);

  it("stays quiet once the team has replied, even while contact details were being asked for", async () => {
    const { deps } = fakeDeps();
    const r = await runExecutor(
      ctx({ visitorText: "yes please, thank you", status: "handed_over", flow: { name: "handover", step: "name", slots: {} }, teamReplied: true }),
      deps,
    );
    expect(r.segments).toEqual([]);
  });

  it("asks what a bill question is about before the contact details", async () => {
    const { deps } = fakeDeps({ commands: [{ cmd: "handover", reason: "visitor_request" }] });
    const r = await runExecutor(ctx({ visitorText: "can I speak to someone about my bill please" }), deps);
    expect(r.flow?.step).toBe("details");
    expect(r.segments[1]!.text).toMatch(/invoice number/);
  });

  it("repeats the 999 advice when the severity answer has a red flag", async () => {
    const { deps } = fakeDeps();
    const r = await runExecutor(
      ctx({ visitorText: "10, and it's hard to swallow", status: "handed_over", flow: { name: "handover", step: "details", slots: {} } }),
      deps,
    );
    expect(r.segments[0]!.text).toMatch(/call 999/);
    expect(r.flow?.step).toBe("name");
  });

  it("steers back after an out-of-scope question", async () => {
    const { deps } = fakeDeps({ commands: [{ cmd: "cannot_handle", reason: "out_of_scope" }] });
    const r = await runExecutor(ctx({ visitorText: "what's the weather tomorrow" }), deps);
    expect(r.segments[0]!.text).not.toMatch(/I can only help/);
    expect(r.segments[0]!.options).toEqual(["Services", "Opening hours", "Find us"]);
  });

  it("offers to ask the team when it can't answer, and hands over on yes", async () => {
    const { deps } = fakeDeps({ commands: [{ cmd: "answer_from_knowledge", query: "botox" }], chunks: [] });
    const r = await runExecutor(ctx({ visitorText: "do you do botox" }), deps);
    expect(r.segments[0]!.options).toEqual(T.ASK_TEAM_OPTIONS);

    const yes = await runExecutor(ctx({ visitorText: "Yes, ask the team", history: [{ role: "bot", text: r.segments[0]!.text }] }), deps);
    expect(yes.handover).toEqual({ reason: "visitor_request", trigger: "visitor_button" });
    const no = await runExecutor(ctx({ visitorText: "No thanks", history: [{ role: "bot", text: r.segments[0]!.text }] }), deps);
    expect(no.handover).toBeNull();
    expect(no.act).toBe("acknowledged");
  });

  it("does not serve a weak match about a different topic as the answer", async () => {
    const sedation = { ...hygieneChunk, chunkId: 30, heading: "Do you offer sedation?", text: "We do not offer sedation at the practice.", score: 0.71 };
    const { deps } = fakeDeps({
      commands: [{ cmd: "answer_from_knowledge", query: "Do you offer treatment for sleep apnoea" }],
      chunks: [sedation],
      composed: "We do not offer sedation at the practice [1].",
    });
    const r = await runExecutor(ctx({ visitorText: "Do you offer treatment for sleep apnoea?" }), deps);
    expect(r.act).toBe("blocked");
    expect(r.trace.guardrails).toContainEqual(expect.objectContaining({ rule: "off_topic", result: "dropped" }));
  });

  it("answers 'are you open right now' from the published hours and the practice clock", async () => {
    const { deps, calls } = fakeDeps({ chunks: [weekHours] });
    const open = await runExecutor(ctx({ visitorText: "are you open right now?" }), { ...deps, now: at("2026-10-26T10:00:00Z") });
    expect(calls.plan).toBe(0);
    expect(open.segments[0]!.text).toBe("Yes, we're open now until 6pm today.");
    expect(open.segments[0]!.sources[0]!.anchor).toBe("opening-hours");
    expect(open.answered).toBe(1);

    const sunday = await runExecutor(ctx({ visitorText: "are you open today?" }), { ...deps, now: at("2026-10-25T12:00:00Z") });
    expect(sunday.segments[0]!.text).toBe("We're closed right now. We open again tomorrow at 8am.");
  });

  it("asks NHS or private before any price", async () => {
    const { deps, calls } = fakeDeps({ chunks: [hygieneChunk] });
    const r = await runExecutor(ctx({ visitorText: "prices", profile: {} }), deps);
    expect(calls.plan).toBe(0);
    expect(r.segments[0]!.text).toBe("Are you an NHS or private patient?");
    expect(r.segments[0]!.options).toEqual(["NHS", "Private", "Not sure"]);
  });

  it("explains the NHS position to a new NHS patient and asks which route", async () => {
    const nhs = { ...hygieneChunk, chunkId: 40, heading: "Are you taking new NHS patients?", text: "We are accepting new NHS patients under 18. Adults join a waiting list.", score: 0.95 };
    const flow = { name: "booking_request" as const, step: "care", slots: { reason: "Check-up", patient: "new" } };
    const { deps } = fakeDeps({ chunks: [nhs], composed: "We are accepting new NHS patients under 18 [1]." });
    const r = await runExecutor(ctx({ visitorText: "NHS", flow }), deps);
    expect(r.segments.map((s) => s.kind)).toEqual(["answer", "flow"]);
    expect(r.segments[1]!.options).toEqual(["For a child", "Join the waiting list", "Book privately"]);

    const priv = await runExecutor(ctx({ visitorText: "Book privately", flow: r.flow }), deps);
    expect(priv.flow?.slots.nhs_route).toBe("private");
    expect(priv.segments.at(-1)!.text).toMatch(/days or times/);
  });

  it("dates 'tomorrow' and asks for the part of the day when only a day was given", async () => {
    const flow = { name: "booking_request" as const, step: "preferred_time", slots: { reason: "Check-up", patient: "existing", care: "private" } };
    const { deps } = fakeDeps();
    const r = await runExecutor(ctx({ visitorText: "tomorrow", flow }), { ...deps, now: at("2026-10-25T18:00:00Z") });
    expect(r.flow?.slots.preferred_time).toBe("tomorrow (Mon 26 Oct)");
    expect(r.segments.at(-1)!.options).toEqual(["Morning", "Afternoon", "Evening", "Any time"]);
  });

  it("says the request is ready when Book is tapped again at the summary", async () => {
    const flow = {
      name: "booking_request" as const,
      step: "confirm",
      slots: { reason: "Check-up", patient: "existing", care: "private", preferred_time: "Tuesday evenings", name: "‹NAME_1›", phone: "‹PHONE_1›" },
    };
    const { deps } = fakeDeps();
    const r = await runExecutor(ctx({ visitorText: null, action: "book", flow }), deps);
    expect(r.segments.map((s) => s.text)).toEqual(["Your request is ready. Shall I send it to the team?"]);
  });

  it("closes politely when the visitor says no to anything else", async () => {
    const { deps, calls } = fakeDeps();
    const r = await runExecutor(ctx({ visitorText: "no thanks", history: [{ role: "bot", text: T.ACKNOWLEDGE }] }), deps);
    expect(calls.plan).toBe(0);
    expect(r.segments[0]!.text).toBe(T.OFFER_DECLINED);
  });
});

describe("offline compose, from the 25 Oct salon labels", () => {
  const salonChunk = (chunkId: number, heading: string, text: string, score: number): ScoredChunk => ({
    chunkId, page: "Services and prices", slug: "prices", heading, anchor: "a", text, score, keywordScore: 0.2,
  });
  const composed = async (query: string, chunks: ScoredChunk[]) => {
    let out = "";
    for await (const piece of offlineCompose(query, chunks).stream) out += piece;
    return out;
  };

  it("gives only the price for the level asked about", async () => {
    const cut = salonChunk(38, "Cut and style", [
      "Cut and blow-dry: graduate stylist £45; stylist £62; senior stylist £75; creative director £95",
      "Blow-dry: graduate stylist £32; stylist £38; senior stylist £45; creative director £55",
    ].join("\n"), 1.05);
    expect(await composed("How much is a cut and blow-dry with a senior stylist", [cut])).toBe("Cut and blow-dry with a senior stylist: £75 [1].");
    expect(await composed("How much is a blow-dry with a stylist", [cut])).toBe("Blow-dry with a stylist: £38 [1].");
  });

  it("keeps the whole list when no level is named", () => {
    const line = "Cut and blow-dry: graduate stylist £45; stylist £62; senior stylist £75; creative director £95";
    expect(onlyAskedFor(line, "how much is a cut and blow-dry")).toBe(line);
    expect(onlyAskedFor("Balayage: from £160 (price)", "balayage with a senior stylist")).toBe("Balayage: from £160 (price)");
  });

  it("doesn't add a second line that says nothing new", async () => {
    const chunks = [
      salonChunk(40, "Highlights and balayage", "Balayage: from £160 (price)\n\nBalayage and full head foils usually take three hours, including a blow-dry.", 1.0),
      salonChunk(50, "How long will my appointment take?", "A cut and blow-dry takes about an hour. A full head colour takes about two hours, and balayage or full head foils about three hours.", 0.996),
    ];
    expect(await composed("How long does balayage take", chunks)).toBe("Balayage and full head foils usually take three hours, including a blow-dry [1].");
  });
});
