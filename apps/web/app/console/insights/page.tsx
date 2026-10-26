import Link from "next/link";
import { groupTurns, insights, labelTitle, recentEvalRuns, SLOW_TURN_MS, TURN_LABELS, type EvalRunSummary } from "@dental-bot/core";
import { label, OUTCOME_STYLE, when } from "@/lib/format";
import { currentTenant } from "@/lib/business";
import { ActionedForm, LabelChip, LabelForm } from "../labels";
import { AdminNote } from "../ui";

export const metadata = { title: "Insights" };

type Params = { days?: string; version?: string; group?: string };

const PERIODS = [
  { key: "7", title: "7 days" },
  { key: "30", title: "30 days" },
  { key: "all", title: "All time" },
];

const REPLY_NAMES: Record<string, string> = {
  answer: "Answered from the content",
  fallback: "Said it didn't know",
  clarify: "Asked which one was meant",
  flow: "Booking or contact step",
  handover: "Handed over to the team",
  suggest: "Offered a booking",
  acknowledge: "Thanks, greeting or waiting note",
  cannot_handle: "Out of scope or refused",
  error: "Technical problem",
};

const CHECK_NAMES: Record<string, string> = {
  retrieval_threshold: "No good match in the content",
  compose_no_answer: "Content didn't answer the question",
  grounding: "Sentences dropped by source checks",
  uncited_sentence: "Sentence without a source removed",
  ungrounded_number: "Number not in the source removed",
  price_qualifier: "Price that lost its “from” removed",
  clinical_output: "Clinical advice removed",
  clinical_precheck: "Clinical words: handed straight over",
  topic_menu: "Offered topics to choose from",
  no_double_clarify: "Avoided asking “which one” twice",
  clarify_options: "Unsafe choice options removed",
  slot_validation: "Booking answer not accepted",
  slot_fallback: "Booking answer taken from free text",
  booking_offer: "Booking offer made",
  handover_contact: "Contact details collected",
  abuse: "Abusive message",
};

function groupTitle(group: string) {
  const [kind, value = ""] = group.split(/:(.*)/s);
  if (kind === "reply") return REPLY_NAMES[value] ?? value;
  if (kind === "check") return CHECK_NAMES[value] ?? value;
  if (kind === "handover") return `Handed over: ${label(value)}`;
  if (kind === "label") return value === "none" ? "Not labelled yet" : `Labelled: ${labelTitle(value)}`;
  if (kind === "decided") return value === "model" ? "Decided by the AI model" : "Decided by fixed rules (no model call)";
  if (kind === "slow") return `Slower than ${SLOW_TURN_MS / 1000} s`;
  if (kind === "all") return "All turns";
  return group;
}

function href(params: Params, change: Partial<Params>) {
  const next = { ...params, ...change };
  const q = new URLSearchParams(Object.entries(next).filter((e): e is [string, string] => Boolean(e[1])));
  return `/console/insights?${q.toString()}#turns`;
}

function Chip({ on, to, children }: { on: boolean; to: string; children: React.ReactNode }) {
  return (
    <Link
      href={to}
      className={`rounded-full px-2.5 py-1 text-xs ring-1 ${on ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}
    >
      {children}
    </Link>
  );
}

function Panel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <p className="mb-3 text-xs text-slate-500">{hint}</p>
      <ul className="space-y-0.5">{children}</ul>
    </section>
  );
}

function Row({ to, on, name, sub, count, total }: { to: string; on: boolean; name: React.ReactNode; sub?: string; count: number; total: number }) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <li>
      <Link href={to} className={`group flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm ${on ? "bg-violet-50 ring-1 ring-violet-200" : "hover:bg-slate-50"}`}>
        <span className="min-w-0 flex-1">
          <span className="text-slate-800">{name}</span>
          {sub && <span className="ml-2 font-mono text-[10px] text-slate-400">{sub}</span>}
        </span>
        <span className="hidden w-24 sm:block">
          <span className="block h-1.5 rounded-full bg-slate-100">
            <span className="block h-1.5 rounded-full bg-violet-400" style={{ width: `${Math.max(pct, count ? 3 : 0)}%` }} />
          </span>
        </span>
        <span className="w-10 text-right tabular-nums text-slate-900">{count}</span>
      </Link>
    </li>
  );
}

const SCORE_NAMES = [
  ["correct", "Correct"],
  ["grounded", "From your content"],
  ["answers", "Answers the question"],
  ["nextStep", "Clear next step"],
] as const;

function ChatQuality({ runs }: { runs: EvalRunSummary[] }) {
  const [latest, ...earlier] = runs;
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <h2 className="font-semibold text-slate-900">Chat quality</h2>
      <p className="mb-3 text-xs text-slate-500">
        Saved test conversations replayed against the assistant (<code>pnpm eval</code>). Scores out of 5 are from a model reading each reply.
      </p>
      {!latest ? (
        <p className="text-sm text-slate-400">No test runs yet.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-2xl font-semibold text-slate-900">
              {latest.passed}/{latest.cases}
            </span>
            <span className="text-slate-500">
              passed · {latest.llmMode} · {latest.build ? `build ${latest.build}` : "local build"} · {when(latest.createdAt)}
            </span>
          </div>
          {latest.scores && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SCORE_NAMES.map(([key, name]) => (
                <div key={key} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                  <p className="text-lg font-semibold tabular-nums text-slate-900">{latest.scores![key].toFixed(1)}</p>
                  <p className="text-xs text-slate-500">{name}</p>
                </div>
              ))}
            </div>
          )}
          {latest.failed.length > 0 && (
            <p className="text-xs text-slate-600">
              <span className="text-slate-400">Failed: </span>
              {latest.failed.join(" · ")}
            </p>
          )}
          {earlier.length > 0 && (
            <ul className="space-y-0.5 border-t border-slate-100 pt-2 text-xs text-slate-500">
              {earlier.map((r) => (
                <li key={r.id} className="flex gap-3">
                  <span className="w-12 tabular-nums text-slate-800">
                    {r.passed}/{r.cases}
                  </span>
                  <span>
                    {r.llmMode} · {r.build ? `build ${r.build}` : "local build"} · {when(r.createdAt)}
                    {r.scores ? ` · correct ${r.scores.correct.toFixed(1)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export default async function InsightsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const days = params.days ?? "30";
  const filter = { sinceDays: days === "all" ? null : Number(days), version: params.version ? Number(params.version) : null };
  const tenant = await currentTenant();
  const [data, evalRuns] = await Promise.all([insights(tenant, filter), recentEvalRuns(tenant)]);
  const selected = params.group ?? null;
  const list = selected ? await groupTurns(tenant, selected, filter) : [];
  const { totals } = data;
  const t = totals.turns;
  const labelled = data.labels.reduce((s, l) => s + l.turns, 0);
  const g = (group: string) => href(params, { group: selected === group ? undefined : group });
  const openInList = list.filter((x) => x.label && x.label !== "good" && !x.actionedAt);
  const listPath = `/console/insights?${new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))).toString()}`;

  return (
    <div className="space-y-6">
      <AdminNote />
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Insights</h1>
        <span className="text-sm text-slate-500">Turns grouped by what happened. Click a row to see and label those turns.</span>
        <span className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          Export all labels and notes
          <a href="/console/insights/export?format=csv" className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50">
            Spreadsheet (CSV)
          </a>
          <a href="/console/insights/export" className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50">
            Full context (JSON)
          </a>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">Period</span>
        {PERIODS.map((p) => (
          <Chip key={p.key} on={days === p.key} to={href(params, { days: p.key })}>
            {p.title}
          </Chip>
        ))}
        <span className="ml-3 text-xs text-slate-500">Assistant</span>
        <Chip on={!params.version} to={href(params, { version: undefined })}>
          all versions
        </Chip>
        {data.versions.map((v) => (
          <Chip key={v} on={params.version === String(v)} to={href(params, { version: String(v) })}>
            v{v}
          </Chip>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { value: t, name: "turns", to: g("all") },
          { value: totals.conversations, name: "conversations", to: "/console/conversations" },
          { value: `${t ? Math.round((totals.modelTurns / t) * 100) : 0}%`, name: "used the AI model", to: g("decided:model") },
          { value: `$${totals.avgCostUsd.toFixed(4)}`, name: "average cost per turn", to: g("decided:model") },
          { value: `${(totals.avgLatencyMs / 1000).toFixed(1)} s`, name: `average reply · 90% under ${(totals.p90LatencyMs / 1000).toFixed(1)} s`, to: g("slow") },
          { value: `${labelled}/${t}`, name: "turns labelled", to: g("label:none") },
        ].map((tile) => (
          <Link key={tile.name} href={tile.to} className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200 hover:shadow-sm">
            <p className="text-2xl font-semibold text-slate-900">{tile.value}</p>
            <p className="text-xs text-slate-500">{tile.name}</p>
          </Link>
        ))}
      </div>

      <ChatQuality runs={evalRuns} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="What the assistant did" hint="Each turn counted once per kind of reply it gave.">
          {data.replies.map((r) => (
            <Row key={r.kind} to={g(`reply:${r.kind}`)} on={selected === `reply:${r.kind}`} name={REPLY_NAMES[r.kind] ?? r.kind} count={r.turns} total={t} />
          ))}
          <Row to={g("decided:rules")} on={selected === "decided:rules"} name="Decided by fixed rules (no model call)" count={t - totals.modelTurns} total={t} />
          <Row to={g("slow")} on={selected === "slow"} name={`Slower than ${SLOW_TURN_MS / 1000} s`} count={totals.slowTurns} total={t} />
        </Panel>

        <Panel title="Checks and rules that fired" hint="Safety checks that removed text, and conversation rules that stepped in.">
          {data.checks.length === 0 && <li className="text-sm text-slate-400">Nothing fired in this period.</li>}
          {Object.entries(
            data.checks.reduce<Record<string, { turns: number; results: string[] }>>((acc, c) => {
              const e = (acc[c.rule] ??= { turns: 0, results: [] });
              e.turns += c.turns;
              e.results.push(c.result);
              return acc;
            }, {}),
          ).map(([rule, c]) => (
            <Row key={rule} to={g(`check:${rule}`)} on={selected === `check:${rule}`} name={CHECK_NAMES[rule] ?? rule} sub={`${rule} · ${c.results.join("/")}`} count={c.turns} total={t} />
          ))}
        </Panel>

        <Panel title="Handovers by reason" hint="Turns where the assistant passed the chat to the team.">
          {data.handovers.length === 0 && <li className="text-sm text-slate-400">No handovers in this period.</li>}
          {data.handovers.map((h) => (
            <Row key={h.reason} to={g(`handover:${h.reason}`)} on={selected === `handover:${h.reason}`} name={label(h.reason)} count={h.turns} total={t} />
          ))}
        </Panel>

        <Panel title="Your labels" hint="Labels you gave in the turn ledger or below. Unlabelled turns are the review queue.">
          <Row to={g("label:none")} on={selected === "label:none"} name="Not labelled yet" count={t - labelled} total={t} />
          {TURN_LABELS.map((l) => {
            const row = data.labels.find((x) => x.label === l.key);
            if (!row?.turns) return null;
            const fixed = l.key === "good" ? "" : row.open ? `${row.open} waiting for a fix` : "all fixed";
            return <Row key={l.key} to={g(`label:${l.key}`)} on={selected === `label:${l.key}`} name={<LabelChip label={l.key} />} sub={fixed} count={row.turns} total={t} />;
          })}
        </Panel>

        <Panel title="Outcomes" hint="Conversations with a turn in this period. Opens the filtered conversation list.">
          {data.outcomes.map((o) => (
            <li key={o.outcome ?? "none"}>
              <Link
                href={`/console/conversations?review=all&outcome=${o.outcome ?? "none"}${params.version ? `&version=${params.version}` : ""}`}
                className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"
              >
                <span className="flex-1">
                  {o.outcome ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${OUTCOME_STYLE[o.outcome]}`}>{label(o.outcome)}</span>
                  ) : (
                    <span className="text-slate-500">no outcome yet</span>
                  )}
                </span>
                <span className="w-10 text-right tabular-nums">{o.conversations}</span>
              </Link>
            </li>
          ))}
        </Panel>
      </div>

      <section id="turns" className="scroll-mt-6">
        {selected ? (
          <>
            <div className="mb-3 flex flex-wrap items-baseline gap-3">
              <h2 className="text-xl font-semibold text-slate-900">{groupTitle(selected)}</h2>
              <span className="text-sm text-slate-500">
                {list.length} turn{list.length === 1 ? "" : "s"}
                {list.length === 100 ? " (newest 100)" : ""}
              </span>
              <Link href={href(params, { group: undefined })} className="text-sm text-harbour-700 hover:underline">
                Close
              </Link>
              {openInList.length > 0 && (
                <span className="ml-auto">
                  <ActionedForm turnIds={openInList.map((x) => x.id)} path={listPath} all />
                </span>
              )}
            </div>
            <div className="divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200">
              {list.length === 0 && <p className="p-4 text-sm text-slate-500">No turns in this group.</p>}
              {list.map((turn) => (
                <div key={turn.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[1fr_22rem]">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{when(turn.createdAt)}</span>
                      <span>
                        v{turn.versionNumber}
                        {turn.build ? ` · build ${turn.build}` : ""}
                      </span>
                      <span>
                        {(turn.latencyMs / 1000).toFixed(1)} s · ${turn.costUsd.toFixed(4)}
                      </span>
                      {turn.label && <LabelChip label={turn.label} />}
                      {turn.label && turn.label !== "good" && (
                        <ActionedForm turnIds={[turn.id]} actioned={Boolean(turn.actionedAt)} actionedIn={turn.actionedIn} path={listPath} />
                      )}
                      {turn.kinds.map((k) => (
                        <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5">
                          {REPLY_NAMES[k] ?? k}
                        </span>
                      ))}
                      <Link href={`/console/conversations/${turn.conversationId}?turn=${turn.index}#turn-${turn.index}`} className="ml-auto text-harbour-700 hover:underline">
                        Open in ledger →
                      </Link>
                    </div>
                    <p className="font-mono text-xs text-slate-900">
                      <span className="text-slate-400">Visitor: </span>
                      {turn.input}
                    </p>
                    <p className="line-clamp-3 text-sm text-slate-700">
                      <span className="text-xs text-slate-400">Assistant: </span>
                      {turn.reply ?? <span className="text-slate-400">(no reply)</span>}
                    </p>
                    {turn.note && (
                      <p className="text-xs text-violet-800">
                        <span className="text-violet-400">Your note: </span>
                        {turn.note}
                      </p>
                    )}
                  </div>
                  <LabelForm key={`${turn.label}:${turn.note}`} turnId={turn.id} current={turn.label} note={turn.note} savedAt={turn.labelledAt} path={listPath} compact />
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            Click any row above to list its turns here. You can label each one without opening the conversation.
          </p>
        )}
      </section>
    </div>
  );
}
