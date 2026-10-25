import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  bookingRequests,
  conversations,
  getDb,
  handovers,
  messages,
  turns,
  versions,
  type Source,
} from "@dental-bot/db";
import { detokenise } from "../pii/detect.ts";
import { vaultValues } from "../pii/vault.ts";

export type WidgetMessage = {
  id: number;
  role: "visitor" | "bot" | "staff" | "system";
  kind: string;
  text: string;
  sources: Source[];
  options: string[];
  feedback: number | null;
  authorName: string | null;
};

export async function loadConversation(tenantId: string, conversationId: string) {
  const [conv] = await getDb()
    .select()
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)));
  return conv ?? null;
}

/** Messages with personal data restored. Only for the visitor's own session and the practice screen. */
export async function readableMessages(tenantId: string, conversationId: string, afterId = 0): Promise<WidgetMessage[]> {
  const rows = await getDb()
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, tenantId),
        eq(messages.conversationId, conversationId),
        sql`${messages.id} > ${afterId}`,
      ),
    )
    .orderBy(asc(messages.id));
  const values = await vaultValues(tenantId, conversationId);
  return rows.map((m) => ({
    id: m.id,
    role: m.role,
    kind: m.kind,
    text: detokenise(m.text, values),
    sources: m.sources,
    options: m.options,
    feedback: m.feedback,
    authorName: m.authorName,
  }));
}

export async function conversationDetail(tenantId: string, conversationId: string) {
  const db = getDb();
  const conv = await loadConversation(tenantId, conversationId);
  if (!conv) return null;
  const [version] = await db.select().from(versions).where(eq(versions.id, conv.versionId));
  const msgs = await readableMessages(tenantId, conversationId);
  const turnRows = await db
    .select()
    .from(turns)
    .where(and(eq(turns.tenantId, tenantId), eq(turns.conversationId, conversationId)))
    .orderBy(asc(turns.index));
  const handoverRows = await db
    .select()
    .from(handovers)
    .where(and(eq(handovers.tenantId, tenantId), eq(handovers.conversationId, conversationId)))
    .orderBy(asc(handovers.id));
  const values = await vaultValues(tenantId, conversationId);
  const bookings = (
    await db
      .select()
      .from(bookingRequests)
      .where(and(eq(bookingRequests.tenantId, tenantId), eq(bookingRequests.conversationId, conversationId)))
  ).map((b) => ({ ...b, slots: Object.fromEntries(Object.entries(b.slots).map(([k, v]) => [k, detokenise(v, values)])) }));
  const reveal = (slots: Record<string, string>) => Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, detokenise(v, values)]));
  const lastOfKind = (kind: string) =>
    [...values]
      .filter(([token]) => token.startsWith(`‹${kind}_`))
      .sort(([a], [b]) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")))
      .at(-1)?.[1];
  return {
    typedContact: { name: lastOfKind("NAME"), phone: lastOfKind("PHONE") },
    conversation: conv,
    versionNumber: version?.number ?? null,
    messages: msgs,
    turns: turnRows,
    handovers: handoverRows.map((h) => ({ ...h, contact: reveal(h.contact) })),
    bookings,
  };
}

export async function listConversations(tenantId: string, limit = 100) {
  const db = getDb();
  return db
    .select({
      id: conversations.id,
      startedAt: conversations.startedAt,
      lastActivityAt: conversations.lastActivityAt,
      status: conversations.status,
      outcome: conversations.outcome,
      outcomeBasis: conversations.outcomeBasis,
      topic: conversations.topic,
      rating: conversations.rating,
      isDemo: conversations.isDemo,
      versionNumber: versions.number,
      turns: sql<number>`(select count(*)::int from ${turns} t where t.conversation_id = "conversations"."id")`,
      costUsd: sql<number>`(select coalesce(sum(t.cost_usd), 0)::float from ${turns} t where t.conversation_id = "conversations"."id")`,
      firstMessage: sql<string | null>`(select m.text from ${messages} m where m.conversation_id = "conversations"."id" and m.role = 'visitor' order by m.id limit 1)`,
    })
    .from(conversations)
    .innerJoin(versions, eq(versions.id, conversations.versionId))
    .where(eq(conversations.tenantId, tenantId))
    .orderBy(desc(conversations.lastActivityAt))
    .limit(limit);
}

export async function listHandovers(tenantId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: handovers.id,
      conversationId: handovers.conversationId,
      reason: handovers.reason,
      trigger: handovers.trigger,
      status: handovers.status,
      createdAt: handovers.createdAt,
      repliedAt: handovers.repliedAt,
      contact: handovers.contact,
      lastMessage: sql<string | null>`(select m.text from ${messages} m where m.conversation_id = "handovers"."conversation_id" and m.role = 'visitor' order by m.id desc limit 1)`,
      conversationStatus: sql<string>`(select c.status from ${conversations} c where c.id = "handovers"."conversation_id")`,
      lastRole: sql<string | null>`(select m.role from ${messages} m where m.conversation_id = "handovers"."conversation_id" and m.role <> 'system' order by m.id desc limit 1)`,
    })
    .from(handovers)
    .where(eq(handovers.tenantId, tenantId))
    .orderBy(desc(handovers.createdAt))
    .limit(100);
  const out = [];
  for (const r of rows) {
    const values = await vaultValues(tenantId, r.conversationId);
    out.push({
      ...r,
      lastMessage: r.lastMessage ? detokenise(r.lastMessage, values) : null,
      contact: Object.fromEntries(Object.entries(r.contact).map(([k, v]) => [k, detokenise(v, values)])),
    });
  }
  return out;
}

export async function listBookingRequests(tenantId: string) {
  const rows = await getDb()
    .select()
    .from(bookingRequests)
    .where(eq(bookingRequests.tenantId, tenantId))
    .orderBy(desc(bookingRequests.createdAt))
    .limit(50);
  const out = [];
  for (const r of rows) {
    const values = await vaultValues(tenantId, r.conversationId);
    out.push({ ...r, slots: Object.fromEntries(Object.entries(r.slots).map(([k, v]) => [k, detokenise(v, values)])) });
  }
  return out;
}
