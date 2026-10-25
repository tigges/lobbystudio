import { describe, expect, it } from "vitest";
import { normaliseCommands, runExecutor } from "../src/runtime/executor.ts";
import { validateSlot } from "../src/runtime/flows/booking-request.ts";
import type { ExecutorEvent } from "../src/runtime/types.ts";
import { bundle, ctx, fakeDeps, fillingChunk, hoursChunk, hygieneChunk } from "./fixtures.ts";

describe("hard rules", () => {
  it.each([
    ["my tooth really hurts", "pain_or_symptoms"],
    ["my face is swollen", "pain_or_symptoms"],
    ["it's an emergency", "emergency"],
    ["what painkiller should I take?", "clinical_advice"],
  ])("hands over %j without calling the planner", async (text, reason) => {
    const { deps, calls } = fakeDeps({ commands: [{ cmd: "answer_from_knowledge", query: text }] });
    const r = await runExecutor(ctx({ visitorText: text }), deps);
    expect(calls.plan).toBe(0);
    expect(r.act).toBe("handover");
    expect(r.status).toBe("handed_over");
    expect(r.handover).toEqual({ reason, trigger: "precheck" });
    expect(r.trace.guardrails[0]).toMatchObject({ rule: "clinical_precheck", result: "hit" });
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]!.text).toContain(bundle.practice.phone);
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

  it("does not answer at all once the conversation is handed over", async () => {
    const { deps, calls } = fakeDeps();
    const r = await runExecutor(ctx({ visitorText: "hello?", status: "handed_over" }), deps);
    expect(calls.plan).toBe(0);
    expect(r.segments).toEqual([]);
    expect(r.act).toBe("waiting");
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
      chunks: [hygieneChunk],
      composed: "A 30-minute hygienist appointment is £75 [1].",
    });
    const events: ExecutorEvent[] = [];
    const r = await runExecutor(ctx({ visitorText: "how much is the hygienist" }), deps, (e) => events.push(e));
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
    const r = await runExecutor(ctx({ visitorText: "hygienist?" }), deps);
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
    const r = await runExecutor(ctx({ visitorText: "hygienist" }), deps);
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
    const r = await runExecutor(ctx({ visitorText: "price and saturday?" }), deps);
    expect(r.answered).toBe(2);
    expect(r.segments.map((s) => s.sources[0]!.slug)).toEqual(["treatments", "contact"]);
  });
});

describe("booking_request flow", () => {
  it("runs the slots in order and creates a booking request on confirmation", async () => {
    let flow = null as ReturnType<typeof ctx>["flow"];
    const steps: [string | null, "book" | null, unknown[], RegExp][] = [
      [null, "book", [], /name/],
      ["‹NAME_1›", null, [{ cmd: "set_slot", slot: "name", value: "‹NAME_1›" }], /phone number/],
      ["‹PHONE_1›", null, [{ cmd: "set_slot", slot: "phone", value: "‹PHONE_1›" }], /days or times/],
      ["tuesday evenings", null, [{ cmd: "set_slot", slot: "preferred_time", value: "tuesday evenings" }], /Shall I send this/],
    ];
    for (const [text, action, commands, prompt] of steps) {
      const { deps } = fakeDeps({ commands });
      const r = await runExecutor(ctx({ visitorText: text, action, flow }), deps);
      expect(r.segments.at(-1)!.text).toMatch(prompt);
      flow = r.flow;
    }
    expect(flow?.slots).toEqual({ reason: "Check-up", name: "‹NAME_1›", phone: "‹PHONE_1›", preferred_time: "tuesday evenings" });

    const { deps, calls } = fakeDeps();
    const done = await runExecutor(ctx({ visitorText: "yes please", flow }), deps);
    expect(calls.plan).toBe(0);
    expect(done.act).toBe("flow_completed");
    expect(done.booking).toMatchObject({ phone: "‹PHONE_1›", confirm: "yes" });
    expect(done.flow).toBeNull();
    expect(done.segments[0]!.text).toContain("‹PHONE_1›");
  });

  it("re-asks when the phone number is invalid", async () => {
    const flow = { name: "booking_request" as const, step: "phone", slots: { reason: "Check-up", name: "‹NAME_1›" } };
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
      slots: { reason: "Check-up", name: "‹NAME_1›", phone: "‹PHONE_1›", preferred_time: "mornings" },
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
    const flow = { name: "booking_request" as const, step: "phone", slots: { reason: "Check-up", name: "‹NAME_1›" } };
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
      slots: { reason: "Check-up", name: "‹NAME_1›", phone: "‹PHONE_1›", preferred_time: "tomorrow" },
    };
    const { deps, calls } = fakeDeps({ commands: [{ cmd: "handover", reason: "visitor_request" }] });
    const r = await runExecutor(ctx({ visitorText: "I want a date/time confirmation for my appointment", flow }), deps);
    expect(calls.plan).toBe(0);
    expect(r.handover).toBeNull();
    expect(r.segments.map((s) => s.text)).toEqual([expect.stringMatching(/can't confirm a date or time/), expect.stringMatching(/Shall I send this/)]);
    expect(r.flow?.slots.preferred_time).toBe("tomorrow");
  });

  it("fills the expected slot from the visitor text when the planner emits nothing", async () => {
    const flow = { name: "booking_request" as const, step: "preferred_time", slots: { reason: "Check-up", name: "A", phone: "‹PHONE_1›" } };
    const { deps } = fakeDeps({ commands: [] });
    const r = await runExecutor(ctx({ visitorText: "weekday mornings", flow }), deps);
    expect(r.flow?.slots.preferred_time).toBe("weekday mornings");
    expect(r.trace.guardrails).toContainEqual(expect.objectContaining({ rule: "slot_fallback" }));
  });

  it("does not take an answer to another question as a name", async () => {
    const flow = { name: "booking_request" as const, step: "name", slots: { reason: "Check-up" } };
    const { deps } = fakeDeps({ commands: [{ cmd: "set_slot", slot: "name", value: "Routine check-up" }] });
    const r = await runExecutor(ctx({ visitorText: "Routine check-up", flow }), deps);
    expect(r.flow?.slots.name).toBeUndefined();
    expect(r.segments[0]!.text).toMatch(/didn't catch your name/);
    expect(validateSlot("name", "Sam Taylor")).toEqual({ ok: true, value: "Sam Taylor" });
    expect(validateSlot("name", "Tuesday evening").ok).toBe(false);
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
    const r = await runExecutor(ctx({ visitorText: "how much" }), deps);
    expect(r.act).toBe("fallback");
    expect(r.trace.guardrails).toContainEqual(expect.objectContaining({ rule: "clarify_options", result: "dropped" }));
  });

  it("renders clarify options as quick replies", async () => {
    const { deps } = fakeDeps({ commands: [{ cmd: "clarify", options: ["Private prices", "NHS charges"] }] });
    const r = await runExecutor(ctx({ visitorText: "how much is it" }), deps);
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
      commands: [{ cmd: "answer_from_knowledge", query: "prices" }],
      chunks: [intro, { ...hygieneChunk, score: 0.72 }, { ...fillingChunk, score: 0.7 }, { ...hoursChunk, score: 0.69 }],
      composed: "NO_ANSWER",
    });
    const r = await runExecutor(ctx({ visitorText: "prices" }), deps);
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
