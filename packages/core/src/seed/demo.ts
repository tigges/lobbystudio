import { and, desc, eq } from "drizzle-orm";
import { getDb, messages } from "@dental-bot/db";
import { staffReply } from "../services/handovers.ts";
import { recordFeedback, runTurn, startSession } from "../services/turns.ts";

type Step =
  | string
  | { action: "book" | "handover" }
  | { staff: string; author: string; label?: boolean }
  | { rating: number }
  | { thumbs: 1 | -1 };

type Script = { visitor: string; hoursAgo: number; steps: Step[] };

const HARBOUR_DENTAL_SCRIPTS: Script[] = [
  {
    visitor: "demo-v01",
    hoursAgo: 9 * 24,
    steps: ["How much is a hygienist appointment?", "Are you open on Saturdays?", "perfect, thanks!", { rating: 5 }],
  },
  {
    visitor: "demo-v02",
    hoursAgo: 8 * 24 + 5,
    steps: [{ action: "book" }, "Sarah Collins", "07700 900123", "Tuesday evenings", "yes"],
  },
  {
    visitor: "demo-v03",
    hoursAgo: 8 * 24,
    steps: [
      "my jaw is swollen on one side and really painful",
      {
        staff: "Hi, this is Jess at Harbour Dental. We have an emergency slot at 2:40pm today with Dr Okafor. Shall I hold it for you?",
        author: "Jess Morgan",
      },
      "yes please, thank you",
    ],
  },
  { visitor: "demo-v04", hoursAgo: 7 * 24, steps: ["Are you taking new NHS patients?"] },
  { visitor: "demo-v05", hoursAgo: 6 * 24 + 3, steps: ["Do you offer treatment for sleep apnoea?"] },
  { visitor: "demo-v06", hoursAgo: 6 * 24, steps: ["what's the weather going to be like tomorrow"] },
  { visitor: "demo-v07", hoursAgo: 5 * 24 + 2, steps: ["can I speak to someone about my bill please"] },
  { visitor: "demo-v08", hoursAgo: 5 * 24, steps: ["How much is teeth whitening?"] },
  { visitor: "demo-v08", hoursAgo: 3 * 24, steps: ["how much does teeth whitening cost", "thanks"] },
  { visitor: "demo-v09", hoursAgo: 4 * 24, steps: ["I'd like to book a hygienist appointment", "Priya"] },
  { visitor: "demo-v10", hoursAgo: 3 * 24 + 4, steps: ["How long is a new patient examination?", { thumbs: -1 }] },
  {
    visitor: "demo-v11",
    hoursAgo: 2 * 24,
    steps: [
      "should I take ibuprofen before my extraction tomorrow?",
      {
        staff: "Hi, it's Dr Lindqvist. Please don't take anything new before we see you; we'll go through your medicines at the appointment.",
        author: "Dr Tom Lindqvist",
        label: true,
      },
    ],
  },
  { visitor: "demo-v12", hoursAgo: 30, steps: ["Is there parking near the practice?", "and is it step-free?", "great thanks"] },
  { visitor: "demo-v13", hoursAgo: 3, steps: ["Do you do evening appointments?"] },
  { visitor: "demo-v14", hoursAgo: 1, steps: ["I chipped my front tooth on a fork, can someone see me today?"] },
];

const MIKAN_HAIR_SCRIPTS: Script[] = [
  {
    visitor: "demo-s01",
    hoursAgo: 8 * 24,
    steps: ["How much is a cut and blow-dry with a senior stylist?", "Are you open on Saturdays?", "lovely, thanks!", { rating: 5 }],
  },
  {
    visitor: "demo-s02",
    hoursAgo: 7 * 24 + 4,
    steps: [{ action: "book" }, "Balayage", "Long", "Senior stylist", "No, I need one", "Saturday morning", "1", "Chloe Hart", "07700 900456", "yes"],
  },
  {
    visitor: "demo-s03",
    hoursAgo: 6 * 24,
    steps: [
      "my scalp has been really itchy and red since my colour on Saturday",
      {
        staff: "Hi, it's Hana. I'm sorry to hear that. Please rinse with cool water and call us on 020 7946 0588 so we can talk it through; if it gets worse, speak to a pharmacist.",
        author: "Hana Ito",
      },
      "thank you, will call now",
    ],
  },
  { visitor: "demo-s04", hoursAgo: 5 * 24 + 2, steps: ["Do I need a patch test for a toner?"] },
  { visitor: "demo-s05", hoursAgo: 5 * 24, steps: ["Do you do wedding hair trials?"] },
  { visitor: "demo-s06", hoursAgo: 4 * 24, steps: [{ action: "book" }, "Cut & style", "Stylist", "Thursday evening", "None of these suit me", "Tom", "07700 900789", "yes"] },
  {
    visitor: "demo-s07",
    hoursAgo: 3 * 24,
    steps: [
      "is it safe to bleach my hair while pregnant?",
      {
        staff: "Hi, it's Aiko. Many clients colour during pregnancy, but please check with your midwife first, and we'll do a fresh patch test before any colour.",
        author: "Aiko Mori",
        label: true,
      },
    ],
  },
  { visitor: "demo-s08", hoursAgo: 2 * 24, steps: ["Do you have any offers on colour?", "and can I bring my dog?"] },
  { visitor: "demo-s09", hoursAgo: 20, steps: ["How long does balayage take?", { thumbs: -1 }] },
  { visitor: "demo-s10", hoursAgo: 2, steps: ["Do you take walk-ins?"] },
];

/** Scripted visitors per business, run through the real runtime with the offline planner so seeding needs no API key. */
export const DEMO_SCRIPTS: Record<string, Script[]> = {
  "harbour-dental": HARBOUR_DENTAL_SCRIPTS,
  "mikan-hair": MIKAN_HAIR_SCRIPTS,
};

export async function seedDemoConversations(tenantId: string, now = new Date()) {
  let count = 0;
  for (const script of DEMO_SCRIPTS[tenantId] ?? []) {
    let at = new Date(now.getTime() - script.hoursAgo * 3_600_000);
    const tick = () => (at = new Date(at.getTime() + 35_000));
    const session = await startSession({ tenantId, visitorId: script.visitor, isDemo: true, now: at });
    const conversationId = session.conversationId;
    for (const step of script.steps) {
      tick();
      if (typeof step === "string") {
        await runTurn({ tenantId, conversationId, text: step, now: at, mode: "offline" });
      } else if ("action" in step) {
        await runTurn({ tenantId, conversationId, action: step.action, now: at, mode: "offline" });
      } else if ("staff" in step) {
        at = new Date(at.getTime() + 6 * 60_000);
        await staffReply({
          tenantId,
          conversationId,
          text: step.staff,
          author: step.author,
          saveAsLabel: step.label ?? true,
          now: at,
        });
      } else if ("rating" in step) {
        await recordFeedback({ tenantId, conversationId, rating: step.rating });
      } else if ("thumbs" in step) {
        const [last] = await getDb()
          .select({ id: messages.id })
          .from(messages)
          .where(and(eq(messages.conversationId, conversationId), eq(messages.kind, "answer")))
          .orderBy(desc(messages.id))
          .limit(1);
        if (last) await recordFeedback({ tenantId, conversationId, messageId: last.id, value: step.thumbs });
      }
    }
    count += 1;
  }
  return count;
}
