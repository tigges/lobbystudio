import Link from "next/link";
import { listConversations, OUTCOMES } from "@dental-bot/core";
import { label, OUTCOME_STYLE, when } from "@/lib/format";
import { SITE_TENANT } from "@/lib/site";

export const metadata = { title: "Conversations" };

export default async function ConversationsPage() {
  const rows = await listConversations(SITE_TENANT, 200);
  const counts = new Map<string, number>();
  for (const r of rows) if (r.outcome) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
  const pending = rows.filter((r) => !r.outcome).length;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold text-slate-900">Conversations</h1>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {OUTCOMES.map((o) => (
          <div key={o} className={`rounded-xl px-3 py-2.5 ring-1 ${OUTCOME_STYLE[o]}`}>
            <p className="text-2xl font-semibold">{counts.get(o) ?? 0}</p>
            <p className="text-xs">{label(o)}</p>
          </div>
        ))}
        <div className="rounded-xl bg-white px-3 py-2.5 text-slate-600 ring-1 ring-slate-200">
          <p className="text-2xl font-semibold">{pending}</p>
          <p className="text-xs">no outcome yet</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">First message</th>
              <th className="px-4 py-2">Outcome</th>
              <th className="px-4 py-2">Basis</th>
              <th className="px-4 py-2">Topic</th>
              <th className="px-4 py-2 text-right">Turns</th>
              <th className="px-4 py-2">Version</th>
              <th className="px-4 py-2">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="max-w-xs truncate px-4 py-2.5">
                  <Link href={`/console/conversations/${r.id}`} className="text-slate-900 hover:underline">
                    {r.firstMessage ?? <span className="text-slate-400">(no message)</span>}
                  </Link>
                  {r.isDemo && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs text-slate-500">demo</span>}
                </td>
                <td className="px-4 py-2.5">
                  {r.outcome ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${OUTCOME_STYLE[r.outcome]}`}>{label(r.outcome)}</span>
                  ) : (
                    <span className="text-xs text-slate-400">{label(r.status)}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{r.outcomeBasis ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs text-slate-600">{r.topic ?? "—"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.turns}</td>
                <td className="px-4 py-2.5 text-xs">v{r.versionNumber}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{when(r.lastActivityAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
