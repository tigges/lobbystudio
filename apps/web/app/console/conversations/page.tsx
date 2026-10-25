import Link from "next/link";
import { labelTitle, listConversations, OUTCOMES } from "@dental-bot/core";
import { label, OUTCOME_STYLE, when } from "@/lib/format";
import { SITE_TENANT } from "@/lib/site";
import { LabelChip } from "../labels";
import { AdminNote } from "../ui";

export const metadata = { title: "Conversations" };

type Row = Awaited<ReturnType<typeof listConversations>>[number];
type Params = { outcome?: string; had?: string; label?: string; version?: string };

const HAD: { key: string; title: string; test: (r: Row) => boolean }[] = [
  { key: "handover", title: "handover", test: (r) => r.handedOver },
  { key: "booking", title: "booking request", test: (r) => r.hadBooking },
  { key: "offer", title: "booking offer", test: (r) => r.hadOffer },
  { key: "fallback", title: "didn't know", test: (r) => r.fallbackCount > 0 },
  { key: "check", title: "safety check dropped text", test: (r) => r.hadCheck },
];

const LABELLED: { key: string; title: string; test: (r: Row) => boolean }[] = [
  { key: "labelled", title: "labelled", test: (r) => r.labels.length > 0 },
  { key: "unlabelled", title: "unlabelled", test: (r) => r.labels.length === 0 },
  { key: "issues", title: "has issue labels", test: (r) => r.labels.some((l) => l !== "good") },
];

function href(params: Params, change: Partial<Params>) {
  const next = { ...params, ...change };
  const q = new URLSearchParams(Object.entries(next).filter((e): e is [string, string] => Boolean(e[1])));
  const s = q.toString();
  return `/console/conversations${s ? `?${s}` : ""}`;
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

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const all = await listConversations(SITE_TENANT, 300);
  const versions = [...new Set(all.map((r) => r.versionNumber))].sort((a, b) => b - a);

  const had = HAD.find((h) => h.key === params.had);
  const labelled = LABELLED.find((l) => l.key === params.label);
  // Counters reflect every filter except the outcome itself, so they show what clicking one would give.
  const scoped = all.filter(
    (r) => (!params.version || String(r.versionNumber) === params.version) && (!had || had.test(r)) && (!labelled || labelled.test(r)),
  );
  const rows = scoped.filter((r) => !params.outcome || (params.outcome === "none" ? !r.outcome : r.outcome === params.outcome));
  const counts = new Map<string, number>();
  for (const r of scoped) counts.set(r.outcome ?? "none", (counts.get(r.outcome ?? "none") ?? 0) + 1);
  const filtered = Boolean(params.outcome || params.had || params.label || params.version);

  return (
    <div>
      <AdminNote />
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Conversations</h1>
        <span className="text-sm text-slate-500">
          {rows.length} of {all.length}
        </span>
        {filtered && (
          <Link href="/console/conversations" className="text-sm text-harbour-700 hover:underline">
            Clear filters
          </Link>
        )}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {[...OUTCOMES, "none"].map((o) => {
          const on = params.outcome === o;
          return (
            <Link
              key={o}
              href={href(params, { outcome: on ? undefined : o })}
              aria-pressed={on}
              className={`rounded-xl px-3 py-2.5 ring-1 transition ${o === "none" ? "bg-white text-slate-600 ring-slate-200" : OUTCOME_STYLE[o]} ${
                on ? "ring-2 ring-slate-800" : params.outcome ? "opacity-50 hover:opacity-100" : "hover:shadow-sm"
              }`}
            >
              <p className="text-2xl font-semibold">{counts.get(o) ?? 0}</p>
              <p className="text-xs">{o === "none" ? "no outcome yet" : label(o)}</p>
            </Link>
          );
        })}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">Had</span>
        {HAD.map((h) => (
          <Chip key={h.key} on={params.had === h.key} to={href(params, { had: params.had === h.key ? undefined : h.key })}>
            {h.title}
          </Chip>
        ))}
        <span className="ml-3 text-xs text-slate-500">Review</span>
        {LABELLED.map((l) => (
          <Chip key={l.key} on={params.label === l.key} to={href(params, { label: params.label === l.key ? undefined : l.key })}>
            {l.title}
          </Chip>
        ))}
        {versions.length > 1 && (
          <>
            <span className="ml-3 text-xs text-slate-500">Assistant</span>
            {versions.map((v) => (
              <Chip key={v} on={params.version === String(v)} to={href(params, { version: params.version === String(v) ? undefined : String(v) })}>
                v{v}
              </Chip>
            ))}
          </>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">First message</th>
              <th className="px-4 py-2">Outcome</th>
              <th className="px-4 py-2">Basis</th>
              <th className="px-4 py-2">Topic</th>
              <th className="px-4 py-2">Labels</th>
              <th className="px-4 py-2 text-right">Turns</th>
              <th className="px-4 py-2">Version</th>
              <th className="px-4 py-2">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-slate-500">
                  No conversations match these filters.
                </td>
              </tr>
            )}
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
                <td className="max-w-[12rem] truncate px-4 py-2.5 text-xs text-slate-600">{r.topic ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1" title={r.labels.map(labelTitle).join(", ")}>
                    {[...new Set(r.labels)].slice(0, 2).map((l) => (
                      <LabelChip key={l} label={l} />
                    ))}
                    {new Set(r.labels).size > 2 && <span className="text-xs text-slate-400">+{new Set(r.labels).size - 2}</span>}
                    {r.labels.length === 0 && <span className="text-xs text-slate-300">—</span>}
                  </div>
                </td>
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
