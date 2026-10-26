import { describe, expect, it } from "vitest";
import { runExecutor } from "../src/runtime/executor.ts";
import { MORE, openingPills, overview, pillLabel } from "../src/runtime/menu.ts";
import { DENTAL_PACK } from "../src/packs/dental.ts";
import { SALON_PACK } from "../src/packs/salon.ts";
import type { Bundle, ExecutorDeps, HistoryItem, ScoredChunk, Section } from "../src/runtime/types.ts";
import { bundle as base, ctx, fakeDeps } from "./fixtures.ts";

let id = 100;
const section = (slug: string, page: string, heading: string, text: string): Section => ({
  chunkId: id++,
  page,
  slug,
  heading,
  anchor: heading.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  text,
});
const T = "Treatments and prices";
const dentalSections = [
  section("contact", "Opening hours and contact", "Opening hours", "Monday: 8am to 6pm\nSaturday: 9am to 1pm"),
  section("contact", "Opening hours and contact", "How to contact us", "- Phone: 020 7946 0321"),
  section("contact", "Opening hours and contact", "Getting here", "We are a four-minute walk from Canada Water station. There is no on-site parking."),
  section("treatments", T, "Check-ups and hygiene", "New patient examination (45 minutes, includes two small x-rays): £85 (private price)\nHygienist appointment (30 minutes): £75 (private price)"),
  section("treatments", T, "Fillings and root canal treatment", "White filling: from £140 (private price)\nRoot canal treatment, front tooth: from £450 (private price)\nRoot canal treatment, back tooth: from £650 (private price)"),
  section("treatments", T, "Crowns, bridges and dentures", "Porcelain crown: from £650 (private price)\nBridge, per tooth: from £650 (private price)"),
  section("treatments", T, "Extractions", "Simple extraction: £150 (private price)\nSurgical extraction: from £250 (private price)"),
  section("treatments", T, "Cosmetic treatments", "Teeth whitening (home kit with custom trays): £350 (private price)\nComposite bonding, per tooth: from £180 (private price)\nTeeth whitening is only available privately and only after a check-up."),
  section("treatments", T, "NHS charges", "Band 1: examination, x-rays and scale and polish: £27.40\nBand 2: fillings and extractions: £75.30"),
  section("treatments", T, "Paying for treatment", "We take card and contactless payments."),
  section("nhs-private-faq", "NHS and private FAQ", "Are you taking new NHS patients?", "We are accepting new NHS patients under 18."),
  section("nhs-private-faq", "NHS and private FAQ", "What is the difference between NHS and private treatment?", "NHS treatment covers everything that is clinically necessary. Private treatment gives you more choice."),
  section("emergencies", "Emergencies", "Call 999 or go to A&E", "Call 999 if swelling affects your breathing."),
  section("book", "Book an appointment", "How to book", "Use the chat."),
];
const dental: Bundle = { ...base, sections: dentalSections };
const salonSections = [
  section("contact", "Opening hours and contact", "Getting here", "Our nearest station is Turnham Green."),
  section("prices", "Services and prices", "Cut and style", "Cut and blow-dry: graduate stylist £45; senior stylist £75\nRestyle: graduate stylist £55; senior stylist £85"),
  section("prices", "Services and prices", "Colour", "Root colour (up to 2cm regrowth): from £68 (price)\nFull head colour: from £85 (price)"),
  section("prices", "Services and prices", "Highlights and balayage", "Half head foils: from £110 (price)\nBalayage: from £160 (price)"),
  section("prices", "Services and prices", "Treatments", "Japanese repair treatment (with blow-dry): from £48 (price)\nScalp treatment: £40 (price)"),
  section("prices", "Services and prices", "Paying", "We take card."),
];
const salon: Bundle = { ...base, vertical: "salon", practice: { name: "Mikan Hair Studio", phone: "020 7946 0588" }, sections: salonSections };

const asChunk = (s: Section, score = 0.8): ScoredChunk => ({ ...s, score, keywordScore: 0 });

/** Records which sections each answer was written from. */
function recording(composed: (query: string) => string, chunks: ScoredChunk[] = dentalSections.map((s) => asChunk(s))) {
  const { deps, calls } = fakeDeps({ chunks, composed });
  const used: string[][] = [];
  const compose: ExecutorDeps["compose"] = (q, cs, b, c) => {
    used.push(cs.map((x) => x.heading));
    return deps.compose(q, cs, b, c);
  };
  return { deps: { ...deps, compose }, calls, used };
}

const bot = (text: string, options: string[], kind = "clarify"): HistoryItem => ({ role: "bot", text, options, kind });

describe("pill labels", () => {
  it("shortens headings, keeps questions", () => {
    expect(pillLabel("Fillings and root canal treatment")).toBe("Fillings & root canal");
    expect(pillLabel("Check-ups and hygiene")).toBe("Check-ups & hygiene");
    expect(pillLabel("Cosmetic treatments")).toBe("Cosmetic treatments");
    expect(pillLabel("Do you see children?")).toBe("Do you see children?");
  });
});

describe("opening pills", () => {
  it("opens on the first-level topics at home, the page's own sections elsewhere, and none on booking or emergencies", () => {
    expect(openingPills(DENTAL_PACK, dental, "")).toEqual(["Services", "Opening hours", "Find us"]);
    expect(openingPills(SALON_PACK, salon, null)).toEqual(["Services", "Prices", "Find us"]);
    expect(openingPills(DENTAL_PACK, dental, "treatments")).toEqual(["Check-ups & hygiene", "Fillings & root canal", "Crowns, bridges & dentures", MORE]);
    expect(openingPills(DENTAL_PACK, dental, "nhs-private-faq")).toEqual(["Are you taking new NHS patients?", "What is the difference between NHS and private treatment?"]);
    expect(openingPills(DENTAL_PACK, dental, "book")).toEqual([]);
    expect(openingPills(DENTAL_PACK, dental, "emergencies")).toEqual([]);
  });

  it("never offers the team, payment or NHS charges as a pill", () => {
    const all = ["", "treatments", "contact"].flatMap((p) => openingPills(DENTAL_PACK, dental, p));
    expect(all.join(" ")).not.toMatch(/contact us|talk|paying|NHS charges/i);
  });
});

describe("tapping pills", () => {
  it("lists services three at a time, then the rest after More…", async () => {
    const { deps, calls } = recording(() => "NO_ANSWER");
    const r = await runExecutor(ctx({ bundle: dental, visitorText: "Services" }), deps);
    expect(calls.plan).toBe(0);
    expect(r.segments[0]!.text).toBe("Which of our services would you like to know about?");
    expect(r.segments[0]!.options).toEqual(["Check-ups & hygiene", "Fillings & root canal", "Crowns, bridges & dentures", MORE]);

    const more = await runExecutor(ctx({ bundle: dental, visitorText: MORE, history: [bot(r.segments[0]!.text, r.segments[0]!.options)] }), deps);
    expect(more.segments[0]!.options).toEqual(["Extractions", "Cosmetic treatments"]);
  });

  it("says what a service covers without prices, then offers its prices", async () => {
    const { deps } = recording(() => "NO_ANSWER");
    const history = [bot("Which of our services would you like to know about?", ["Check-ups & hygiene", MORE])];
    const r = await runExecutor(ctx({ bundle: dental, visitorText: "Check-ups & hygiene", history }), deps);
    expect(r.segments[0]!.text).toBe("Check-ups and hygiene: new patient examination and hygienist appointment.");
    expect(r.segments[0]!.text).not.toMatch(/£/);
    expect(r.segments[0]!.options).toEqual(["Check-ups & hygiene prices", "Other services"]);
    expect(r.segments).toHaveLength(1);
  });

  it("keeps a note that isn't a price", () => {
    expect(overview(dentalSections.find((s) => s.heading === "Cosmetic treatments")!)).toBe(
      "Cosmetic treatments: teeth whitening and composite bonding. Teeth whitening is only available privately and only after a check-up.",
    );
  });

  it("answers opening hours and finding us from just that section", async () => {
    const { deps, used } = recording(() => "We are a four-minute walk from Canada Water station [1].");
    const r = await runExecutor(ctx({ bundle: dental, visitorText: "Find us" }), deps);
    expect(used).toEqual([["Getting here"]]);
    expect(r.segments[0]!.text).toContain("Canada Water");
  });

  it("falls back to the section's own opening lines when the reply writer has nothing", async () => {
    const { deps } = recording(() => "NO_ANSWER");
    const r = await runExecutor(ctx({ bundle: dental, visitorText: "Opening hours" }), deps);
    expect(r.segments[0]!.kind).toBe("answer");
    expect(r.segments[0]!.text).toBe("Monday: 8am to 6pm. Saturday: 9am to 1pm.");
  });

  it("goes straight to salon prices, where there is no NHS question", async () => {
    const { deps, used } = recording(() => "Full head colour is from £85 [1].", salonSections.map((s) => asChunk(s)));
    const r = await runExecutor(ctx({ bundle: salon, visitorText: "Prices" }), deps);
    expect(r.segments[0]!.text).toBe(SALON_PACK.price.lead);
    expect(r.segments[0]!.options).toEqual(["Cut & style", "Colour", "Highlights & balayage", MORE]);
    const colour = await runExecutor(ctx({ bundle: salon, visitorText: "Colour", history: [bot(SALON_PACK.price.lead, r.segments[0]!.options)] }), deps);
    expect(used).toEqual([["Colour"]]);
    expect(colour.segments[0]!.text).toContain("£85");
  });

  it("answers in prices mode on the salon prices page, from the opening pills", async () => {
    const { deps, used } = recording(() => "Root colour is from £68 [1].", salonSections.map((s) => asChunk(s)));
    const greeting = bot(SALON_PACK.greeting(salon.practice, "prices"), ["Cut & style", "Colour"], "greeting");
    await runExecutor(ctx({ bundle: salon, visitorText: "Colour", history: [greeting], page: "prices" }), deps);
    expect(used).toEqual([["Colour"]]);
  });

  it("treats a pill's words typed without the pill as an ordinary question", async () => {
    const { deps, calls } = recording(() => "NO_ANSWER");
    await runExecutor(ctx({ bundle: dental, visitorText: "Extractions" }), deps);
    expect(calls.plan).toBe(1);
  });
});

describe("NHS or private before prices", () => {
  const Q = "Are you an NHS or private patient?";
  const asked = (question: string, options = ["NHS", "Private", "Not sure"]): HistoryItem[] => [
    { role: "visitor", text: question },
    bot(Q, options),
  ];

  it("asks first, for a typed price question and for a prices pill", async () => {
    const { deps, calls } = recording(() => "NO_ANSWER");
    const typed = await runExecutor(ctx({ bundle: dental, profile: {}, visitorText: "How much is a filling?" }), deps);
    expect(calls.plan).toBe(0);
    expect(typed.segments.map((s) => [s.text, s.options])).toEqual([[Q, ["NHS", "Private", "Not sure"]]]);

    const history = [bot("Check-ups and hygiene: new patient examination.", ["Check-ups & hygiene prices", "Other services"], "answer")];
    const pill = await runExecutor(ctx({ bundle: dental, profile: {}, visitorText: "Check-ups & hygiene prices", history }), deps);
    expect(pill.segments[0]!.text).toBe(Q);
  });

  it("doesn't ask when the question already says", async () => {
    const { deps } = recording(() => "NHS fillings are Band 2, £75.30 [1].");
    const r = await runExecutor(ctx({ bundle: dental, profile: {}, visitorText: "How much is an NHS filling?" }), deps);
    expect(r.segments[0]!.text).not.toBe(Q);
  });

  it("answers the original question from the private list, and remembers", async () => {
    const ranked = ["Fillings and root canal treatment", "NHS charges"].map((h) => asChunk(dentalSections.find((x) => x.heading === h)!));
    const { deps, used } = recording(() => "A white filling is from £140 [1].", [ranked[1]!, ranked[0]!]);
    const r = await runExecutor(ctx({ bundle: dental, profile: {}, visitorText: "Private", history: asked("How much is a filling?") }), deps);
    expect(r.profile.care).toBe("private");
    expect(used[0]).not.toContain("NHS charges");
    expect(r.segments[0]!.text).toContain("£140");
  });

  it("answers NHS patients from the NHS charges only", async () => {
    const { deps, used } = recording(() => "On the NHS, fillings are Band 2, £75.30 [1].");
    const r = await runExecutor(ctx({ bundle: dental, profile: {}, visitorText: "NHS", history: asked("Check-ups & hygiene prices") }), deps);
    expect(r.profile.care).toBe("NHS");
    expect(used).toEqual([["NHS charges"]]);
  });

  it("explains the difference for Not sure, and asks once more without Not sure", async () => {
    const { deps } = recording(() => "NO_ANSWER");
    const r = await runExecutor(ctx({ bundle: dental, profile: {}, visitorText: "Not sure", history: asked("How much is a crown?") }), deps);
    expect(r.segments[0]!.text).toContain("clinically necessary");
    expect(r.segments.at(-1)!.text).toBe(Q);
    expect(r.segments.at(-1)!.options).toEqual(["NHS", "Private"]);
    expect(r.profile.care).toBeUndefined();
  });

  it("asks nothing in the salon", async () => {
    const { deps } = recording(() => "A cut and blow-dry with a senior stylist is £75 [1].", [asChunk(salonSections[1]!)]);
    const r = await runExecutor(ctx({ bundle: salon, visitorText: "How much is a cut and blow-dry?" }), deps);
    expect(r.segments[0]!.text).toContain("£75");
  });
});
