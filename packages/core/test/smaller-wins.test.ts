import { describe, expect, it } from "vitest";
import { runExecutor } from "../src/runtime/executor.ts";
import * as T from "../src/runtime/templates.ts";
import { DENTAL_PACK } from "../src/packs/dental.ts";
import { SALON_PACK } from "../src/packs/salon.ts";
import { bundle, ctx, fakeDeps, hoursChunk, hygieneChunk } from "./fixtures.ts";

describe("answering without the planner", () => {
  it("skips the planner for a simple question with a confident match, searching once", async () => {
    const { deps, calls } = fakeDeps({ chunks: [hygieneChunk], composed: "A hygienist appointment is £75 [1]." });
    const r = await runExecutor(ctx({ visitorText: "How much is the hygienist?", bookingOffered: true }), deps);
    expect(calls.plan).toBe(0);
    expect(calls.retrieve).toEqual(["How much is the hygienist?"]);
    expect(r.trace.plannerSkipped).toBe("confident_match");
    expect(r.segments[0]!.text).toBe("A hygienist appointment is £75.");
  });
  it("asks the planner for bookings, follow-ups and two questions at once", async () => {
    for (const text of ["Can I book a hygienist?", "How much is that?", "How much is the hygienist and are you open Saturdays?"]) {
      const { deps, calls } = fakeDeps({ chunks: [hygieneChunk] });
      await runExecutor(ctx({ visitorText: text }), deps);
      expect(calls.plan, text).toBe(1);
    }
  });
});

describe("partial answers", () => {
  it("says what the section covers when it lacks the detail", async () => {
    const { deps } = fakeDeps({ commands: [{ cmd: "answer_from_knowledge", query: "Are you open on Easter Monday?" }], chunks: [{ ...hoursChunk, score: 0.75 }] });
    const r = await runExecutor(ctx({ visitorText: "Are you open on Easter Monday?" }), deps);
    expect(r.segments[0]).toMatchObject({ kind: "fallback", text: T.partial("Opening hours", bundle.practice), options: ["Opening hours", "Yes, ask the team"] });
    const { deps: next } = fakeDeps();
    const yes = await runExecutor(ctx({ visitorText: "Yes, ask the team", history: [{ role: "bot", text: T.partial("Opening hours", bundle.practice), kind: "fallback" }] }), next);
    expect(yes.handover?.reason).toBe("visitor_request");
  });
  it("only offers the team for the rest when another question was answered", async () => {
    const { deps } = fakeDeps({
      commands: [
        { cmd: "answer_from_knowledge", query: "hygienist price" },
        { cmd: "answer_from_knowledge", query: "do you do botox" },
      ],
      chunks: { "hygienist price": [{ ...hygieneChunk, score: 0.75 }], "do you do botox": [{ ...hygieneChunk, score: 0.4 }] },
      composed: (q) => (q === "hygienist price" ? "A hygienist appointment is £75 [1]." : "NO_ANSWER"),
    });
    const r = await runExecutor(ctx({ visitorText: "hygienist price, and do you do botox", bookingOffered: true }), deps);
    expect(r.segments.map((s) => s.kind)).toEqual(["answer", "fallback"]);
    expect(r.segments[1]!.text).toBe(T.dontKnowRest(bundle.practice));
  });
});

describe("cost cap", () => {
  it("writes the answer without the model once the turn has spent its budget", async () => {
    const { deps, calls } = fakeDeps({ commands: [{ cmd: "answer_from_knowledge", query: "hygienist price" }], chunks: [{ ...hygieneChunk, score: 0.75 }] });
    const r = await runExecutor(ctx({ visitorText: "hygienist price please", bookingOffered: true }), { ...deps, maxTurnCostUsd: 0.0005 });
    expect(calls.compose).toEqual([]);
    expect(r.segments[0]!.kind).toBe("answer");
    expect(r.trace.guardrails.some((g) => g.rule === "cost_cap")).toBe(true);
  });
});

describe("page-aware openings", () => {
  const salon = { name: "Mikan Hair Studio", phone: "020 7946 0588" };
  it("reads the page from the widget's path", () => {
    expect(T.pageSlug("/prices")).toBe("prices");
    expect(T.pageSlug("/mikan-hair/patch-tests/?x=1")).toBe("patch-tests");
    expect(T.pageSlug("/")).toBe("");
    expect(T.pageSlug("/<script>")).toBeNull();
    expect(T.pageSlug(42)).toBeNull();
  });
  it("opens with a line for the page only: no booking nudge, and pain only on the emergencies page", () => {
    expect(SALON_PACK.greeting(salon, "prices")).toBe("Hi, I'm the Mikan Hair Studio assistant. Looking at prices? Ask me about any service.");
    expect(SALON_PACK.greeting(salon, "")).toBe("Hi, I'm the Mikan Hair Studio assistant. How can I help you today?");
    expect(DENTAL_PACK.greeting(bundle.practice, "")).toBe(DENTAL_PACK.greeting(bundle.practice, null));
    expect(DENTAL_PACK.greeting(bundle.practice, "")).toBe("Hi, I'm the Harbour Dental assistant. How can I help you today?");
    expect(DENTAL_PACK.greeting(bundle.practice, "treatments")).toBe("Hi, I'm the Harbour Dental assistant. Looking at our treatments? Ask me what any of them involves.");
    for (const page of ["", "treatments", "nhs-private-faq", "book", "contact"]) {
      expect(DENTAL_PACK.greeting(bundle.practice, page)).not.toMatch(/pain|symptom|urgent/i);
      expect(DENTAL_PACK.greeting(bundle.practice, page === "book" ? "x" : page)).not.toMatch(/\bbook/i);
    }
    expect(DENTAL_PACK.greeting(bundle.practice, "emergencies")).toContain("Need urgent help? Tell me what's happened and I'll get you to the right person.");
  });

});
