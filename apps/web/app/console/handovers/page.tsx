import Link from "next/link";
import { businessById, listBookingRequests, listHandovers, packFor } from "@dental-bot/core";
import { label, REASON_STYLE, when } from "@/lib/format";
import { currentTenant } from "@/lib/business";
import { AutoRefresh } from "../ui";

export const metadata = { title: "Handovers" };

const STATUS_ORDER: Record<string, number> = { "visitor replied": 0, open: 1, replied: 2, released: 3, closed: 4 };

type Row = { status: string; conversationStatus: string; lastRole: string | null };

function displayStatus(h: Row) {
  if (h.conversationStatus === "closed") return "closed";
  if (h.status === "replied" && h.conversationStatus === "handed_over" && h.lastRole === "visitor") return "visitor replied";
  return h.status;
}

const needsReply = (h: Row) => ["open", "visitor replied"].includes(displayStatus(h));

export default async function HandoversPage() {
  const tenant = await currentTenant();
  const business = businessById(tenant);
  const columns = packFor(business?.vertical).booking.columns;
  const online = business?.booking.mode === "online";
  const [handovers, bookings] = await Promise.all([listHandovers(tenant), listBookingRequests(tenant)]);
  const sorted = [...handovers].sort((a, b) => STATUS_ORDER[displayStatus(a)]! - STATUS_ORDER[displayStatus(b)]!);
  const open = handovers.filter(needsReply).length;

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
              <span className="w-48 shrink-0 truncate text-xs text-slate-600">
                {h.contact.name || h.contact.phone ? [h.contact.name, h.contact.phone].filter(Boolean).join(" · ") : <span className="text-slate-400">no contact yet</span>}
              </span>
              <span className={`w-24 text-xs ${needsReply(h) ? "font-medium text-amber-700" : "text-slate-500"}`}>{displayStatus(h)}</span>
              <span className="w-28 text-right text-xs text-slate-500">{when(h.createdAt)}</span>
            </Link>
          ))}
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
                {online && <th className="px-4 py-2">Outcome</th>}
                <th className="px-4 py-2">Received</th>
              </tr>
            </thead>
            <tbody>
              {bookings.length === 0 && (
                <tr>
                  <td colSpan={columns.length + (online ? 4 : 3)} className="px-4 py-6 text-slate-500">
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
                  {columns.map((col) => (
                    <td key={col.title} className="px-4 py-2.5">
                      {col.value(b.slots) ?? "—"}
                    </td>
                  ))}
                  {online && (
                    <td className="px-4 py-2.5">
                      {b.channel === "online" ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100" title={b.system ?? ""}>
                          Booked · {b.externalRef}
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-100">Call back</span>
                      )}
                    </td>
                  )}
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
