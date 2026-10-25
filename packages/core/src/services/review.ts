import { and, eq, sql, type SQL } from "drizzle-orm";
import { getDb, messages, turnLabels, turns } from "@dental-bot/db";
import { isTurnLabel } from "../labels.ts";

export type ReviewFilter = { version?: number | null; sinceDays?: number | null };

/** A group of turns on the Insights page, written as "kind:value", e.g. "reply:fallback" or "check:retrieval_threshold". */
export type GroupKey = string;

export async function setTurnLabel(opts: { tenantId: string; turnId: number; label: string; note?: string | null }) {
  if (!isTurnLabel(opts.label)) throw new Error(`unknown label ${opts.label}`);
  const db = getDb();
  const [turn] = await db
    .select({ conversationId: turns.conversationId })
    .from(turns)
    .where(and(eq(turns.tenantId, opts.tenantId), eq(turns.id, opts.turnId)));
  if (!turn) throw new Error("turn not found");
  const note = opts.note?.trim() || null;
  await db
    .insert(turnLabels)
    .values({ tenantId: opts.tenantId, conversationId: turn.conversationId, turnId: opts.turnId, label: opts.label, note })
    .onConflictDoUpdate({ target: turnLabels.turnId, set: { label: opts.label, note, updatedAt: new Date() } });
}

export async function clearTurnLabel(opts: { tenantId: string; turnId: number }) {
  await getDb()
    .delete(turnLabels)
    .where(and(eq(turnLabels.tenantId, opts.tenantId), eq(turnLabels.turnId, opts.turnId)));
}

export async function labelsForConversation(tenantId: string, conversationId: string) {
  const rows = await getDb()
    .select()
    .from(turnLabels)
    .where(and(eq(turnLabels.tenantId, tenantId), eq(turnLabels.conversationId, conversationId)));
  return new Map(rows.map((r) => [r.turnId, r]));
}

function scope(tenantId: string, f: ReviewFilter): SQL {
  const parts = [sql`t.tenant_id = ${tenantId}`];
  if (f.version) parts.push(sql`t.version_number = ${f.version}`);
  if (f.sinceDays) parts.push(sql`t.created_at >= now() - make_interval(days => ${f.sinceDays})`);
  return sql.join(parts, sql` and `);
}

async function rows<T>(query: SQL): Promise<T[]> {
  const res = await getDb().execute(query);
  return res.rows as T[];
}

export type Insights = {
  totals: { turns: number; conversations: number; modelTurns: number; avgCostUsd: number; avgLatencyMs: number; p90LatencyMs: number; slowTurns: number };
  replies: { kind: string; turns: number }[];
  checks: { rule: string; result: string; turns: number }[];
  handovers: { reason: string; turns: number }[];
  labels: { label: string; turns: number }[];
  outcomes: { outcome: string | null; conversations: number }[];
  versions: number[];
};

/** Slower than this counts as a slow turn. */
export const SLOW_TURN_MS = 5000;

export async function insights(tenantId: string, f: ReviewFilter = {}): Promise<Insights> {
  const where = scope(tenantId, f);
  const [totals] = await rows<Insights["totals"]>(sql`
    select count(*)::int as "turns",
      count(distinct t.conversation_id)::int as "conversations",
      count(*) filter (where jsonb_array_length(t.model_calls) > 0)::int as "modelTurns",
      coalesce(avg(t.cost_usd), 0)::float as "avgCostUsd",
      coalesce(avg(t.latency_ms), 0)::float as "avgLatencyMs",
      coalesce(percentile_cont(0.9) within group (order by t.latency_ms), 0)::float as "p90LatencyMs",
      count(*) filter (where t.latency_ms > ${SLOW_TURN_MS})::int as "slowTurns"
    from ${turns} t where ${where}`);
  const replies = await rows<Insights["replies"][number]>(sql`
    select m.kind, count(distinct t.id)::int as "turns"
    from ${turns} t join ${messages} m on m.turn_id = t.id and m.role = 'bot'
    where ${where} group by m.kind order by 2 desc`);
  const checks = await rows<Insights["checks"][number]>(sql`
    select g->>'rule' as "rule", g->>'result' as "result", count(distinct t.id)::int as "turns"
    from ${turns} t, jsonb_array_elements(t.guardrails) g
    where ${where} and g->>'result' <> 'pass' group by 1, 2 order by 3 desc`);
  const handovers = await rows<Insights["handovers"][number]>(sql`
    select c->>'reason' as "reason", count(distinct t.id)::int as "turns"
    from ${turns} t, jsonb_array_elements(t.commands) c
    where ${where} and c->>'cmd' = 'handover' group by 1 order by 2 desc`);
  const labels = await rows<Insights["labels"][number]>(sql`
    select l.label, count(*)::int as "turns"
    from ${turns} t join ${turnLabels} l on l.turn_id = t.id
    where ${where} group by 1 order by 2 desc`);
  const outcomes = await rows<Insights["outcomes"][number]>(sql`
    select c.outcome, count(*)::int as "conversations"
    from conversations c
    where c.id in (select t.conversation_id from ${turns} t where ${where})
    group by 1 order by 2 desc`);
  const versions = (
    await rows<{ v: number }>(sql`select distinct t.version_number as v from ${turns} t where t.tenant_id = ${tenantId} order by 1 desc`)
  ).map((r) => r.v);
  return { totals: totals!, replies, checks, handovers, labels, outcomes, versions };
}

function groupWhere(group: GroupKey): SQL | null {
  const i = group.indexOf(":");
  const kind = i < 0 ? group : group.slice(0, i);
  const value = i < 0 ? "" : group.slice(i + 1);
  switch (kind) {
    case "reply":
      return sql`exists (select 1 from ${messages} m where m.turn_id = t.id and m.role = 'bot' and m.kind = ${value})`;
    case "check":
      return sql`exists (select 1 from jsonb_array_elements(t.guardrails) g where g->>'rule' = ${value} and g->>'result' <> 'pass')`;
    case "handover":
      return sql`exists (select 1 from jsonb_array_elements(t.commands) c where c->>'cmd' = 'handover' and c->>'reason' = ${value})`;
    case "label":
      return value === "none"
        ? sql`not exists (select 1 from ${turnLabels} l where l.turn_id = t.id)`
        : sql`exists (select 1 from ${turnLabels} l where l.turn_id = t.id and l.label = ${value})`;
    case "decided":
      return value === "model" ? sql`jsonb_array_length(t.model_calls) > 0` : sql`jsonb_array_length(t.model_calls) = 0`;
    case "slow":
      return sql`t.latency_ms > ${SLOW_TURN_MS}`;
    case "all":
      return sql`true`;
    default:
      return null;
  }
}

export type GroupTurn = {
  id: number;
  conversationId: string;
  index: number;
  input: string;
  reply: string | null;
  kinds: string[];
  createdAt: Date;
  versionNumber: number;
  build: string | null;
  latencyMs: number;
  costUsd: number;
  label: string | null;
  note: string | null;
};

/** The turns in one Insights group, newest first. Text is shown with personal data as tokens, as the model saw it. */
export async function groupTurns(tenantId: string, group: GroupKey, f: ReviewFilter = {}, limit = 100): Promise<GroupTurn[]> {
  const predicate = groupWhere(group);
  if (!predicate) return [];
  return rows<GroupTurn>(sql`
    select t.id::int as "id", t.conversation_id as "conversationId", t.index, t.input,
      (select string_agg(m.text, ' ' order by m.id) from ${messages} m where m.turn_id = t.id and m.role = 'bot') as "reply",
      coalesce((select array_agg(distinct m.kind) from ${messages} m where m.turn_id = t.id and m.role = 'bot'), '{}') as "kinds",
      t.created_at as "createdAt", t.version_number as "versionNumber", t.build, t.latency_ms as "latencyMs",
      t.cost_usd::float as "costUsd", l.label, l.note
    from ${turns} t left join ${turnLabels} l on l.turn_id = t.id
    where ${scope(tenantId, f)} and ${predicate}
    order by t.created_at desc
    limit ${limit}`);
}
