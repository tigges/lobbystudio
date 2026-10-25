import { describe, expect, it } from "vitest";
import { parseSentence, SentenceSplitter } from "../src/runtime/compose.ts";
import { checkGrounding, clinicalOutputCheck, clinicalPrecheck, isAffirmation, yesNo } from "../src/runtime/guardrails.ts";

describe("clinicalPrecheck", () => {
  it.each(["I have toothache", "my gum is bleeding", "swollen jaw", "is this normal?", "can I take paracetamol", "I chipped a tooth"])(
    "hits on %j",
    (t) => expect(clinicalPrecheck(t).hit).toBe(true),
  );
  it.each(["how much is a check-up", "are you open on Saturday", "do you take NHS patients", "where do I park"])(
    "passes %j",
    (t) => expect(clinicalPrecheck(t).hit).toBe(false),
  );
});

describe("checkGrounding", () => {
  const cited = "White filling: from £140 (private price)\nHygienist appointment (30 minutes): £75";
  it("accepts numbers present in the cited text", () => {
    expect(checkGrounding("A hygienist visit is 30 minutes and costs £75.", cited).ok).toBe(true);
  });
  it("rejects a number that is not in the cited text", () => {
    expect(checkGrounding("It costs £80.", cited)).toMatchObject({ ok: false, rule: "ungrounded_number" });
  });
  it("treats £1,000 and 1000 as the same fact", () => {
    expect(checkGrounding("Over £1,000 you can spread the cost.", "over £1000 can be spread").ok).toBe(true);
  });
  it("requires the from qualifier when the page has one", () => {
    expect(checkGrounding("Fillings are £140.", cited)).toMatchObject({ ok: false, rule: "price_qualifier" });
    expect(checkGrounding("Fillings start from £140.", cited).ok).toBe(true);
  });
  it("flags clinical advice", () => {
    expect(clinicalOutputCheck("You should rinse with salt water.").ok).toBe(false);
    expect(clinicalOutputCheck("We open at 8am.").ok).toBe(true);
  });
});

describe("affirmations and yes/no", () => {
  it.each(["thanks", "thank you!", "perfect, thanks", "great thanks", "that's all", "cheers"])("%j is an affirmation", (t) =>
    expect(isAffirmation(t)).toBe(true),
  );
  it.each(["thanks, but how much is it?", "great, can I book?", "no thanks I want a person"])("%j is not", (t) =>
    expect(isAffirmation(t)).toBe(false),
  );
  it("reads yes and no", () => {
    expect(yesNo("yes please")).toBe("yes");
    expect(yesNo("Yep")).toBe("yes");
    expect(yesNo("no, wrong number")).toBe("no");
    expect(yesNo("maybe tomorrow")).toBeNull();
  });
});

describe("citations", () => {
  it("parses trailing citations in either position", () => {
    expect(parseSentence("It costs £75 [1].")).toEqual({ text: "It costs £75.", cites: [1] });
    expect(parseSentence("It costs £75. [1][2]")).toEqual({ text: "It costs £75.", cites: [1, 2] });
    expect(parseSentence("No citation here.")).toEqual({ text: "No citation here.", cites: [] });
  });
  it("splits a stream into cited sentences regardless of chunk boundaries", () => {
    const s = new SentenceSplitter();
    const out = [...s.push("We open at 8a"), ...s.push("m [1]. On Sat"), ...s.push("urday 9am [2]."), ...s.flush()];
    expect(out.map((x) => parseSentence(x))).toEqual([
      { text: "We open at 8am.", cites: [1] },
      { text: "On Saturday 9am.", cites: [2] },
    ]);
  });
});
