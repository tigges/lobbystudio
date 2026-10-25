import { and, desc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { conversations, getDb, messages } from "@dental-bot/db";
import {
  ASSUME_AFTER_MS,
  assumedOutcome,
  isSameTopic,
  REVERSAL_WINDOW_MS,
  reversedOutcome,
  type Outcome,
} from "../outcomes.ts";

/** A new conversation on the same topic within 7 days reverses an earlier resolution. */
export async function reverseIfReturning(opts: {
  tenantId: string;
  visitorId: string;
  conversationId: string;
  topic: string;
  at: Date;
}) {
  const db = getDb();
  const since = new Date(opts.at.getTime() - REVERSAL_WINDOW_MS);
  const previous = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, opts.tenantId),
        eq(conversations.visitorId, opts.visitorId),
        ne(conversations.id, opts.conversationId),
        gt(conversations.lastActivityAt, since),
        lt(conversations.startedAt, opts.at),
        inArray(conversations.outcome, ["resolved_by_bot", "resolved_after_handover"]),
      ),
    )
    .orderBy(desc(conversations.lastActivityAt));
  for (const p of previous) {
    if (!isSameTopic(p.topic, opts.topic)) continue;
    const reversed = reversedOutcome(p.outcome as Outcome);
    if (!reversed) continue;
    await db
      .update(conversations)
      .set({ outcome: reversed, outcomeBasis: "reversed", outcomeAt: opts.at, reversedByConversationId: opts.conversationId })
      .where(eq(conversations.id, p.id));
  }
}

/** Assigns assumed outcomes to conversations inactive for 24 hours. Safe to run repeatedly. */
export async function sweepOutcomes(now = new Date()): Promise<{ assigned: number }> {
  const db = getDb();
  const cutoff = new Date(now.getTime() - ASSUME_AFTER_MS);
  const stale = await db
    .select()
    .from(conversations)
    .where(and(isNull(conversations.outcome), lt(conversations.lastActivityAt, cutoff)))
    .limit(500);

  let assigned = 0;
  for (const c of stale) {
    const [lastAnswer] = await db
      .select({ feedback: messages.feedback })
      .from(messages)
      .where(and(eq(messages.conversationId, c.id), eq(messages.kind, "answer")))
      .orderBy(desc(messages.id))
      .limit(1);
    let outcome = assumedOutcome(
      {
        handedOver: Boolean(c.handedOverAt),
        humanReplied: Boolean(c.lastHumanAt),
        answeredCount: c.answeredCount,
        fallbackCount: c.fallbackCount,
        lastBotAct: c.lastBotAct,
        lastActivityAt: c.lastActivityAt,
        negativeFeedbackOnLastAnswer: lastAnswer?.feedback === -1,
        rating: c.rating,
      },
      now,
    );
    if (!outcome) continue;
    let basis: "assumed" | "reversed" = "assumed";
    let reversedBy: string | null = null;

    const reversed = reversedOutcome(outcome);
    if (reversed && c.topic) {
      const [returned] = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.tenantId, c.tenantId),
            eq(conversations.visitorId, c.visitorId),
            ne(conversations.id, c.id),
            eq(conversations.topic, c.topic),
            gt(conversations.startedAt, c.lastActivityAt),
            lt(conversations.startedAt, sql`${c.lastActivityAt}::timestamptz + interval '7 days'`),
          ),
        )
        .limit(1);
      if (returned) {
        outcome = reversed;
        basis = "reversed";
        reversedBy = returned.id;
      }
    }

    await db
      .update(conversations)
      .set({
        outcome,
        outcomeBasis: basis,
        outcomeAt: now,
        reversedByConversationId: reversedBy,
        status: "closed",
      })
      .where(eq(conversations.id, c.id));
    assigned += 1;
  }
  return { assigned };
}
