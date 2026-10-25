import { describe, expect, it } from "vitest";
import { loadCases } from "../src/evals/cases.ts";
import { checkReply } from "../src/evals/check.ts";
import { casesFromLabels } from "../src/evals/from-labels.ts";

const reply = (segments: { kind: string; text: string; options?: string[] }[], step?: string) =>
  ({
    segments: segments.map((s) => ({ options: [], ...s })),
    flow: step ? { step } : null,
    handover: null,
  }) as unknown as Parameters<typeof checkReply>[1];

describe("checkReply", () => {
  it("passes when every check holds", () => {
    const r = reply([{ kind: "answer", text: "A cut with a senior stylist is £75." }, { kind: "suggest", text: "Book?", options: ["Book now"] }]);
    expect(checkReply({ contains: ["£75"], notContains: ["junior"], kinds: ["answer"], options: ["Book now"], step: null }, r)).toEqual([]);
  });
  it("lists each failed check in words", () => {
    const r = reply([{ kind: "fallback", text: "Sorry, I don't know that one." }], "name");
    expect(checkReply({ contains: ["Turnham Green"], notKinds: ["fallback"], step: null, handover: true }, r)).toEqual([
      'should say "Turnham Green"',
      "shouldn't include a fallback message",
      "should wait on nothing, waits on name",
      "should hand over to the team",
    ]);
  });
});

describe("casesFromLabels", () => {
  const base = { conversationId: "c1", flowAfter: null, note: null };
  it("stitches one conversation from its labels and stands in for personal details", () => {
    const cases = casesFromLabels([
      { ...base, label: "too_long", note: "just the price", turnId: 11, turn: 1, visitor: "senior cut price?", assistant: "Prices…", before: [{ role: "visitor", text: "hi" }] },
      {
        ...base,
        label: "good",
        turnId: 13,
        turn: 3,
        visitor: "I'm ‹NAME_1›",
        assistant: "Thanks",
        flowAfter: { step: "phone" },
        before: [
          { role: "visitor", text: "senior cut price?" },
          { role: "assistant", text: "Prices…" },
          { role: "visitor", text: "Wed 28 Oct, 10:30 with Hana" },
        ],
      },
    ]);
    expect(cases).toHaveLength(1);
    const [c] = cases;
    expect(c!.turns.map((t) => t.say ?? t.action)).toEqual(["hi", "senior cut price?", "the first one", "I'm Mia Tanaka"]);
    expect(c!.turns[1]!.expect?.judge).toContain("just the price");
    expect(c!.turns[3]!.expect).toMatchObject({ step: "phone" });
    expect(c!.source).toBe("labels on turns 11, 13");
  });
});

describe("saved cases", () => {
  it.each(["harbour-dental", "mikan-hair"])("%s parses", (tenant) => {
    expect(loadCases(tenant).length).toBeGreaterThan(0);
  });
});
