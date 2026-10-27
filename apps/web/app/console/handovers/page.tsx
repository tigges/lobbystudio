import Link from "next/link";
import { businessById, listBookingRequests, listHandovers, packFor } from "@dental-bot/core";
import { label, REASON_STYLE, when } from "@/lib/format";
import { currentTenant } from "@/lib/business";
import { bookingStatusAction } from "../actions";
import { AutoRefresh } from "../ui";

export const metadata = { title: "Inbox" };

type Row = { status: string; conversationStatus: string; lastRole: string | null };
type State = "visitor_replied" | "needs_reply" | "waiting" | "handed_back" | "closed";

const STATE: Record<State, { title: string; style: string; order: number }> = {
  visitor_replied: { title: "visitor replied", style: "font-medium text-amber-700", order: 0 },
  needs_reply: { title: "needs a reply", style: "font-medium text-amber-700", order: 1 },
  waiting: { title: "waiting on visitor", style: "text-slate-600", order: 2 },
  handed_back: { title: "handed back", style: "text-slate-500", order: 3 },
  closed: { title: "closed", style: "text-slate-400", order: 4 },
};

const VIEWS = [
  { key: "todo", title: "Needs a reply", has: ["visitor_replied", "needs_reply"] },
  { key: "waiting", title: "Waiting on visitor", has: ["waiting"] },
  { key: "done", title: "Done", has: ["handed_back", "closed"] },
  { key: "all", title: "All", has: Object.keys(STATE) },
] as const;

function stateOf(h: Row): State {
  if (h.conversationStatus === "closed") return "closed";
  if (h.status === "released") return "handed_back";
  if (h.status === "open") return "needs_reply";
  if (h.conversationStatus === "handed_over" && h.lastRole === "visitor") return "visitor_replied";
  return "waiting";
}

type Params = { view?: string; tests?: string };

function href(params: Params, change: Partial<Params>) {
  const next = { ...params, ...change };
  const q = new URLSearchParams(Object.entries(next).filter((e): e is [string, string] => Boolean(e[1])));
  const s = q.toString();
  return `/console/handovers${s ? `?${s}` : ""}`;
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const tenant = await currentTenant();
  const business = businessById(tenant);
  const columns = packFor(business?.vertical).booking.columns;
  const online = business?.booking.mode === "online";
  const [everyHandover, everyBooking] = await Promise.all([listHandovers(tenant), listBookingRequests(tenant)]);
  const testCount = new Set([...everyHandover, ...everyBooking].filter((r) => r.isTest).map((r) => r.conversationId)).size;
  const handovers = params.tests ? everyHandover : everyHandover.filter((h) => !h.isTest);
  const bookings = (params.tests ? everyBooking : everyBooking.filter((b) => !b.isTest)).sort(
    (a, b) => Number(a.status !== "new" || a.channel !== "callback") - Number(b.status !== "new" || b.channel !== "callback"),
  );
  const view = VIEWS.find((v) => v.key === params.view) ?? VIEWS[0];
  const counts = new Map(VIEWS.map((v) => [v.key, handovers.filter((h) => (v.has as readonly string[]).includes(stateOf(h))).length]));
  const rows = handovers
    .filter((h) => (view.has as readonly string[]).includes(stateOf(h)))
    .sort((a, b) => STATE[stateOf(a)].order - STATE[stateOf(b)].order);
  const toCall = bookings.filter((b) => b.status === "new" && b.channel === "callback").length;

  return (
    <div className="space-y-10">
      <AutoRefresh />
      <section>
        <div className="mb-4 flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">Inbox</h1>
          <span className="text-sm text-slate-500">
            {counts.get("todo")} chat{counts.get("todo") === 1 ? "" : "s"} to reply to · {toCall} booking request{toCall === 1 ? "" : "s"} to call back
          </span>
          {testCount > 0 && (
            <Link href={href(params, { tests: params.tests ? undefined : "1" })} className="ml-auto text-xs text-slate-500 hover:text-slate-800">
              {params.tests ? `Hide ${testCount} test chat${testCount === 1 ? "" : "s"}` : `${testCount} test chat${testCount === 1 ? "" : "s"} hidden · show`}
            </Link>
          )}
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          {VIEWS.map((v) => {
            const on = v.key === view.key;
            return (
              <Link
                key={v.key}
                href={href(params, { view: v.key === "todo" ? undefined : v.key })}
                aria-pressed={on}
                className={`rounded-lg px-3 py-1.5 text-sm ring-1 ${on ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}
              >
                <span className="mr-1.5 font-semibold tabular-nums">{counts.get(v.key)}</span>
                {v.title}
              </Link>
            );
          })}
        </div>
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
          {rows.length === 0 && (
            <p className="p-6 text-sm text-slate-500">{view.key === "todo" ? "Nothing waiting for a reply. Nice work." : "Nothing here."}</p>
          )}
          {rows.map((h) => {
            const state = STATE[stateOf(h)];
            return (
              <Link
                key={h.id}
                href={`/console/handovers/${h.conversationId}`}
                className="flex items-center gap-4 border-b border-slate-100 px-4 py-3 last:border-0 hover:bg-slate-50"
              >
                <span className={`w-36 shrink-0 rounded-full px-2.5 py-0.5 text-center text-xs font-medium ${REASON_STYLE[h.reason] ?? "bg-slate-100 text-slate-700"}`}>
                  {label(h.reason)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-800">
                    {h.firstMessage ?? "—"}
                    {h.isTest && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs text-slate-500">test</span>}
                  </span>
                  {h.lastMessage && h.lastMessage !== h.firstMessage && (
                    <span className="block truncate text-xs text-slate-500">Latest: {h.lastMessage}</span>
                  )}
                </span>
                <span className="w-48 shrink-0 truncate text-xs text-slate-600">
                  {h.contact.name || h.contact.phone ? [h.contact.name, h.contact.phone].filter(Boolean).join(" · ") : <span className="text-slate-400">no contact yet</span>}
                </span>
                <span className={`w-32 text-xs ${state.style}`}>{state.title}</span>
                <span className="w-28 text-right text-xs text-slate-500">{when(h.createdAt)}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold text-slate-900">{online ? "Bookings" : "Booking requests"}</h2>
        <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Phone</th>
                {columns.map((col) => (
                  <th key={col.title} className="px-4 py-2">
                    {col.title}
                  </th>
                ))}
                <th className="px-4 py-2">{online ? "Outcome" : "Call back"}</th>
                <th className="px-4 py-2">Received</th>
              </tr>
            </thead>
            <tbody>
              {bookings.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 4} className="px-4 py-6 text-slate-500">
                    No booking requests yet.
                  </td>
                </tr>
              )}
              {bookings.map((b) => {
                const called = b.status === "contacted";
                return (
                  <tr key={b.id} className={`border-t border-slate-100 ${called ? "text-slate-400" : ""}`}>
                    <td className={`px-4 py-2.5 font-medium ${called ? "" : "text-slate-900"}`}>
                      <Link href={`/console/conversations/${b.conversationId}`} className="hover:underline">
                        {b.slots.name ?? "—"}
                      </Link>
                      {b.isTest && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs font-normal text-slate-500">test</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {b.slots.phone ? (
                        <a href={`tel:${b.slots.phone.replace(/\s/g, "")}`} className={called ? "" : "text-harbour-700 hover:underline"}>
                          {b.slots.phone}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    {columns.map((col) => (
                      <td key={col.title} className="px-4 py-2.5">
                        {col.value(b.slots) ?? "—"}
                      </td>
                    ))}
                    <td className="px-4 py-2.5">
                      {b.channel === "online" ? (
                        <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100" title={b.system ?? ""}>
                          Booked · {b.externalRef}
                        </span>
                      ) : (
                        <form action={bookingStatusAction}>
                          <input type="hidden" name="id" value={b.id} />
                          <input type="hidden" name="status" value={called ? "new" : "contacted"} />
                          <button
                            className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${
                              called ? "bg-white text-slate-500 ring-slate-200 hover:text-slate-800" : "bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100"
                            }`}
                            title={called ? "Mark as still to call" : "Mark as called back"}
                          >
                            {called ? "Called ✓ · undo" : "Mark called"}
                          </button>
                        </form>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{when(b.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
