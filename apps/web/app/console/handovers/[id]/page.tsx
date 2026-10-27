import Link from "next/link";
import { notFound } from "next/navigation";
import { conversationDetail } from "@dental-bot/core";
import { label, REASON_STYLE, when } from "@/lib/format";
import { currentTenant } from "@/lib/business";
import { contactAction, releaseAction, replyAction, testChatAction } from "../../actions";
import { Transcript } from "../../transcript";
import { AutoRefresh, TestChatForm } from "../../ui";

export const metadata = { title: "Handover" };

const UUID_RE = /^[0-9a-f-]{36}$/i;

export default async function HandoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const detail = await conversationDetail(await currentTenant(), id);
  if (!detail) notFound();
  const { conversation, messages, handovers } = detail;
  const handover = handovers.at(-1);
  const handedOver = conversation.status === "handed_over";
  const closed = conversation.status === "closed";
  const said = messages.filter((m) => m.role !== "system");
  const last = said.at(-1);
  const staffAsked = last?.role === "staff" && last.text.trim().endsWith("?");
  const visitorReplied = handedOver && last?.role === "visitor" && said.some((m) => m.role === "staff");
  const saved = handover?.contact ?? {};
  const hasSaved = Boolean(saved.name || saved.phone);
  const name = saved.name ?? detail.typedContact.name;
  const phone = saved.phone ?? detail.typedContact.phone;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <AutoRefresh />
      <section>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link href="/console/handovers" className="text-sm text-slate-500 hover:text-slate-800">
            ← Inbox
          </Link>
          {handover && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${REASON_STYLE[handover.reason] ?? "bg-slate-100 text-slate-700"}`}>
              {label(handover.reason)}
            </span>
          )}
          <span className="text-sm text-slate-500">
            {label(conversation.status)} · started {when(conversation.startedAt)}
          </span>
          <TestChatForm conversationId={conversation.id} isTest={conversation.isTest} action={testChatAction} />
        </div>
        <div className="rounded-2xl bg-slate-100/70 p-4">
          <Transcript messages={messages} />
        </div>
      </section>

      <aside className="space-y-4">
        {visitorReplied && (
          <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
            <h2 className="font-semibold">The visitor has replied</h2>
            <p>Their latest message is at the bottom of the chat. This page refreshes on its own.</p>
          </div>
        )}
        {saved.details && (
          <div className="rounded-2xl bg-white p-4 text-sm ring-1 ring-slate-200">
            <h2 className="mb-1 font-semibold text-slate-900">What they told the assistant</h2>
            <p className="text-slate-800">{saved.details}</p>
          </div>
        )}
        {handover && (
          <div className="rounded-2xl bg-white p-4 text-sm ring-1 ring-slate-200">
            <h2 className="mb-1 font-semibold text-slate-900">Contact</h2>
            {name || phone ? (
              <>
                <p className="text-slate-800">{name ?? "Name not given"}</p>
                {phone ? (
                  <a href={`tel:${phone.replace(/\s/g, "")}`} className="text-harbour-700 hover:underline">
                    {phone}
                  </a>
                ) : (
                  <p className="text-slate-500">Phone not given</p>
                )}
                {!hasSaved && <p className="mt-1 text-xs text-slate-500">Typed in the chat, not yet confirmed.</p>}
              </>
            ) : (
              <p className="text-slate-500">The assistant has asked for a phone number and name; none given yet.</p>
            )}
            {!closed && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-harbour-700">
                  {hasSaved ? "Edit contact" : "Confirm contact"}
                </summary>
                <form action={contactAction} className="mt-2 space-y-2">
                  <input type="hidden" name="conversationId" value={conversation.id} />
                  <input
                    name="name"
                    defaultValue={name ?? ""}
                    placeholder="Name"
                    aria-label="Name"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                  />
                  <input
                    name="phone"
                    defaultValue={phone ?? ""}
                    placeholder="Phone"
                    aria-label="Phone"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                  />
                  <button className="w-full rounded-lg bg-slate-100 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-200">
                    Save contact
                  </button>
                </form>
              </details>
            )}
          </div>
        )}
        {closed ? (
          <div className="space-y-2 rounded-2xl bg-white p-4 text-sm ring-1 ring-slate-200">
            <h2 className="font-semibold text-slate-900">Closed — nothing to do in the chat</h2>
            <p className="text-slate-600">
              The visitor can no longer reply here. Outcome: <strong>{label(conversation.outcome)}</strong>
              {conversation.outcomeBasis ? ` (${conversation.outcomeBasis})` : ""}.
            </p>
            <p className="text-slate-600">
              If the team promised something in the chat, such as holding an appointment or calling back, do it in the practice
              system, using the contact details above.
            </p>
          </div>
        ) : (
          <form action={replyAction} className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <input type="hidden" name="conversationId" value={conversation.id} />
            <h2 className="font-semibold text-slate-900">Reply to the visitor</h2>
            <p className="text-xs text-slate-500">Your reply appears in their chat straight away. Their answers come to you until you release the chat.</p>
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
                Teach the assistant this answer
                <span className="block text-xs text-slate-500">
                  It answers the same question this way from now on. Safety topics and replies with personal details wait for you on Insights; you can undo any answer there.
                </span>
              </span>
            </label>
            <button className="w-full rounded-lg bg-harbour-600 py-2 font-medium text-white hover:bg-harbour-700">Send reply</button>
          </form>
        )}

        {handedOver && (
          <form action={releaseAction} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <input type="hidden" name="conversationId" value={conversation.id} />
            <p className="mb-3 text-sm text-slate-600">Finished? Hand the visitor back to the assistant.</p>
            {staffAsked && (
              <p className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                You asked the visitor a question. Wait for their answer: if you release now, it goes to the assistant instead of you.
              </p>
            )}
            <button className="w-full rounded-lg bg-slate-100 py-2 text-sm font-medium text-slate-800 hover:bg-slate-200">Release to assistant</button>
          </form>
        )}

        <Link href={`/console/conversations/${conversation.id}`} className="block text-sm text-harbour-700 hover:underline">
          Turn ledger (admin) →
        </Link>
      </aside>
    </div>
  );
}
