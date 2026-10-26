import { describe, expect, it } from "vitest";
import { runExecutor } from "../src/runtime/executor.ts";
import * as T from "../src/runtime/templates.ts";
import type { HistoryItem, ScoredChunk } from "../src/runtime/types.ts";
import { bundle, ctx, fakeDeps, hoursChunk } from "./fixtures.ts";

const gettingHere: ScoredChunk = {
  chunkId: 31,
  page: "Opening hours and contact",
  slug: "contact",
  heading: "Getting here",
  anchor: "getting-here",
  text: "We're a five-minute walk from Canada Water station on the Jubilee line and Overground.",
  score: 0.63,
  keywordScore: 0.1,
};

const QUESTION = "What's the nearest station?";

describe("synonyms", () => {
  it("searches again with the website's word and keeps the better match", async () => {
    const { deps, calls } = fakeDeps({
      commands: [{ cmd: "answer_from_knowledge", query: QUESTION }],
      chunks: { [QUESTION]: [gettingHere, hoursChunk], "Getting here": [{ ...gettingHere, score: 0.79 }] },
      composed: "We're a five-minute walk from Canada Water station [1].",
    });
    const r = await runExecutor(ctx({ visitorText: QUESTION }), deps);
    expect(calls.retrieve).toEqual([QUESTION, "Getting here"]);
    expect(r.segments[0]).toMatchObject({ kind: "answer", text: "We're a five-minute walk from Canada Water station." });
    expect(r.trace.guardrails).toContainEqual({ rule: "synonym", result: "hit", detail: `${QUESTION} → Getting here` });
  });
});

describe("near misses", () => {
  const asked: HistoryItem[] = [
    { role: "visitor", text: "Which station are you closest to?" },
    { role: "bot", text: T.nearMiss("Getting here"), kind: "clarify" },
  ];

  it("asks “Do you mean …?” when the best match is just under the threshold", async () => {
    const { deps } = fakeDeps({ commands: [{ cmd: "answer_from_knowledge", query: "Which station are you closest to?" }], chunks: [{ ...gettingHere, score: 0.62 }] });
    const r = await runExecutor(ctx({ visitorText: "Which station are you closest to?" }), deps);
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]).toMatchObject({ kind: "clarify", text: "Just to check, do you mean “Getting here”?", options: ["Getting here", "Something else"] });
    expect(r.act).toBe("clarify");
  });

  it("still says it doesn't know when the near match shares no word with the question", async () => {
    const { deps } = fakeDeps({ commands: [{ cmd: "answer_from_knowledge", query: "Do you sell gift vouchers?" }], chunks: [{ ...gettingHere, score: 0.64 }] });
    const r = await runExecutor(ctx({ visitorText: "Do you sell gift vouchers?" }), deps);
    expect(r.segments[0]!.kind).toBe("fallback");
  });

  it("answers the original question from the section the visitor picks, without the planner", async () => {
    const { deps, calls } = fakeDeps({ chunks: [{ ...gettingHere, score: 0.62 }], composed: "We're a five-minute walk from Canada Water station [1]." });
    const r = await runExecutor(ctx({ visitorText: "Getting here", history: asked, lastBotAct: "clarify" }), deps);
    expect(calls.plan).toBe(0);
    expect(calls.compose).toEqual(["Which station are you closest to?"]);
    expect(r.trace.plannerSkipped).toBe("near_miss_confirmed");
    expect(r.segments[0]!.kind).toBe("answer");
  });

  it("offers the team when the visitor meant something else", async () => {
    const { deps } = fakeDeps();
    const r = await runExecutor(ctx({ visitorText: "Something else", history: asked, lastBotAct: "clarify" }), deps);
    expect(r.segments[0]).toMatchObject({ kind: "fallback", text: T.dontKnow(bundle.practice), options: T.ASK_TEAM_OPTIONS });
  });
});
