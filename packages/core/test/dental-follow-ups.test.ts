import { describe, expect, it } from "vitest";
import { runExecutor } from "../src/runtime/executor.ts";
import * as T from "../src/runtime/templates.ts";
import { ctx, fakeDeps, hygieneChunk } from "./fixtures.ts";

describe("dental follow-up offers", () => {
  it("offers the booking that follows from the answer, and starts it with what it names", async () => {
    const { deps } = fakeDeps({ commands: [{ cmd: "answer_from_knowledge", query: "hygienist price" }], chunks: [{ ...hygieneChunk, score: 0.75 }], composed: "A hygienist appointment is £75 [1]." });
    const r = await runExecutor(ctx({ visitorText: "hygienist price please" }), deps);
    const offer = "Would you like me to ask the team to call you to book a hygienist appointment?";
    expect(r.segments.at(-1)).toMatchObject({ kind: "suggest", text: offer, options: T.OFFER_OPTIONS });
    const { deps: next } = fakeDeps();
    const yes = await runExecutor(ctx({ visitorText: "Yes please", history: [{ role: "bot", text: offer, kind: "suggest" }] }), next);
    expect(yes.flow!.slots).toMatchObject({ reason: "Hygienist appointment" });
    expect(yes.segments.at(-1)!.text.startsWith("Of course, a hygienist appointment.")).toBe(true);
  });
});
