import Link from "next/link";
import { notFound } from "next/navigation";
import { conversationDetail } from "@dental-bot/core";
import { label, REASON_STYLE, when } from "@/lib/format";
import { SITE_TENANT } from "@/lib/site";
import { releaseAction, replyAction } from "../../actions";
import { Transcript } from "../../transcript";
import { AutoRefresh } from "../../ui";

export const metadata = { title: "Handover" };

const UUID_RE = /^[0-9a-f-]{36}$/i;

export default async function HandoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const detail = await conversationDetail(SITE_TENANT, id);
  if (!detail) notFound();
  const { conversation, messages, handovers } = detail;
  const handover = handovers.at(-1);
  const handedOver = conversation.status === "handed_over";

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <AutoRefresh />
      <section>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link href="/console/handovers" className="text-sm text-slate-500 hover:text-slate-800">
            ← Handovers
          </Link>
          {handover && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${REASON_STYLE[handover.reason] ?? "bg-slate-100 text-slate-700"}`}>
              {label(handover.reason)}
            </span>
          )}
          <span className="text-sm text-slate-500">
            {label(conversation.status)} · started {when(conversation.startedAt)}
          </span>
        </div>
        <div className="rounded-2xl bg-slate-100/70 p-4">
          <Transcript messages={messages} />
        </div>
      </section>

      <aside className="space-y-4">
        <form action={replyAction} className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <input type="hidden" name="conversationId" value={conversation.id} />
          <h2 className="font-semibold text-slate-900">Reply to the visitor</h2>
          <p className="text-xs text-slate-500">Your reply appears in their chat window straight away.</p>
          <label className="block text-sm">
            <span className="text-slate-600">Your name</span>
            <input name="author" defaultValue="Jess Morgan" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5" />
          </label>
          <textarea
            name="text"
            required
            rows={5}
            placeholder="Type your reply…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" name="saveAsLabel" defaultChecked className="mt-1" />
            <span>
              Save as the correct answer
              <span className="block text-xs text-slate-500">Used to teach the assistant. Only after you approve a proposal.</span>
            </span>
          </label>
          <button className="w-full rounded-lg bg-harbour-600 py-2 font-medium text-white hover:bg-harbour-700">Send reply</button>
        </form>

        {handedOver && (
          <form action={releaseAction} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <input type="hidden" name="conversationId" value={conversation.id} />
            <p className="mb-3 text-sm text-slate-600">Finished? Hand the visitor back to the assistant.</p>
            <button className="w-full rounded-lg bg-slate-100 py-2 text-sm font-medium text-slate-800 hover:bg-slate-200">Release to assistant</button>
          </form>
        )}

        <Link href={`/console/conversations/${conversation.id}`} className="block text-sm text-harbour-700 hover:underline">
          Open in conversation inspector →
        </Link>
      </aside>
    </div>
  );
}
