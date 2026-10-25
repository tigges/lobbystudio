import Link from "next/link";
import { listBookingRequests, listHandovers } from "@dental-bot/core";
import { label, REASON_STYLE, when } from "@/lib/format";
import { SITE_TENANT } from "@/lib/site";
import { AutoRefresh } from "../ui";

export const metadata = { title: "Handovers" };

const STATUS_ORDER = { open: 0, replied: 1, released: 2 } as const;

export default async function HandoversPage() {
  const [handovers, bookings] = await Promise.all([listHandovers(SITE_TENANT), listBookingRequests(SITE_TENANT)]);
  const sorted = [...handovers].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const open = handovers.filter((h) => h.status === "open").length;

  return (
    <div className="space-y-10">
      <AutoRefresh />
      <section>
        <div className="mb-4 flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">Handovers</h1>
          <span className="text-sm text-slate-500">{open} waiting for a reply</span>
        </div>
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
          {sorted.length === 0 && <p className="p-6 text-sm text-slate-500">No handovers yet.</p>}
          {sorted.map((h) => (
            <Link
              key={h.id}
              href={`/console/handovers/${h.conversationId}`}
              className="flex items-center gap-4 border-b border-slate-100 px-4 py-3 last:border-0 hover:bg-slate-50"
            >
              <span className={`w-36 shrink-0 rounded-full px-2.5 py-0.5 text-center text-xs font-medium ${REASON_STYLE[h.reason] ?? "bg-slate-100 text-slate-700"}`}>
                {label(h.reason)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{h.lastMessage ?? "—"}</span>
              <span className="w-20 text-xs text-slate-500">{h.status}</span>
              <span className="w-28 text-right text-xs text-slate-500">{when(h.createdAt)}</span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold text-slate-900">Booking requests</h2>
        <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Phone</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">Preferred time</th>
                <th className="px-4 py-2">Received</th>
              </tr>
            </thead>
            <tbody>
              {bookings.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-slate-500">
                    No booking requests yet.
                  </td>
                </tr>
              )}
              {bookings.map((b) => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-medium text-slate-900">
                    <Link href={`/console/conversations/${b.conversationId}`} className="hover:underline">
                      {b.slots.name ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{b.slots.phone ?? "—"}</td>
                  <td className="px-4 py-2.5">{b.slots.reason ?? "—"}</td>
                  <td className="px-4 py-2.5">{b.slots.preferred_time ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-500">{when(b.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
