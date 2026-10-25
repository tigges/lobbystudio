import Link from "next/link";
import { notFound } from "next/navigation";
import { conversationDetail } from "@dental-bot/core";
import { label, OUTCOME_STYLE, when } from "@/lib/format";
import { SITE_TENANT } from "@/lib/site";
import { Transcript } from "../../transcript";

export const metadata = { title: "Conversation" };

const UUID_RE = /^[0-9a-f-]{36}$/i;

const USED_STYLE = {
  cited: "text-emerald-700",
  context: "text-slate-600",
  below_threshold: "text-slate-400",
} as const;

const GUARD_STYLE = {
  pass: "bg-slate-100 text-slate-600",
  hit: "bg-amber-100 text-amber-900",
  blocked: "bg-rose-100 text-rose-800",
  dropped: "bg-orange-100 text-orange-900",
} as const;

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const detail = await conversationDetail(SITE_TENANT, id);
  if (!detail) notFound();
  const { conversation: c, messages, turns, bookings, versionNumber } = detail;
  const totalCost = turns.reduce((s, t) => s + Number(t.costUsd), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/console/conversations" className="text-sm text-slate-500 hover:text-slate-800">
          ← Conversations
        </Link>
        {c.outcome ? (
          <span className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${OUTCOME_STYLE[c.outcome]}`}>
            {label(c.outcome)} · {c.outcomeBasis}
          </span>
        ) : (
          <span className="rounded-full bg-white px-2.5 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200">no outcome yet</span>
        )}
        <span className="text-sm text-slate-500">
          v{versionNumber} · {label(c.status)} · topic {c.topic ?? "—"} · rating {c.rating ?? "—"} · {turns.length} turns · $
          {totalCost.toFixed(4)}
        </span>
        {c.status === "handed_over" && (
          <Link href={`/console/handovers/${c.id}`} className="text-sm text-harbour-700 hover:underline">
            Reply →
          </Link>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <section className="space-y-4">
          <div className="rounded-2xl bg-slate-100/70 p-4">
            <Transcript messages={messages} />
          </div>
          {bookings.map((b) => (
            <div key={b.id} className="rounded-xl bg-white p-3 text-sm ring-1 ring-slate-200">
              <p className="mb-1 font-medium">Booking request</p>
              {Object.entries(b.slots).map(([k, v]) => (
                <p key={k} className="text-slate-600">
                  {label(k)}: {v}
                </p>
              ))}
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-slate-900">Turn ledger</h2>
          <p className="text-xs text-slate-500">Inputs are stored with personal data replaced by tokens, exactly as the model saw them.</p>
          {turns.map((t) => (
            <details key={t.id} className="rounded-xl bg-white ring-1 ring-slate-200" open={turns.length <= 4}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                <span className="font-medium text-slate-900">#{t.index}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700">{t.input}</span>
                <span className="text-xs text-slate-500">
                  {t.llmMode} · {t.latencyMs} ms{t.firstTokenMs !== null ? ` (first ${t.firstTokenMs} ms)` : ""} · {t.inputTokens}/{t.outputTokens} tok · $
                  {Number(t.costUsd).toFixed(4)}
                </span>
                <span className="text-xs text-slate-400">{when(t.createdAt)}</span>
              </summary>
              <div className="grid gap-4 border-t border-slate-100 px-4 py-3 text-xs md:grid-cols-2">
                <div>
                  <p className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Commands</p>
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 font-mono">{JSON.stringify(t.commands, null, 1)}</pre>
                  {t.rejectedCommands.length > 0 && (
                    <>
                      <p className="mb-1 mt-2 font-semibold uppercase tracking-wide text-rose-600">Rejected</p>
                      <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-rose-50 p-2 font-mono">{JSON.stringify(t.rejectedCommands, null, 1)}</pre>
                    </>
                  )}
                  <p className="mb-1 mt-2 font-semibold uppercase tracking-wide text-slate-500">Flow</p>
                  <p className="font-mono text-slate-600">
                    {t.flowBefore ? `${t.flowBefore.name}/${t.flowBefore.step}` : "none"} → {t.flowAfter ? `${t.flowAfter.name}/${t.flowAfter.step}` : "none"}
                  </p>
                  {t.error && <p className="mt-2 rounded bg-rose-50 p-2 text-rose-800">{t.error}</p>}
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Retrieved</p>
                    {t.retrieved.length === 0 && <p className="text-slate-400">none</p>}
                    {t.retrieved.map((r) => (
                      <p key={r.chunkId} className={USED_STYLE[r.used]}>
                        <span className="tabular-nums">{r.score.toFixed(3)}</span> · {r.page} › {r.heading} <span className="text-slate-400">({label(r.used)})</span>
                      </p>
                    ))}
                  </div>
                  <div>
                    <p className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Guardrails</p>
                    <div className="flex flex-wrap gap-1">
                      {t.guardrails.length === 0 && <span className="text-slate-400">none</span>}
                      {t.guardrails.map((g, i) => (
                        <span key={i} title={g.detail} className={`rounded px-1.5 py-0.5 ${GUARD_STYLE[g.result]}`}>
                          {g.rule}: {g.result}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Model calls</p>
                    {t.modelCalls.length === 0 && <p className="text-slate-400">none</p>}
                    {t.modelCalls.map((m, i) => (
                      <p key={i} className="text-slate-600">
                        {m.role} · {m.model} · {m.inputTokens}/{m.outputTokens} tok · {m.latencyMs} ms
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </details>
          ))}
        </section>
      </div>
    </div>
  );
}
