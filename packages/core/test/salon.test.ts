import { describe, expect, it, vi } from "vitest";
import type { FlowState } from "@dental-bot/db/schema";
import { MIKAN_HAIR } from "../src/businesses.ts";
import { demoDiary } from "../src/booking/demo-diary.ts";
import { phorest } from "../src/booking/phorest.ts";
import type { BookingSystem, OfferedSlot, SlotQuery } from "../src/booking/types.ts";
import { wantedDays, wantedHours } from "../src/booking/when.ts";
import { SALON_PACK } from "../src/packs/salon.ts";
import { CALL_ME, MORE_TIMES, NONE_OF_THESE, OTHER_DAY, pickTime, runExecutor } from "../src/runtime/executor.ts";
import { namedDays } from "../src/runtime/flows/salon-booking.ts";
import type { Bundle, ExecutorDeps, HistoryItem, ScoredChunk, TurnResult } from "../src/runtime/types.ts";
import { bundle as dentalBundle, ctx, fakeDeps } from "./fixtures.ts";

const salon: Bundle = {
  ...dentalBundle,
  tenantId: "mikan-hair",
  practice: { name: "Mikan Hair Studio", phone: "020 7946 0588" },
  vertical: "salon",
  booking: { mode: "online", system: "phorest" },
  handoverSources: {
    urgent: [{ page: "Patch tests and aftercare", slug: "patch-tests", heading: "If you have a reaction", anchor: "if-you-have-a-reaction", chunkId: 70 }],
    clinical: [],
  },
};

const NOW = Date.parse("2026-10-27T09:00:00Z");

const TIMES: OfferedSlot[] = [
  { id: "st-hana@2026-10-31T10:30:00.000Z", start: "2026-10-31T10:30:00.000Z", staffId: "st-hana", staffName: "Hana", label: "Sat 31 Oct, 10:30 with Hana" },
  { id: "st-sam@2026-10-31T11:00:00.000Z", start: "2026-10-31T11:00:00.000Z", staffId: "st-sam", staffName: "Sam", label: "Sat 31 Oct, 11:00 with Sam" },
];

function fakeSystem(opts: { times?: OfferedSlot[]; bookFails?: boolean } = {}) {
  const queries: SlotQuery[] = [];
  const booked: Parameters<BookingSystem["book"]>[0][] = [];
  const system: BookingSystem = {
    name: "test diary",
    async availability(q) {
      queries.push(q);
      return opts.times ?? TIMES;
    },
    async book(input) {
      booked.push(input);
      if (opts.bookFails) throw new Error("diary offline");
      return { system: "test diary", ref: "REF-1" };
    },
  };
  return { system, queries, booked };
}

/** One visitor turn; `slot` makes the fake planner set that slot to the visitor's words. */
async function turn(flow: FlowState | null, input: string | { action: "book" }, booking: BookingSystem | null, slot?: string, b = salon) {
  const text = typeof input === "string" ? input : null;
  const { deps } = fakeDeps({ commands: slot && text ? [{ cmd: "set_slot", slot, value: text }] : [] });
  const withBooking: ExecutorDeps = { ...deps, booking, now: () => NOW };
  return runExecutor(
    ctx({ bundle: b, visitorText: text, action: typeof input === "string" ? null : input.action, flow }),
    withBooking,
  );
}

const last = (r: TurnResult) => r.segments.at(-1)!;

/** Walks a colour booking up to the time offer: balayage, long hair, senior stylist, needs a patch test, Saturday morning. */
async function upToTimes(system: BookingSystem | null) {
  let r = await turn(null, { action: "book" }, system);
  expect(last(r).text).toBe(SALON_PACK.booking.prompts.service);
  expect(last(r).options).toEqual(["Cut & style", "Colour", "Highlights or balayage", "Treatment"]);
  r = await turn(r.flow, "Highlights or balayage", system);
  expect(last(r).text).toBe(SALON_PACK.booking.prompts.length);
  r = await turn(r.flow, "Long", system);
  expect(last(r).text).toBe(SALON_PACK.booking.prompts.stylist);
  r = await turn(r.flow, "Senior stylist", system);
  expect(last(r).text).toBe(SALON_PACK.booking.prompts.patch_test);
  r = await turn(r.flow, "No, I need one", system);
  expect(last(r).text).toBe(SALON_PACK.booking.prompts.preferred_time);
  return turn(r.flow, "Saturday morning", system, "preferred_time");
}

describe("salon safety rules", () => {
  it.each([
    ["my scalp is burning since my colour yesterday", "pain_or_symptoms"],
    ["I've come out in a rash after the patch test", "pain_or_symptoms"],
    ["my lips are swelling", "emergency"],
    ["is it safe to bleach my hair while pregnant?", "clinical_advice"],
  ])("hands %j to the salon team without calling the planner", async (text, reason) => {
    const { deps, calls } = fakeDeps();
    const r = await runExecutor(ctx({ bundle: salon, visitorText: text }), deps);
    expect(calls.plan).toBe(0);
    expect(r.handover).toEqual({ reason, trigger: "precheck" });
    expect(r.segments[0]!.text).toContain("020 7946 0588");
    if (reason !== "clinical_advice") expect(r.segments[0]!.text).toMatch(/call 999 now.*NHS 111/s);
  });

  it("doesn't mistake a colour name for a burn", async () => {
    const { deps, calls } = fakeDeps({ commands: [{ cmd: "start_flow", flow: "booking_request" }] });
    const r = await runExecutor(ctx({ bundle: salon, visitorText: "can you do a burnt orange balayage?" }), deps);
    expect(calls.plan).toBe(1);
    expect(r.handover).toBeNull();
  });

  it("keeps the dental rules for the dental practice", async () => {
    const { deps } = fakeDeps({ commands: [{ cmd: "answer_from_knowledge", query: "rash" }] });
    const r = await runExecutor(ctx({ visitorText: "my scalp is burning" }), deps);
    expect(r.handover).toBeNull();
  });
});

describe("salon booking, online", () => {
  it("qualifies the booking, offers times from the diary, and books the one picked", async () => {
    const { system, queries, booked } = fakeSystem();
    let r = await upToTimes(system);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({ service: "Highlights or balayage", stylist: "Senior stylist", preferredTime: "Saturday morning" });
    expect(queries[0]!.earliest.getTime()).toBe(NOW + 48 * 3_600_000);
    expect(last(r).text).toMatch(/from 48 hours ahead to leave time for your patch test/);
    expect(last(r).options).toEqual([...TIMES.map((t) => t.label), NONE_OF_THESE]);

    r = await turn(r.flow, "the second one", system);
    expect(r.flow!.slots).toMatchObject({ slot: TIMES[1]!.label, slot_id: TIMES[1]!.id });
    expect(last(r).text).toBe(SALON_PACK.booking.prompts.name);
    r = await turn(r.flow, "Mia Tanaka", system, "name");
    r = await turn(r.flow, "07700 900321", system, "phone");
    expect(last(r).text).toMatch(/^Here's what I have: Highlights or balayage, long hair, Sat 31 Oct, 11:00 with Sam, for Mia Tanaka/);
    expect(last(r).text).toMatch(/Shall I book this in\?$/);

    r = await turn(r.flow, "yes", system);
    expect(booked).toHaveLength(1);
    expect(booked[0]).toMatchObject({ slot: TIMES[1], service: "Highlights or balayage", client: { name: "Mia Tanaka", phone: "07700 900321" } });
    expect(booked[0]!.note).toMatch(/Patch test needed/);
    expect(r.bookedOnline).toEqual({ system: "test diary", ref: "REF-1" });
    expect(r.booking).toMatchObject({ slot_id: TIMES[1]!.id });
    expect(r.booking).not.toHaveProperty("offered");
    expect(last(r).text).toMatch(/^You're booked in: .*11:00 with Sam\. You'll need a patch test/);
    expect(r.flow).toBeNull();
  });

  it("passes the request to the team when none of the times suit", async () => {
    const { system, booked } = fakeSystem();
    let r = await upToTimes(system);
    r = await turn(r.flow, NONE_OF_THESE, system);
    expect(last(r).text).toBe(SALON_PACK.online!.moreTimes);
    expect(last(r).options).toEqual([MORE_TIMES, OTHER_DAY, CALL_ME]);
    r = await turn(r.flow, CALL_ME, system);
    expect(r.flow!.slots.slot).toBe("none");
    expect(last(r).text).toBe(SALON_PACK.booking.prompts.name);
    r = await turn(r.flow, "Mia", system, "name");
    r = await turn(r.flow, "07700 900321", system, "phone");
    expect(last(r).text).toMatch(/best time Saturday morning.*Shall I send this to the team\?$/s);
    r = await turn(r.flow, "yes", system);
    expect(booked).toHaveLength(0);
    expect(r.bookedOnline).toBeNull();
    expect(last(r).text).toMatch(/The team will call you on 07700 900321 to find a time and book your patch test/);
  });

  it("shows the next free times after the ones turned down", async () => {
    const { system, queries } = fakeSystem();
    let r = await upToTimes(system);
    r = await turn(r.flow, NONE_OF_THESE, system);
    r = await turn(r.flow, MORE_TIMES, system);
    expect(queries).toHaveLength(2);
    expect(queries[1]!.earliest.getTime()).toBe(Date.parse(TIMES[1]!.start) + 60_000);
    expect(queries[1]).toMatchObject({ preferredTime: "Saturday morning" });
    expect(last(r).text).toMatch(/^Here are the next free times/);
    expect(last(r).options).toEqual([...TIMES.map((t) => t.label), NONE_OF_THESE]);
    expect(r.flow!.slots.slot_choice).toBeUndefined();
  });

  it("searches again for a day the visitor names", async () => {
    const { system, queries } = fakeSystem();
    let r = await upToTimes(system);
    r = await turn(r.flow, NONE_OF_THESE, system);
    r = await turn(r.flow, "Friday afternoon instead", system);
    expect(queries).toHaveLength(2);
    expect(queries[1]).toMatchObject({ preferredTime: "Friday afternoon", partOfDay: null });
    expect(last(r).text).toMatch(/^Here are the next free times/);
  });

  it("asks the part of the day when the new day doesn't say it", async () => {
    const { system } = fakeSystem();
    let r = await upToTimes(system);
    r = await turn(r.flow, NONE_OF_THESE, system);
    r = await turn(r.flow, "how about next week?", system);
    expect(r.flow!.slots.preferred_time).toBe("next week");
    expect(last(r).text).toBe(SALON_PACK.booking.prompts.time_of_day);
  });

  it("asks for another day when the visitor wants one but doesn't say which", async () => {
    const { system } = fakeSystem();
    let r = await upToTimes(system);
    r = await turn(r.flow, NONE_OF_THESE, system);
    r = await turn(r.flow, OTHER_DAY, system);
    expect(last(r).text).toBe(SALON_PACK.booking.prompts.preferred_time);
    expect(r.flow!.slots.preferred_time).toBeUndefined();
  });

  it("says so and moves on to a call-back when the diary has nothing free", async () => {
    const { system } = fakeSystem({ times: [] });
    const r = await upToTimes(system);
    expect(r.segments.map((s) => s.text)).toEqual([SALON_PACK.online!.noTimes, SALON_PACK.booking.prompts.name]);
    expect(r.trace.guardrails).toContainEqual(expect.objectContaining({ rule: "booking_system", result: "hit" }));
  });

  it("falls back to a call-back request when booking the time fails", async () => {
    const { system } = fakeSystem({ bookFails: true });
    let r = await upToTimes(system);
    r = await turn(r.flow, "1", system);
    r = await turn(r.flow, "Mia", system, "name");
    r = await turn(r.flow, "07700 900321", system, "phone");
    r = await turn(r.flow, "yes", system);
    expect(r.bookedOnline).toBeNull();
    expect(r.booking).toMatchObject({ slot_id: TIMES[0]!.id });
    expect(last(r).text).toMatch(/couldn't book that time just now.*call you on 07700 900321/);
    expect(r.trace.guardrails).toContainEqual(expect.objectContaining({ rule: "booking_system", detail: expect.stringMatching(/booking failed/) }));
  });

  it("offers new times after the visitor changes the stylist", async () => {
    const { system, queries } = fakeSystem();
    let r = await upToTimes(system);
    r = await turn(r.flow, "Graduate stylist", system, "stylist");
    expect(r.flow!.slots.offered).toBeDefined();
    expect(queries).toHaveLength(2);
    expect(queries[1]!.stylist).toBe("Graduate stylist");
  });

  it("asks no patch test or length for a cut, and no time offer when bookings are call-backs", async () => {
    const callback = { ...salon, booking: { mode: "callback" as const } };
    let r = await turn(null, { action: "book" }, null, undefined, callback);
    r = await turn(r.flow, "Cut & style", null, undefined, callback);
    expect(last(r).text).toBe(SALON_PACK.booking.prompts.stylist);
    r = await turn(r.flow, "No preference", null, undefined, callback);
    expect(last(r).text).toBe(SALON_PACK.booking.prompts.preferred_time);
    r = await turn(r.flow, "Thursday evening", null, "preferred_time", callback);
    expect(last(r).text).toBe(SALON_PACK.booking.prompts.name);
  });
});

describe("picking an offered time", () => {
  const flow: FlowState = { name: "booking_request", step: "slot", slots: { offered: JSON.stringify(TIMES) } };
  it.each([
    ["Sat 31 Oct, 10:30 with Hana", TIMES[0]],
    ["1", TIMES[0]],
    ["the first one please", TIMES[0]],
    ["2nd", TIMES[1]],
    ["last", TIMES[1]],
    ["11:00", TIMES[1]],
    ["Sam", TIMES[1]],
    ["none of these suit me", "none"],
    ["3", null],
    ["sat", null],
  ])("%j", (text, expected) => {
    expect(pickTime(flow, text)).toEqual(expected ?? null);
  });
});

describe("from the second salon label export", () => {
  it("greets briefly", () => {
    expect(SALON_PACK.greeting(salon.practice)).toBe("Hi, I'm the Mikan Hair Studio assistant. How can I help you today?");
  });

  it("passes a wedding hair question it can't answer to the team and asks for contact details", async () => {
    const { deps } = fakeDeps({ commands: [{ cmd: "answer_from_knowledge", query: "Do you do wedding hair trials" }], chunks: [] });
    const r = await runExecutor(ctx({ bundle: salon, visitorText: "Do you do wedding hair trials?" }), deps);
    expect(r.handover).toEqual({ reason: "visitor_request", trigger: "planner" });
    expect(r.segments.map((s) => s.text)).toEqual([
      "That's one for the team, so I've passed your question on. They'll reply here during opening hours, or you can call us on 020 7946 0588.",
      "So the team can get back to you, what's your name?",
    ]);
    expect(r.fallbacks).toBe(0);
  });

  it("still offers to ask the team for other questions it can't answer", async () => {
    const { deps } = fakeDeps({ commands: [{ cmd: "answer_from_knowledge", query: "Do you sell gift cards" }], chunks: [] });
    const r = await runExecutor(ctx({ bundle: salon, visitorText: "Do you sell gift cards?" }), deps);
    expect(r.handover).toBeNull();
    expect(r.act).toBe("fallback");
  });

  it("hands a pregnancy question over without talking about medical advice", async () => {
    const { deps } = fakeDeps();
    const r = await runExecutor(ctx({ bundle: salon, visitorText: "is it safe to bleach my hair while pregnant?" }), deps);
    expect(r.segments[0]!.text).toBe(
      "That's one for our team, as the answer depends on you, so I've passed your question on. They'll reply here during opening hours, or you can call us on 020 7946 0588.",
    );
  });

  it("books a cut with a senior stylist from start to finish, as labelled good", async () => {
    const { system, booked } = fakeSystem();
    let r = await turn(null, { action: "book" }, system);
    r = await turn(r.flow, "Cut & style", system);
    expect(last(r).text).toBe(SALON_PACK.booking.prompts.stylist);
    r = await turn(r.flow, "Senior stylist", system);
    expect(last(r).text).toBe(SALON_PACK.booking.prompts.preferred_time);
    r = await turn(r.flow, "wednesday 10am", system, "preferred_time");
    expect(last(r).text).toBe("Here are the next free times with a senior stylist. Which suits you?");
    r = await turn(r.flow, TIMES[0]!.label, system);
    expect(last(r).text).toBe(SALON_PACK.booking.prompts.name);
    r = await turn(r.flow, "Mia", system, "name");
    r = await turn(r.flow, "07700 900321", system, "phone");
    expect(last(r).text).toBe(`Here's what I have: Cut & style, ${TIMES[0]!.label}, for Mia on 07700 900321. Shall I book this in?`);
    r = await turn(r.flow, "Yes, please", system);
    expect(booked).toHaveLength(1);
    expect(last(r).text).toBe(
      `You're booked in: Cut & style, ${TIMES[0]!.label}. To change it, call us on 020 7946 0588. Is there anything else I can help with before your visit?`,
    );
  });
});

describe("salon follow-up offers", () => {
  const chunk = (heading: string, text: string): ScoredChunk => ({
    chunkId: 90, page: "Salon", slug: "salon", heading, anchor: "a", text, score: 0.9, keywordScore: 0.2,
  });
  const WELCOME: HistoryItem = { role: "bot", text: "Hi, I'm the Mikan Hair Studio assistant." };

  /** A question answered from one section, with the chat so far. */
  async function ask(text: string, heading: string, history: HistoryItem[] = [WELCOME]) {
    const { deps } = fakeDeps({
      commands: [{ cmd: "answer_from_knowledge", query: text }],
      chunks: [chunk(heading, "Saturday: 9am to 6pm. Every Tuesday and Wednesday, 20% off.")],
      composed: "Here's the answer [1].",
    });
    const r = await runExecutor(ctx({ bundle: salon, visitorText: text, history, answeredBefore: history.filter((h) => h.role === "visitor").length, bookingOffered: history.some((h) => h.kind === "suggest") }), deps);
    return { r, offer: r.segments.find((s) => s.kind === "suggest")?.text ?? null };
  }

  it.each([
    ["Do I need a patch test for a toner?", "Patch tests before colour", "A patch test takes five minutes and you can walk in for one. Would you like me to book your toner for at least 48 hours after?"],
    ["Do you have any offers on colour?", "Midweek colour days", "Would you like me to look for a Tuesday or Wednesday time for your colour?"],
    ["Do you take walk-ins?", "Do you take walk-ins?", "Would you like me to book you a time instead, so you're sure of a stylist?"],
    ["How long does balayage take?", "Highlights and balayage", "Would you like me to find you a time for a balayage?"],
    ["How much is a cut and blow-dry with a senior stylist?", "Cut and style", "Would you like me to find you a time for a cut & style with a senior stylist?"],
  ])("%j gets an offer that follows on from it", async (text, heading, expected) => {
    expect((await ask(text, heading)).offer).toBe(expected);
  });

  it("offers again when a later question adds a detail, carrying the earlier ones over", async () => {
    const earlier = "Would you like me to find you a time for a cut & style with a senior stylist?";
    const history: HistoryItem[] = [
      WELCOME,
      { role: "visitor", text: "How much is a cut and blow-dry with a senior stylist?" },
      { role: "bot", text: "Cut and blow-dry: senior stylist £75." },
      { role: "bot", text: earlier, kind: "suggest" },
    ];
    const { offer } = await ask("Are you open on Saturdays?", "Opening hours", history);
    expect(offer).toBe("Would you like me to find you a time on Saturdays for a cut & style with a senior stylist?");
  });

  it("doesn't repeat an offer, or offer again after \"Not right now\" or a booking", async () => {
    const offer = "Would you like me to find you a time for a balayage?";
    const asked = { role: "visitor", text: "How long does balayage take?" } as const;
    expect((await ask("Can I bring my dog?", "Can I bring my dog?", [WELCOME, asked, { role: "bot", text: offer, kind: "suggest" }])).offer).toBe(null);
    const declined: HistoryItem[] = [WELCOME, asked, { role: "bot", text: "Would you like…", kind: "suggest" }, { role: "visitor", text: "Not right now" }, { role: "bot", text: "No problem. Just ask if anything else comes up." }];
    expect((await ask("Are you open on Saturdays?", "Opening hours", declined)).offer).toBe(null);
    const { deps } = fakeDeps({ commands: [{ cmd: "answer_from_knowledge", query: "q" }], chunks: [chunk("Opening hours", "Saturday: 9am to 6pm.")], composed: "Open [1]." });
    const r = await runExecutor(ctx({ bundle: salon, visitorText: "Are you open on Saturdays?", history: [WELCOME, asked], bookingOffered: true, bookingClosed: true }), deps);
    expect(r.segments.some((s) => s.kind === "suggest")).toBe(false);
  });

  it("starts the booking with what the visitor has already said", async () => {
    const offer = "Would you like me to look for a Tuesday or Wednesday time for your colour?";
    const history: HistoryItem[] = [
      WELCOME,
      { role: "visitor", text: "Do you have any offers on colour with a senior stylist?" },
      { role: "bot", text: "Every Tuesday and Wednesday, 20% off." },
      { role: "bot", text: offer, kind: "suggest" },
    ];
    const { deps } = fakeDeps();
    const r = await runExecutor(ctx({ bundle: salon, visitorText: "Yes please", history }), { ...deps, booking: fakeSystem().system, now: () => NOW });
    expect(r.flow!.slots).toEqual({ service: "Colour", stylist: "Senior stylist", preferred_time: "Tuesday or Wednesday" });
    expect(last(r).text).toBe(`Lovely, a colour with a senior stylist on Tuesday or Wednesday. ${SALON_PACK.booking.prompts.length}`);
  });

  it("reads the days a visitor names", () => {
    expect(namedDays("Are you open on Saturdays?")).toBe("Saturdays");
    expect(namedDays("tuesday or thursday, maybe Tuesday")).toBe("Tuesday or Thursday");
    expect(namedDays("any weekends?")).toBe("weekends");
    expect(namedDays("after work")).toBeNull();
  });
});

describe("demo diary", () => {
  const query = (over: Partial<SlotQuery> = {}): SlotQuery => ({
    service: "Cut & style",
    stylist: null,
    earliest: new Date("2026-10-26T08:00:00Z"),
    preferredTime: null,
    partOfDay: null,
    timeZone: "Europe/London",
    ...over,
  });

  it("only offers times inside opening hours, on the days and part of day asked for, with the level asked for", async () => {
    const diary = demoDiary(MIKAN_HAIR);
    const times = await diary.availability(query({ service: "Balayage", stylist: "Senior stylist", preferredTime: "Saturdays", partOfDay: "morning" }));
    expect(times.length).toBeGreaterThan(0);
    for (const t of times) {
      expect(["Hana", "Sam"]).toContain(t.staffName);
      expect(t.label).toMatch(/^Sat \d+ \w+, (09|10|11):\d\d with (Hana|Sam)$/);
    }
  });

  it("never offers Monday or Sunday, or a colour that would run past closing", async () => {
    const diary = demoDiary(MIKAN_HAIR);
    const times = await diary.availability(query({ service: "Full head colour", preferredTime: "evenings" }));
    for (const t of times) expect(t.label).toMatch(/^(Tue|Wed|Thu|Fri) .*, (17|18):\d\d/);
  });

  it("finds a stylist by name and gives the same times for the same question", async () => {
    const a = await demoDiary(MIKAN_HAIR).availability(query({ stylist: "Leo" }));
    const b = await demoDiary(MIKAN_HAIR).availability(query({ stylist: "Leo" }));
    expect(a.map((t) => t.staffName)).toEqual(a.map(() => "Leo"));
    expect(b).toEqual(a);
  });

  it("books a time once", async () => {
    const diary = demoDiary(MIKAN_HAIR);
    const [slot] = await diary.availability(query({ stylist: "Mei", preferredTime: "Friday" }));
    const booked = await diary.book({ slot: slot!, service: "Cut", client: { name: "Mia", phone: "07700 900321" }, note: "" });
    expect(booked.ref).toMatch(/^DEMO-/);
    await expect(diary.book({ slot: slot!, service: "Cut", client: { name: "Jo", phone: "07700 900111" }, note: "" })).rejects.toThrow(/taken/);
    const again = await diary.availability(query({ stylist: "Mei", preferredTime: "Friday" }));
    expect(again.map((t) => t.id)).not.toContain(slot!.id);
  });

  it("doesn't offer or book a time saved as booked before a restart", async () => {
    const [slot] = await demoDiary(MIKAN_HAIR).availability(query({ stylist: "Leo", preferredTime: "Thursday" }));
    const diary = demoDiary(MIKAN_HAIR, async () => [slot!.id]);
    const again = await diary.availability(query({ stylist: "Leo", preferredTime: "Thursday" }));
    expect(again.map((t) => t.id)).not.toContain(slot!.id);
    await expect(diary.book({ slot: slot!, service: "Cut", client: { name: "Mia", phone: "07700 900321" }, note: "" })).rejects.toThrow(/taken/);
  });

  it("reads days and parts of the day from the visitor's words", () => {
    expect([...wantedDays("Tuesday or Thursday")!]).toEqual([2, 4]);
    expect([...wantedDays("weekends")!]).toEqual([0, 6]);
    expect(wantedDays("tomorrow (Sat 31 Oct)")).toBeNull();
    expect(wantedHours("after work", null)).toEqual([17, 24]);
    expect(wantedHours("Saturday", "morning")).toEqual([0, 12]);
    expect(wantedHours("whenever", "any time")).toBeNull();
  });
});

describe("Phorest adapter", () => {
  const config = {
    baseUrl: "https://phorest.test/api",
    businessId: "biz",
    branchId: "br",
    username: "api@mikan.example",
    password: "secret",
    services: { cut: "svc-cut", highlights: "svc-hl" },
    staff: { Hana: "ph-hana", Sam: "ph-sam" },
  };

  function fakeFetch(routes: Record<string, unknown>) {
    const calls: { method: string; url: string; body: unknown; auth: string | null }[] = [];
    const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push({ method: init?.method ?? "GET", url: u, body: init?.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init?.headers).get("authorization") });
      const key = Object.keys(routes).find((k) => `${init?.method ?? "GET"} ${u}`.includes(k));
      return new Response(JSON.stringify(key ? routes[key] : {}), { status: key ? 200 : 404 });
    });
    return { impl: impl as unknown as typeof fetch, calls };
  }

  it("asks for times for the service and senior stylists, and keeps the ones on the days asked for", async () => {
    const { impl, calls } = fakeFetch({
      "POST https://phorest.test/api/business/biz/branch/br/appointments/availability": {
        availableSlots: [
          { startTime: "2026-10-30T10:00:00Z", staffId: "ph-hana" },
          { startTime: "2026-10-31T10:00:00Z", staffId: "ph-hana" },
          { startTime: "2026-10-31T11:00:00Z", staffId: "ph-other" },
          { startTime: "2026-10-31T12:00:00Z", clientServiceSchedules: [{ serviceSchedules: [{ staffId: "ph-sam" }] }] },
        ],
      },
    });
    const system = phorest(MIKAN_HAIR, config, impl);
    const times = await system.availability({
      service: "Balayage",
      stylist: "Senior stylist",
      earliest: new Date("2026-10-28T09:00:00Z"),
      preferredTime: "Saturday",
      partOfDay: null,
      timeZone: "Europe/London",
    });
    expect(calls[0]!.auth).toBe(`Basic ${Buffer.from("global/api@mikan.example:secret").toString("base64")}`);
    expect(calls[0]!.body).toMatchObject({
      startTime: "2026-10-28T09:00:00.000Z",
      isOnlineAvailability: true,
      clientServiceSelections: [{ serviceSelections: [{ serviceId: "svc-hl" }] }],
    });
    expect(times.map((t) => t.label)).toEqual(["Sat 31 Oct, 10:00 with Hana", "Sat 31 Oct, 12:00 with Sam"]);
  });

  it("creates the client when the mobile isn't known, then books the time", async () => {
    const { impl, calls } = fakeFetch({
      "GET https://phorest.test/api/business/biz/client?mobile=07700900321": { _embedded: { clients: [] } },
      "POST https://phorest.test/api/business/biz/client": { clientId: "cl-1" },
      "POST https://phorest.test/api/business/biz/branch/br/booking": { bookingId: "bk-9" },
    });
    const system = phorest(MIKAN_HAIR, config, impl);
    const booked = await system.book({
      slot: { id: "ph-hana@x", start: "2026-10-31T10:00:00.000Z", staffId: "ph-hana", staffName: "Hana", label: "" },
      service: "Cut & style",
      client: { name: "Mia Tanaka", phone: "07700 900321" },
      note: "Booked by the website assistant.",
    });
    expect(booked).toEqual({ system: "Phorest", ref: "bk-9" });
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "POST"]);
    expect(calls[1]!.body).toMatchObject({ firstName: "Mia", lastName: "Tanaka", mobile: "07700900321" });
    expect(calls[2]!.body).toEqual({
      clientId: "cl-1",
      bookingStatus: "ACTIVE",
      note: "Booked by the website assistant.",
      clientAppointmentSchedules: [{ clientId: "cl-1", serviceSchedules: [{ serviceId: "svc-cut", startTime: "2026-10-31T10:00:00.000Z", staffId: "ph-hana" }] }],
    });
  });

  it("fails loudly on an API error, so the chat falls back to a call-back", async () => {
    const { impl } = fakeFetch({});
    const system = phorest(MIKAN_HAIR, config, impl);
    await expect(
      system.availability({ service: "Cut", stylist: null, earliest: new Date(), preferredTime: null, partOfDay: null, timeZone: "Europe/London" }),
    ).rejects.toThrow(/Phorest POST availability: 404/);
  });
});
