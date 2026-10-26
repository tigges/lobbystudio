import { describe, expect, it } from "vitest";
import { composeUserMessage } from "../src/runtime/live.ts";
import { offlineCompose, offlinePlan } from "../src/runtime/offline.ts";
import { DENTAL_BOOKING } from "../src/runtime/flows/booking-request.ts";
import { SALON_BOOKING } from "../src/runtime/flows/salon-booking.ts";
import { profileLine, updateProfile, withProfile } from "../src/runtime/profile.ts";
import { runExecutor } from "../src/runtime/executor.ts";
import type { Bundle, ScoredChunk } from "../src/runtime/types.ts";
import { bundle, ctx, fakeDeps } from "./fixtures.ts";

const salon: Bundle = { ...bundle, vertical: "salon", booking: { mode: "callback" }, practice: { name: "Mikan Hair Studio", phone: "020 7946 0588" } };

describe("visitor profile", () => {
  it("keeps what the visitor tells us about their hair and visit", () => {
    const p = updateProfile(SALON_BOOKING, {}, ["How much is balayage with a senior stylist?", "My hair is long", "I had a patch test in May", "It's my first time with you"], null);
    expect(p).toEqual({ service: "Balayage", stylist: "Senior stylist", length: "long", patch_test: "done", client: "new" });
  });
  it("doesn't take a question about patch tests as an answer", () => {
    expect(updateProfile(SALON_BOOKING, {}, ["Do I need a patch test for a toner?"], null)).toEqual({ service: "Toner" });
  });
  it("reads new NHS patients and the treatment for the dental practice", () => {
    expect(updateProfile(DENTAL_BOOKING, {}, ["Are you taking new NHS patients?", "How much is a hygienist appointment?"], null)).toEqual({
      patient: "new",
      care: "NHS",
      reason: "Hygienist appointment",
    });
  });
  it("keeps booking answers but nothing personal", () => {
    const flow = { name: "booking_request" as const, step: "phone", slots: { service: "Colour", stylist: "Stylist", name: "‹NAME_1›", offered: "[]" } };
    expect(updateProfile(SALON_BOOKING, { length: "short" }, [], flow)).toEqual({ length: "short", service: "Colour", stylist: "Stylist" });
    expect(profileLine({ service: "Colour", client: "new" }, SALON_BOOKING)).toBe("Service: Colour; New or returning client: new");
  });
  it("turns a follow-up into a standalone question", () => {
    const p = { service: "Balayage", stylist: "Senior stylist" };
    expect(withProfile("How long does it take?", p, SALON_BOOKING)).toBe("How long does it take (balayage)?");
    expect(withProfile("How much is that?", p, SALON_BOOKING)).toBe("How much is that (balayage with a senior stylist)?");
    expect(withProfile("How much is a cut?", p, SALON_BOOKING)).toBe("How much is a cut?");
    expect(withProfile("Do you have parking?", p, SALON_BOOKING)).toBe("Do you have parking?");
  });
});

describe("using the profile", () => {
  it("starts a dental booking with what the visitor has said", async () => {
    const { deps } = fakeDeps({ commands: [{ cmd: "start_flow", flow: "booking_request" }] });
    const r = await runExecutor(ctx({ visitorText: "I'd like to book", profile: { reason: "Check-up", patient: "new", care: "private" } }), deps);
    expect(r.flow!.slots).toEqual({ reason: "Check-up", patient: "new", care: "private" });
    expect(r.segments.at(-1)!.text).toBe(`Of course, a check-up. ${DENTAL_BOOKING.prompts.preferred_time}`);
  });
  it("returns the updated profile with the turn", async () => {
    const { deps } = fakeDeps({ commands: [{ cmd: "answer_from_knowledge", query: "price" }] });
    const r = await runExecutor(ctx({ bundle: salon, visitorText: "How much is a colour with a graduate stylist?", profile: { length: "long" } }), deps);
    expect(r.profile).toEqual({ length: "long", service: "Colour", stylist: "Graduate stylist" });
  });
  it("lets the offline planner and writer use it", async () => {
    const plan = await offlinePlan(ctx({ bundle: salon, visitorText: "how much would that be?", profile: { service: "Cut & style", stylist: "Senior stylist" } }));
    expect(plan.commands).toEqual([{ cmd: "answer_from_knowledge", query: "how much would that be (cut & style with a senior stylist)?" }]);
    const chunk: ScoredChunk = { ...bundle.handoverSources.urgent[0]!, text: "Colour, graduate stylist: £80\nColour, senior stylist: £120", score: 0.9, keywordScore: 0.2 } as ScoredChunk;
    const { stream } = offlineCompose("How much is a colour?", [chunk], { recent: [], profile: { stylist: "Senior stylist" } });
    let text = "";
    for await (const t of stream) text += t;
    expect(text.startsWith("Colour, senior stylist: £120")).toBe(true);
  });
  it("shows the reply writer the recent messages and the profile", () => {
    const msg = composeUserMessage("How long does balayage take?", [], "Monday 10:00", "salon", {
      recent: [{ role: "visitor", text: "Do you do balayage?" }, { role: "bot", text: "Yes, from £150." }],
      profile: {},
      known: "Service: Balayage",
    });
    expect(msg).toContain("Visitor: Do you do balayage?\nAssistant: Yes, from £150.");
    expect(msg).toContain("What the visitor has told us: Service: Balayage.");
  });
});
