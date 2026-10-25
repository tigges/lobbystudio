import { describe, expect, it } from "vitest";
import { DENTAL_PACK } from "../src/packs/dental.ts";
import { SALON_PACK } from "../src/packs/salon.ts";
import * as T from "../src/runtime/templates.ts";
import { askedBefore, heldReason } from "../src/services/learned.ts";

describe("which team answers are published straight away", () => {
  const ok = { reason: "visitor_request" as const, asked: "Do you do wedding hair trials?", answer: "Yes, trials are £85 and take about 90 minutes.", pack: SALON_PACK };
  it("publishes a general answer to a general question", () => {
    expect(heldReason(ok)).toBeNull();
  });
  it("holds safety topics, personal details and answers about one visitor's own visit", () => {
    expect(heldReason({ ...ok, reason: "clinical_advice" })).toBe("safety topic");
    expect(heldReason({ ...ok, pack: DENTAL_PACK, asked: "My tooth is throbbing, what should I take?" })).toBe("safety topic");
    expect(heldReason({ ...ok, answer: "Hi ‹NAME_1›, yes, trials are £85." })).toBe("personal details");
    expect(heldReason({ ...ok, answer: "I've booked your trial for Saturday at 10." })).toBe("about this visitor's own visit");
    expect(heldReason({ ...ok, answer: "Yes!" })).toBe("too short to stand on its own");
  });
});

describe("the question behind a handover", () => {
  it("skips buttons and contact details to find the real question", () => {
    const messages = [
      { text: "hi", kind: "text" },
      { text: "Do you do wedding hair?", kind: "text" },
      { text: "Yes, ask the team", kind: "text" },
      { text: "‹NAME_1›", kind: "text" },
      { text: "Talk to the salon", kind: "action" },
    ];
    expect(askedBefore(messages, ["Yes, ask the team"])).toBe("Do you do wedding hair?");
  });
  it("uses the last thing said when nothing reads as a question", () => {
    expect(askedBefore([{ text: "bridal hair for 5 people", kind: "text" }], [])).toBe("bridal hair for 5 people");
    expect(askedBefore([], [])).toBeNull();
  });
});

describe("asking about a learned answer", () => {
  it("doesn't double the question mark when the heading is a question", () => {
    expect(T.nearMiss("Can I pay with Klarna?")).toBe("Just to check, do you mean “Can I pay with Klarna?”");
    expect(T.nearMissHeading(T.nearMiss("Can I pay with Klarna?"))).toBe("Can I pay with Klarna?");
    expect(T.nearMissHeading(T.nearMiss("Getting here"))).toBe("Getting here");
  });
});
