import { describe, expect, it } from "vitest";
import {
  assumedOutcome,
  confirmedOutcome,
  isSameTopic,
  reversedOutcome,
  withinReversalWindow,
  type ConversationFacts,
} from "../src/outcomes.ts";

const H = 3_600_000;
const now = new Date("2026-10-25T12:00:00Z");
const facts = (o: Partial<ConversationFacts> = {}): ConversationFacts => ({
  handedOver: false,
  humanReplied: false,
  answeredCount: 1,
  fallbackCount: 0,
  lastBotAct: "answered",
  lastActivityAt: new Date(now.getTime() - 25 * H),
  negativeFeedbackOnLastAnswer: false,
  rating: null,
  ...o,
});

describe("confirmed", () => {
  it("credits the bot unless a human replied", () => {
    expect(confirmedOutcome({ humanReplied: false })).toBe("resolved_by_bot");
    expect(confirmedOutcome({ humanReplied: true })).toBe("resolved_after_handover");
  });
});

describe("assumed after 24h", () => {
  it("waits until 24 hours of inactivity", () => {
    expect(assumedOutcome(facts({ lastActivityAt: new Date(now.getTime() - 23 * H) }), now)).toBeNull();
  });
  it.each<[Partial<ConversationFacts>, string]>([
    [{}, "resolved_by_bot"],
    [{ handedOver: true, humanReplied: true }, "resolved_after_handover"],
    [{ handedOver: true, humanReplied: false }, "escalated_unresolved"],
    [{ lastBotAct: "out_of_scope", answeredCount: 0 }, "out_of_scope"],
    [{ lastBotAct: "blocked" }, "blocked_by_guardrail"],
    [{ lastBotAct: "flow" }, "abandoned"],
    [{ lastBotAct: "fallback", answeredCount: 0 }, "abandoned"],
    [{ negativeFeedbackOnLastAnswer: true }, "abandoned"],
    [{ rating: 1 }, "abandoned"],
  ])("%j → %s", (f, expected) => {
    expect(assumedOutcome(facts(f), now)).toBe(expected);
  });
});

describe("reversal", () => {
  it("reverses only resolutions", () => {
    expect(reversedOutcome("resolved_by_bot")).toBe("abandoned");
    expect(reversedOutcome("resolved_after_handover")).toBe("escalated_unresolved");
    expect(reversedOutcome("out_of_scope")).toBeNull();
  });
  it("applies within 7 days on the same topic", () => {
    const last = new Date(now.getTime() - 6 * 24 * H);
    expect(withinReversalWindow(last, now)).toBe(true);
    expect(withinReversalWindow(new Date(now.getTime() - 8 * 24 * H), now)).toBe(false);
    expect(isSameTopic("treatments#implants", "treatments#implants")).toBe(true);
    expect(isSameTopic("treatments#implants", "treatments#whitening")).toBe(false);
    expect(isSameTopic(null, null)).toBe(false);
  });
});
