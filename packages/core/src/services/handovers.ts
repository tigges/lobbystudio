import { and, asc, desc, eq, gt } from "drizzle-orm";
import { conversations, getDb, handovers, labelledAnswers, messages } from "@dental-bot/db";
import { tokeniseForConversation } from "../pii/vault.ts";
import { loadConversation } from "./conversations.ts";

/**
 * The practice replies in the visitor's chat. With `saveAsLabel`, the reply is stored as the
 * labelled correct answer to the visitor's question(s) since the handover.
 */
export async function staffReply(opts: {
  tenantId: string;
  conversationId: string;
  text: string;
  author: string;
  saveAsLabel: boolean;
  now?: Date;
}) {
  const db = getDb();
  const now = opts.now ?? new Date();
  const conv = await loadConversation(opts.tenantId, opts.conversationId);
  if (!conv) throw new Error("conversation not found");
  const { text } = await tokeniseForConversation(opts.tenantId, conv.id, opts.text.trim());

  await db.insert(messages).values({
    tenantId: opts.tenantId,
    conversationId: conv.id,
    role: "staff",
    kind: "text",
    text,
    authorName: opts.author,
    createdAt: now,
  });
  await db
    .update(conversations)
    .set({ lastHumanAt: now, lastActivityAt: now })
    .where(eq(conversations.id, conv.id));

  const [handover] = await db
    .select()
    .from(handovers)
    .where(and(eq(handovers.tenantId, opts.tenantId), eq(handovers.conversationId, conv.id)))
    .orderBy(desc(handovers.id))
    .limit(1);
  if (handover && handover.status === "open") {
    await db.update(handovers).set({ status: "replied", repliedAt: now }).where(eq(handovers.id, handover.id));
  }

  if (opts.saveAsLabel && handover) {
    const priorMessages = await db
      .select({ id: messages.id, role: messages.role, text: messages.text, createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.conversationId, conv.id), eq(messages.role, "visitor")))
      .orderBy(asc(messages.id));
    const triggerIndex = priorMessages.findLastIndex((m) => m.createdAt <= handover.createdAt);
    const question = priorMessages
      .slice(Math.max(triggerIndex, 0))
      .map((m) => m.text)
      .join("\n");
    await db.insert(labelledAnswers).values({
      tenantId: opts.tenantId,
      conversationId: conv.id,
      handoverId: handover.id,
      question,
      answer: text,
      author: opts.author,
      createdAt: now,
    });
  }
}

/** Returns the conversation to the bot. */
export async function releaseToBot(opts: { tenantId: string; conversationId: string; now?: Date }) {
  const db = getDb();
  const now = opts.now ?? new Date();
  await db
    .update(conversations)
    .set({ status: "active", flow: null, lastActivityAt: now })
    .where(and(eq(conversations.tenantId, opts.tenantId), eq(conversations.id, opts.conversationId)));
  await db
    .update(handovers)
    .set({ status: "released" })
    .where(and(eq(handovers.tenantId, opts.tenantId), eq(handovers.conversationId, opts.conversationId), gt(handovers.id, 0)));
  await db.insert(messages).values({
    tenantId: opts.tenantId,
    conversationId: opts.conversationId,
    role: "system",
    kind: "released",
    text: "The practice team has handed you back to the assistant.",
    createdAt: now,
  });
}

export async function labelledAnswersFor(tenantId: string) {
  return getDb()
    .select()
    .from(labelledAnswers)
    .where(eq(labelledAnswers.tenantId, tenantId))
    .orderBy(desc(labelledAnswers.createdAt));
}
