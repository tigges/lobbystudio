import { and, asc, desc, eq, gt } from "drizzle-orm";
import { conversations, getDb, handovers, labelledAnswers, messages, tenants } from "@dental-bot/db";
import { packFor } from "../packs/index.ts";
import type { HandoverReason } from "../runtime/commands.ts";
import { tokeniseForConversation } from "../pii/vault.ts";
import * as T from "../runtime/templates.ts";
import { loadConversation } from "./conversations.ts";
import { askedBefore, learn } from "./learned.ts";

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
  // A reply takes the chat back from the assistant, so the visitor's answer reaches the team.
  const takeBack = conv.status === "active";
  await db
    .update(conversations)
    .set({
      lastHumanAt: now,
      lastActivityAt: now,
      ...(takeBack ? { status: "handed_over" as const, flow: { name: "handover" as const, step: "waiting", slots: {} } } : {}),
    })
    .where(eq(conversations.id, conv.id));

  const [handover] = await db
    .select()
    .from(handovers)
    .where(and(eq(handovers.tenantId, opts.tenantId), eq(handovers.conversationId, conv.id)))
    .orderBy(desc(handovers.id))
    .limit(1);
  if (handover && handover.status !== "replied") {
    await db.update(handovers).set({ status: "replied", repliedAt: now }).where(eq(handovers.id, handover.id));
  }

  if (opts.saveAsLabel && handover) {
    const priorMessages = await db
      .select({ id: messages.id, role: messages.role, text: messages.text, kind: messages.kind, createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.conversationId, conv.id), eq(messages.role, "visitor")))
      .orderBy(asc(messages.id));
    const triggerIndex = priorMessages.findLastIndex((m) => m.createdAt <= handover.createdAt);
    const question = priorMessages
      .slice(Math.max(triggerIndex, 0))
      .map((m) => m.text)
      .join("\n");
    const [saved] = await db
      .insert(labelledAnswers)
      .values({
        tenantId: opts.tenantId,
        conversationId: conv.id,
        handoverId: handover.id,
        question,
        answer: text,
        author: opts.author,
        createdAt: now,
      })
      .returning({ id: labelledAnswers.id });
    const [tenant] = await db.select({ vertical: tenants.vertical }).from(tenants).where(eq(tenants.id, opts.tenantId));
    const pack = packFor(tenant?.vertical);
    const asked = askedBefore(
      priorMessages.filter((m) => m.createdAt <= handover.createdAt),
      [...T.ASK_TEAM_OPTIONS, T.SOMETHING_ELSE, T.BOOK_OPTION, pack.labels.talk],
    );
    // Learning is a bonus: the reply has already reached the visitor, so a failure here only leaves the answer held.
    await learn({ id: saved!.id, reason: handover.reason as HandoverReason, asked, answer: text, pack }).catch((err: Error) =>
      db.update(labelledAnswers).set({ heldReason: `couldn't be indexed: ${err.message}` }).where(eq(labelledAnswers.id, saved!.id)),
    );
  }
}

/** Staff confirm or correct the visitor's contact details, e.g. after a phone call. Stored as vault tokens. */
export async function setHandoverContact(opts: { tenantId: string; conversationId: string; name: string; phone: string }) {
  const db = getDb();
  const [handover] = await db
    .select()
    .from(handovers)
    .where(and(eq(handovers.tenantId, opts.tenantId), eq(handovers.conversationId, opts.conversationId)))
    .orderBy(desc(handovers.id))
    .limit(1);
  if (!handover) throw new Error("no handover for this conversation");
  const contact: Record<string, string> = handover.contact.details ? { details: handover.contact.details } : {};
  for (const [key, raw] of [
    ["name", opts.name],
    ["phone", opts.phone],
  ] as const) {
    const value = raw.trim();
    if (!value) continue;
    const { text } = await tokeniseForConversation(opts.tenantId, opts.conversationId, value, { expectingName: key === "name" });
    contact[key] = text;
  }
  await db.update(handovers).set({ contact }).where(eq(handovers.id, handover.id));
}

/** Returns the conversation to the bot. */
export async function releaseToBot(opts: { tenantId: string; conversationId: string; now?: Date }) {
  const db = getDb();
  const now = opts.now ?? new Date();
  const [tenant] = await db.select({ vertical: tenants.vertical }).from(tenants).where(eq(tenants.id, opts.tenantId));
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
    text: packFor(tenant?.vertical).released,
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
