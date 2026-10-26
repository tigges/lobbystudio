import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, getPool, labelledAnswers, turns, type LearnedStatus } from "@dental-bot/db";
import type { HandoverReason } from "../runtime/commands.ts";
import { clinicalPrecheck } from "../runtime/guardrails.ts";
import * as T from "../runtime/templates.ts";
import type { ScoredChunk } from "../runtime/types.ts";
import { embed } from "../retrieval/embed.ts";
import type { Pack } from "../packs/types.ts";

import { LEARNED_PAGE, LEARNED_SLUG } from "../runtime/templates.ts";

export { LEARNED_PAGE, LEARNED_SLUG };

/**
 * A learned answer is only served for nearly the same question: paraphrases score 0.86 and up, while
 * different questions about one service ("wedding hair" and "prom hair") reach 0.82. Scores are shifted so
 * this lands on the business's threshold, and a little below it can still be offered as "Do you mean …?".
 */
export const LEARNED_MATCH = 0.85;
const LEARNED_NEAR = 0.08;

/** Reasons a handover's answer is about the person, not the question, so it never goes out on its own. */
const PERSONAL_REASONS: HandoverReason[] = ["emergency", "pain_or_symptoms", "clinical_advice", "complaint", "patient_record"];
const ABOUT_THIS_VISITOR =
  /\b(?:today|tomorrow|tonight|this (?:morning|afternoon|evening|week)|your (?:booking|appointment|order|account|invoice|bill|results|records|x-?rays?)|i'?ve (?:booked|moved|cancelled|added)|we'?ll (?:call|ring|text|email) you|see you (?:on|at|then|soon|tomorrow))\b/i;
const TOKEN = /‹[A-Z_]+_\d+›/;

/** Why a staff reply shouldn't be published straight away, or null when it can be. */
export function heldReason(opts: { reason: HandoverReason; asked: string; answer: string; pack: Pack }): string | null {
  if (PERSONAL_REASONS.includes(opts.reason) || clinicalPrecheck(opts.asked, opts.pack.precheck).hit || opts.pack.unsafeOutput.test(opts.answer)) {
    return "safety topic";
  }
  if (TOKEN.test(opts.asked) || TOKEN.test(opts.answer)) return "personal details";
  if (ABOUT_THIS_VISITOR.test(opts.answer)) return "about this visitor's own visit";
  if (opts.answer.length < 20 || opts.asked.length < 8) return "too short to stand on its own";
  return null;
}

const QUESTION = /\?|^(?:how|what|when|where|which|who|why|do|does|did|are|is|can|could|will|would|should)\b/i;

/** The visitor's question behind a handover: the last real question before it, not a button or contact detail. */
export function askedBefore(messages: { text: string; kind: string }[], buttons: string[]): string | null {
  const said = messages.filter((m) => m.kind === "text" && !buttons.includes(m.text) && !TOKEN.test(m.text));
  return said.findLast((m) => QUESTION.test(m.text.trim()))?.text ?? said.at(-1)?.text ?? null;
}

export async function learn(opts: {
  id: number;
  reason: HandoverReason;
  asked: string | null;
  answer: string;
  pack: Pack;
}) {
  const db = getDb();
  if (!opts.asked) {
    await db.update(labelledAnswers).set({ heldReason: "no question found" }).where(eq(labelledAnswers.id, opts.id));
    return;
  }
  const held = heldReason({ reason: opts.reason, asked: opts.asked, answer: opts.answer, pack: opts.pack });
  const [vec] = await embed([opts.asked], "query");
  await db
    .update(labelledAnswers)
    .set({ asked: opts.asked, status: held ? "held" : "published", heldReason: held, embedding: vec })
    .where(eq(labelledAnswers.id, opts.id));
}

/** Published team answers to nearly the same question, as sections the reply can cite. */
export async function searchLearned(tenantId: string, vec: number[], threshold: number, limit = 2): Promise<ScoredChunk[]> {
  const { rows } = await getPool().query<{ id: string; asked: string; answer: string; similarity: number }>(
    `SELECT id, asked, answer, 1 - (embedding <=> $1::vector) AS similarity
       FROM labelled_answers
      WHERE tenant_id = $2 AND status = 'published' AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    [`[${vec.join(",")}]`, tenantId, limit],
  );
  return rows
    .filter((r) => Number(r.similarity) >= LEARNED_MATCH - LEARNED_NEAR)
    .map((r) => ({
      chunkId: -Number(r.id),
      page: LEARNED_PAGE,
      slug: LEARNED_SLUG,
      heading: r.asked,
      anchor: `learned-${r.id}`,
      text: r.answer,
      score: Number(r.similarity) - LEARNED_MATCH + threshold,
      keywordScore: 0,
    }));
}

export type LearnedAnswer = {
  id: number;
  conversationId: string;
  asked: string | null;
  answer: string;
  author: string;
  status: LearnedStatus;
  heldReason: string | null;
  createdAt: Date;
};

export async function recentLearned(tenantId: string, limit = 10): Promise<LearnedAnswer[]> {
  return getDb()
    .select({
      id: labelledAnswers.id,
      conversationId: labelledAnswers.conversationId,
      asked: labelledAnswers.asked,
      answer: labelledAnswers.answer,
      author: labelledAnswers.author,
      status: labelledAnswers.status,
      heldReason: labelledAnswers.heldReason,
      createdAt: labelledAnswers.createdAt,
    })
    .from(labelledAnswers)
    .where(eq(labelledAnswers.tenantId, tenantId))
    .orderBy(desc(labelledAnswers.id))
    .limit(limit);
}

/** Undo, publish or restore a learned answer. Answers with personal details can't be published. */
export async function setLearnedStatus(opts: { tenantId: string; id: number; status: LearnedStatus }) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(labelledAnswers)
    .where(and(eq(labelledAnswers.tenantId, opts.tenantId), eq(labelledAnswers.id, opts.id)));
  if (!row) throw new Error("answer not found");
  if (opts.status === "published") {
    if (!row.asked || TOKEN.test(row.asked) || TOKEN.test(row.answer)) throw new Error("this answer has personal details, so it can't be published");
    const embedding = row.embedding ?? (await embed([row.asked], "query"))[0];
    await db.update(labelledAnswers).set({ status: "published", embedding, reviewedAt: new Date() }).where(eq(labelledAnswers.id, row.id));
    return;
  }
  await db.update(labelledAnswers).set({ status: opts.status, reviewedAt: new Date() }).where(eq(labelledAnswers.id, row.id));
}

/** Questions the assistant couldn't answer, grouped when they ask the same thing, most asked first. */
export async function unansweredGroups(tenantId: string, days = 7, limit = 150) {
  const rows = await getDb()
    .select({ id: turns.id, conversationId: turns.conversationId, index: turns.index, input: turns.input })
    .from(turns)
    .where(
      and(
        eq(turns.tenantId, tenantId),
        gte(turns.createdAt, new Date(Date.now() - days * 86_400_000)),
        sql`(${turns.guardrails} @> '[{"rule":"retrieval_threshold"}]' or ${turns.guardrails} @> '[{"rule":"compose_no_answer"}]')`,
      ),
    )
    .orderBy(desc(turns.id))
    .limit(limit);
  // Names, numbers and button presses that fell through to a search aren't questions anyone needs answering.
  const buttons = new Set([...T.ASK_TEAM_OPTIONS, ...T.OFFER_OPTIONS, T.SOMETHING_ELSE, T.BOOK_OPTION]);
  const asked = rows.filter((r) => !r.input.startsWith("[action:") && !buttons.has(r.input) && !TOKEN.test(r.input) && (QUESTION.test(r.input.trim()) || r.input.trim().split(/\s+/).length >= 4));
  if (asked.length === 0) return [];
  const vecs = await embed(
    asked.map((r) => r.input),
    "query",
  );
  const groups: { centre: number[]; turns: typeof asked }[] = [];
  asked.forEach((r, i) => {
    const v = vecs[i]!;
    const near = groups.find((g) => cosine(g.centre, v) >= GROUP_SIMILARITY);
    if (near) near.turns.push(r);
    else groups.push({ centre: v, turns: [r] });
  });
  return groups
    .map((g) => ({ count: g.turns.length, questions: [...new Set(g.turns.map((t) => t.input))].slice(0, 3), first: g.turns[0]! }))
    .sort((a, b) => b.count - a.count);
}

/** Looser than serving a learned answer: this only groups questions for someone to read. */
const GROUP_SIMILARITY = 0.8;

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! ** 2;
    nb += b[i]! ** 2;
  }
  return dot / Math.sqrt(na * nb);
}
