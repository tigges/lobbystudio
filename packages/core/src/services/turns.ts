import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  bookingRequests,
  conversations,
  getDb,
  handovers,
  messages,
  turns,
  type FlowState,
} from "@dental-bot/db";
import { llmMode, type LlmMode } from "../config.ts";
import { confirmedOutcome } from "../outcomes.ts";
import { detokenise } from "../pii/detect.ts";
import { tokeniseForConversation, vaultValues } from "../pii/vault.ts";
import { searchChunks } from "../retrieval/search.ts";
import { runExecutor } from "../runtime/executor.ts";
import { nextBookingStep } from "../runtime/flows/booking-request.ts";
import { liveCompose, livePlan } from "../runtime/live.ts";
import { offlineCompose, offlinePlan } from "../runtime/offline.ts";
import { greeting } from "../runtime/templates.ts";
import type { ExecutorDeps, ExecutorEvent, HistoryItem, TurnResult } from "../runtime/types.ts";
import { loadBundle, promotedVersionId } from "../versions.ts";
import { loadConversation, readableMessages, type WidgetMessage } from "./conversations.ts";
import { reverseIfReturning } from "./outcomes.ts";

export type TurnEvent =
  | ExecutorEvent
  | {
      type: "done";
      turnId: number;
      status: "active" | "handed_over";
      booking: boolean;
      messages: { segmentId: string; messageId: number }[];
    };

const RESUME_WITHIN_MS = 24 * 60 * 60 * 1000;

export function depsFor(mode: LlmMode): ExecutorDeps {
  return mode === "live"
    ? { plan: livePlan, retrieve: (q, b) => searchChunks(q, b), compose: liveCompose }
    : { plan: offlinePlan, retrieve: (q, b) => searchChunks(q, b), compose: (q, c) => offlineCompose(q, c) };
}

export async function startSession(opts: {
  tenantId: string;
  visitorId: string;
  conversationId?: string | null;
  isDemo?: boolean;
  now?: Date;
}): Promise<{
  conversationId: string;
  versionNumber: number;
  status: string;
  /** A booking request is in progress, so the widget hides its own Book button. */
  booking: boolean;
  practice: { name: string; phone: string };
  messages: WidgetMessage[];
}> {
  const now = opts.now ?? new Date();
  const db = getDb();
  if (opts.conversationId) {
    const conv = await loadConversation(opts.tenantId, opts.conversationId);
    if (
      conv &&
      conv.visitorId === opts.visitorId &&
      conv.status !== "closed" &&
      now.getTime() - conv.lastActivityAt.getTime() < RESUME_WITHIN_MS
    ) {
      const bundle = await loadBundle(conv.versionId);
      return {
        conversationId: conv.id,
        versionNumber: bundle.versionNumber,
        status: conv.status,
        booking: (conv.flow as FlowState | null)?.name === "booking_request",
        practice: bundle.practice,
        messages: await readableMessages(opts.tenantId, conv.id),
      };
    }
  }

  const versionId = await promotedVersionId(opts.tenantId);
  const bundle = await loadBundle(versionId);
  const [conv] = await db
    .insert(conversations)
    .values({
      tenantId: opts.tenantId,
      visitorId: opts.visitorId,
      versionId,
      isDemo: opts.isDemo ?? false,
      startedAt: now,
      lastActivityAt: now,
    })
    .returning();
  await db.insert(messages).values({
    tenantId: opts.tenantId,
    conversationId: conv!.id,
    role: "bot",
    kind: "greeting",
    text: greeting(bundle.practice),
    createdAt: now,
  });
  return {
    conversationId: conv!.id,
    versionNumber: bundle.versionNumber,
    status: conv!.status,
    booking: false,
    practice: bundle.practice,
    messages: await readableMessages(opts.tenantId, conv!.id),
  };
}

const ACTION_LABELS = { book: "Book an appointment", handover: "Talk to the practice" } as const;

export async function runTurn(opts: {
  tenantId: string;
  conversationId: string;
  text?: string | null;
  action?: "book" | "handover" | null;
  emit?: (e: TurnEvent) => void;
  now?: Date;
  mode?: LlmMode;
  /** Commit of the app serving the turn, recorded so reviews can tell builds apart. */
  build?: string | null;
}): Promise<{ result: TurnResult; turnId: number }> {
  const db = getDb();
  const emit = opts.emit ?? (() => {});
  const now = opts.now ?? new Date();
  const mode = opts.mode ?? llmMode();
  const conv = await loadConversation(opts.tenantId, opts.conversationId);
  if (!conv) throw new Error("conversation not found");
  if (conv.status === "closed") throw new Error("conversation is closed");
  const bundle = await loadBundle(conv.versionId);
  const action = opts.action ?? null;
  const rawText = opts.text?.trim() || null;
  if (!rawText && !action) throw new Error("text or action required");

  const flow = conv.flow as FlowState | null;
  const expectingName =
    (flow?.name === "booking_request" && flow.step !== "change" && nextBookingStep(flow) === "name") ||
    (flow?.name === "handover" && flow.step === "name");
  const tokenised = rawText
    ? (await tokeniseForConversation(opts.tenantId, conv.id, rawText, { expectingName })).text
    : null;

  const historyRows = await db
    .select({ role: messages.role, text: messages.text })
    .from(messages)
    .where(and(eq(messages.tenantId, opts.tenantId), eq(messages.conversationId, conv.id)))
    .orderBy(desc(messages.id))
    .limit(12);
  const history: HistoryItem[] = historyRows.reverse();

  const [{ offered }] = (await db
    .select({
      offered: sql<boolean>`exists (select 1 from ${messages} m where m.conversation_id = "conversations"."id" and m.kind = 'suggest')
        or exists (select 1 from ${bookingRequests} b where b.conversation_id = "conversations"."id")`,
    })
    .from(conversations)
    .where(eq(conversations.id, conv.id))) as [{ offered: boolean }];

  const [{ n: turnIndex }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(turns)
    .where(eq(turns.conversationId, conv.id))) as [{ n: number }];

  await db.insert(messages).values({
    tenantId: opts.tenantId,
    conversationId: conv.id,
    role: "visitor",
    kind: action ? "action" : "text",
    text: tokenised ?? ACTION_LABELS[action!],
    createdAt: now,
  });

  const values = await vaultValues(opts.tenantId, conv.id);
  const started = Date.now();
  const result = await runExecutor(
    {
      visitorText: tokenised,
      action,
      flow,
      status: conv.status,
      history,
      bundle,
      lastBotAct: conv.lastBotAct,
      answeredBefore: conv.answeredCount,
      bookingOffered: offered || Boolean(conv.handedOverAt),
      teamReplied: Boolean(conv.lastHumanAt && conv.handedOverAt && conv.lastHumanAt >= conv.handedOverAt),
    },
    depsFor(mode),
    (e) => emit(e.type === "delta" ? { ...e, text: detokenise(e.text, values) } : e),
  );
  const latencyMs = Date.now() - started;
  const calls = result.trace.modelCalls;

  const [turn] = await db
    .insert(turns)
    .values({
      tenantId: opts.tenantId,
      conversationId: conv.id,
      index: turnIndex,
      versionId: bundle.versionId,
      versionNumber: bundle.versionNumber,
      contentVersionNumber: bundle.contentVersionNumber,
      llmMode: calls.length ? mode : result.trace.plannerSkipped ? "none" : mode,
      input: tokenised ?? `[action:${action}]`,
      commands: result.trace.commands,
      rejectedCommands: result.trace.rejected,
      modelCalls: calls,
      inputTokens: calls.reduce((s, c) => s + c.inputTokens, 0),
      outputTokens: calls.reduce((s, c) => s + c.outputTokens, 0),
      costUsd: calls.reduce((s, c) => s + c.costUsd, 0),
      latencyMs,
      firstTokenMs: result.trace.firstTokenMs,
      retrieved: result.trace.retrieved,
      guardrails: result.trace.guardrails,
      flowBefore: flow,
      flowAfter: result.flow,
      error: result.trace.error,
      build: opts.build ?? null,
      decidedBy: result.trace.plannerSkipped,
      createdAt: now,
    })
    .returning({ id: turns.id });

  const messageIds: { segmentId: string; messageId: number }[] = [];
  for (const seg of result.segments) {
    const [m] = await db
      .insert(messages)
      .values({
        tenantId: opts.tenantId,
        conversationId: conv.id,
        turnId: turn!.id,
        role: "bot",
        kind: seg.kind,
        text: seg.text,
        sources: seg.sources,
        options: seg.options,
        createdAt: now,
      })
      .returning({ id: messages.id });
    messageIds.push({ segmentId: seg.id, messageId: m!.id });
  }

  if (result.booking) {
    await db.insert(bookingRequests).values({
      tenantId: opts.tenantId,
      conversationId: conv.id,
      slots: result.booking,
      createdAt: now,
    });
  }
  if (result.handover) {
    await db.insert(handovers).values({
      tenantId: opts.tenantId,
      conversationId: conv.id,
      reason: result.handover.reason,
      trigger: result.handover.trigger,
      contact: result.contact ?? {},
      createdAt: now,
    });
  } else if (result.contact) {
    const [latest] = await db
      .select({ id: handovers.id })
      .from(handovers)
      .where(and(eq(handovers.tenantId, opts.tenantId), eq(handovers.conversationId, conv.id)))
      .orderBy(desc(handovers.id))
      .limit(1);
    if (latest) await db.update(handovers).set({ contact: result.contact }).where(eq(handovers.id, latest.id));
  }

  const somethingResolved = conv.answeredCount + result.answered > 0 || Boolean(conv.lastHumanAt);
  const confirmed = (result.affirmed && somethingResolved) || result.act === "flow_completed";
  const substantive = !["acknowledged", "waiting"].includes(result.act);
  await db
    .update(conversations)
    .set({
      flow: result.flow,
      status: result.status,
      topic: conv.topic ?? result.topic,
      answeredCount: conv.answeredCount + result.answered,
      fallbackCount: conv.fallbackCount + result.fallbacks,
      lastBotAct: substantive ? result.act : conv.lastBotAct,
      lastActivityAt: now,
      lastVisitorAt: now,
      handedOverAt: result.handover ? now : conv.handedOverAt,
      affirmedAt: result.affirmed ? now : conv.affirmedAt,
      outcome: confirmed ? confirmedOutcome({ humanReplied: Boolean(conv.lastHumanAt) }) : null,
      outcomeBasis: confirmed ? "confirmed" : null,
      outcomeAt: confirmed ? now : null,
    })
    .where(eq(conversations.id, conv.id));

  if (!conv.topic && result.topic) {
    await reverseIfReturning({
      tenantId: opts.tenantId,
      visitorId: conv.visitorId,
      conversationId: conv.id,
      topic: result.topic,
      at: now,
    });
  }

  emit({ type: "done", turnId: turn!.id, status: result.status, booking: result.flow?.name === "booking_request", messages: messageIds });
  return { result, turnId: turn!.id };
}

export async function recordFeedback(opts: {
  tenantId: string;
  conversationId: string;
  messageId?: number;
  value?: 1 | -1 | 0;
  rating?: number;
}) {
  const db = getDb();
  if (opts.messageId && opts.value !== undefined) {
    await db
      .update(messages)
      .set({ feedback: opts.value === 0 ? null : opts.value })
      .where(
        and(
          eq(messages.tenantId, opts.tenantId),
          eq(messages.conversationId, opts.conversationId),
          eq(messages.id, opts.messageId),
          eq(messages.role, "bot"),
        ),
      );
  }
  if (opts.rating !== undefined) {
    const rating = Math.max(1, Math.min(5, Math.round(opts.rating)));
    const conv = await loadConversation(opts.tenantId, opts.conversationId);
    if (!conv) return;
    const someoneAnswered = !conv.handedOverAt || Boolean(conv.lastHumanAt);
    const confirm = rating >= 4 && !conv.outcome && someoneAnswered;
    await db
      .update(conversations)
      .set({
        rating,
        ...(confirm
          ? {
              outcome: confirmedOutcome({ humanReplied: Boolean(conv.lastHumanAt) }),
              outcomeBasis: "confirmed" as const,
              outcomeAt: new Date(),
            }
          : {}),
      })
      .where(and(eq(conversations.tenantId, opts.tenantId), eq(conversations.id, opts.conversationId)));
  }
}

export async function turnsFor(tenantId: string, conversationId: string) {
  return getDb()
    .select()
    .from(turns)
    .where(and(eq(turns.tenantId, tenantId), eq(turns.conversationId, conversationId)))
    .orderBy(asc(turns.index));
}
