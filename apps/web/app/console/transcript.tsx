import type { WidgetMessage } from "@dental-bot/core";

const ROLE_STYLE: Record<WidgetMessage["role"], string> = {
  visitor: "ml-auto bg-harbour-600 text-white",
  bot: "bg-white ring-1 ring-slate-200",
  staff: "bg-emerald-50 ring-1 ring-emerald-200",
  system: "mx-auto bg-transparent text-xs text-slate-500",
};

export function Transcript({ messages }: { messages: WidgetMessage[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      {messages.map((m) => (
        <div key={m.id} className={`max-w-[85%] ${m.role === "visitor" ? "self-end" : m.role === "system" ? "self-center" : "self-start"}`}>
          {m.role === "staff" && <p className="mb-0.5 text-xs text-emerald-800">{m.authorName ?? "Team"}</p>}
          <div className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${ROLE_STYLE[m.role]}`}>{m.text}</div>
          {(m.sources.length > 0 || m.feedback !== null) && (
            <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-slate-500">
              {m.sources.map((s) => (
                <span key={`${s.chunkId}`} className="rounded bg-slate-100 px-1.5 py-0.5">
                  {s.page} › {s.heading}
                </span>
              ))}
              {m.feedback === 1 && <span className="font-medium text-emerald-700">Visitor: helpful</span>}
              {m.feedback === -1 && <span className="font-medium text-rose-700">Visitor: not helpful</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
