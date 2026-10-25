import Link from "next/link";
import { type BookingDef, type conversationDetail, DECIDED_BY, type FlowRun, stepTitle } from "@dental-bot/core";
import { label } from "@/lib/format";

type Detail = NonNullable<Awaited<ReturnType<typeof conversationDetail>>>;
type LedgerTurn = Detail["turns"][number];
type Reply = { kind: string; text: string; options: string[] };

const SAFETY_RULES = new Set(["clinical_precheck", "abuse"]);

const STAGE_TONE = {
  plain: "bg-white ring-slate-200",
  good: "bg-emerald-50 ring-emerald-200",
  warn: "bg-amber-50 ring-amber-200",
  bad: "bg-rose-50 ring-rose-200",
  model: "bg-violet-50 ring-violet-200",
} as const;

function Stage({ title, tone = "plain", children }: { title: string; tone?: keyof typeof STAGE_TONE; children: React.ReactNode }) {
  return (
    <div className={`min-w-0 rounded-lg p-2 ring-1 ${STAGE_TONE[tone]}`}>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <div className="space-y-1 text-xs text-slate-700">{children}</div>
    </div>
  );
}

function commandText(c: { cmd: string; [key: string]: unknown }, def: BookingDef) {
  switch (c.cmd) {
    case "answer_from_knowledge":
      return `answer “${c.query}”`;
    case "start_flow":
      return `start ${label(String(c.flow))}`;
    case "set_slot":
      return `${stepTitle(String(c.slot), def)} = ${c.value}`;
    case "clarify":
      return `clarify: ${(c.options as string[]).join(" / ")}`;
    case "handover":
      return `handover · ${label(String(c.reason))}`;
    case "cannot_handle":
      return `can't handle · ${label(String(c.reason))}`;
    default:
      return c.cmd;
  }
}

function flowText(f: LedgerTurn["flowBefore"], def: BookingDef) {
  return f ? `${f.name === "booking_request" ? "Booking" : "Handover"} · ${stepTitle(f.step, def)}` : "no flow";
}

/** Left to right: what each stage of the executor did with this turn. */
export function DecisionPath({ turn: t, replies, def }: { turn: LedgerTurn; replies: Reply[]; def: BookingDef }) {
  const safety = t.guardrails.filter((g) => SAFETY_RULES.has(g.rule) && g.result !== "pass");
  const checks = t.guardrails.filter((g) => !SAFETY_RULES.has(g.rule));
  const fired = checks.filter((g) => g.result !== "pass");
  const planner = t.modelCalls.find((m) => m.role === "planner");
  const compose = t.modelCalls.find((m) => m.role === "compose");
  const rule = t.decidedBy
    ? (DECIDED_BY[t.decidedBy] ?? {
        title: label(t.decidedBy),
        detail: t.decidedBy,
      })
    : null;
  const top = t.retrieved.slice(0, 3);

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      <Stage title="1 · Safety" tone={safety.length ? "bad" : "good"}>
        {safety.length === 0 ? (
          <p>No symptoms or abuse spotted</p>
        ) : (
          safety.map((g, i) => (
            <p key={i} title={g.detail}>
              <span className="font-medium">{label(g.rule)}</span> {g.result}
              {g.detail ? ` · ${g.detail}` : ""}
            </p>
          ))
        )}
      </Stage>

      <Stage title="2 · Decided by" tone={rule ? "plain" : "model"}>
        {rule ? (
          <p title={t.decidedBy ?? undefined}>
            <span className="font-medium">Fixed rule: {rule.title}</span>
            <span className="block text-slate-500">{rule.detail}. The planner was not asked.</span>
          </p>
        ) : planner ? (
          <p>
            <span className="font-medium">AI planner</span>
            <span className="block text-slate-500">
              {planner.model} · {planner.latencyMs} ms · ${planner.costUsd.toFixed(4)}
            </span>
          </p>
        ) : (
          <p>
            <span className="font-medium">{t.llmMode === "offline" ? "Offline planner" : "Planner"}</span>
            <span className="block text-slate-500">
              {t.llmMode === "offline" ? "Deterministic stand-in for the model, no cost" : "No model call recorded"}
            </span>
          </p>
        )}
      </Stage>

      <Stage title="3 · Commands" tone={t.rejectedCommands.length ? "warn" : "plain"}>
        {t.commands.length === 0 && <p className="text-slate-400">none, the rule wrote the reply</p>}
        {t.commands.map((c, i) => (
          <p key={i} className="font-mono text-[11px]">
            {commandText(c, def)}
          </p>
        ))}
        {t.rejectedCommands.length > 0 && <p className="text-amber-800">{t.rejectedCommands.length} rejected, see raw details</p>}
      </Stage>

      <Stage title="4 · Sources">
        {top.length === 0 && <p className="text-slate-400">no search</p>}
        {top.map((r) => (
          <div key={r.chunkId} title={`${r.page} › ${r.heading} · ${label(r.used)}`}>
            <p className="truncate">
              {r.page} › {r.heading}
            </p>
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 rounded-full bg-slate-100">
                <div
                  className={`h-1.5 rounded-full ${r.used === "cited" ? "bg-emerald-500" : r.used === "context" ? "bg-slate-400" : "bg-slate-200"}`}
                  style={{
                    width: `${Math.max(4, Math.min(100, r.score * 100))}%`,
                  }}
                />
              </div>
              <span className="w-24 shrink-0 text-right tabular-nums text-slate-500">
                {r.score.toFixed(2)} {r.used === "below_threshold" ? "too low" : label(r.used).toLowerCase()}
              </span>
            </div>
          </div>
        ))}
      </Stage>

      <Stage title="5 · Checks" tone={fired.some((g) => g.result === "blocked" || g.result === "dropped") ? "warn" : "plain"}>
        {fired.length === 0 ? (
          <p>{checks.length ? `${checks.length} passed` : "nothing to check"}</p>
        ) : (
          <>
            {fired.map((g, i) => (
              <p key={i} title={g.detail}>
                <span className="font-medium">{label(g.rule)}</span> {g.result}
                {g.detail ? <span className="text-slate-500"> · {g.detail}</span> : null}
              </p>
            ))}
            {checks.length > fired.length && <p className="text-slate-500">{checks.length - fired.length} passed</p>}
          </>
        )}
      </Stage>

      <Stage title="6 · Reply and flow" tone={t.error ? "bad" : "plain"}>
        {t.error && <p className="text-rose-800">{t.error}</p>}
        {replies.length === 0 && <p className="text-slate-400">no reply recorded</p>}
        {replies.map((r, i) => (
          <div key={i}>
            <p className="line-clamp-2">
              <span className="mr-1 rounded bg-slate-100 px-1 text-[10px] uppercase text-slate-500">{label(r.kind)}</span>
              {r.text}
            </p>
            {r.options.length > 0 && (
              <p className="mt-0.5 flex flex-wrap gap-1">
                {r.options.map((o) => (
                  <span key={o} className="rounded-full px-1.5 text-[10px] text-harbour-700 ring-1 ring-harbour-100">
                    {o}
                  </span>
                ))}
              </p>
            )}
          </div>
        ))}
        <p className="text-slate-500">
          {flowText(t.flowBefore, def)} → {flowText(t.flowAfter, def)}
          {compose ? ` · written by ${compose.model}` : ""}
        </p>
      </Stage>
    </div>
  );
}

const END_STYLE: Record<FlowRun["end"]["kind"], string> = {
  sent: "bg-emerald-100 text-emerald-900",
  team_replied: "bg-emerald-100 text-emerald-900",
  passed_to_team: "bg-amber-100 text-amber-900",
  waiting: "bg-amber-100 text-amber-900",
  stopped: "bg-rose-100 text-rose-800",
  left: "bg-rose-100 text-rose-800",
};

function TurnLink({ path, turn }: { path: string; turn: number }) {
  return (
    <Link href={`${path}?turn=${turn}#turn-${turn}`} className="text-harbour-700 hover:underline">
      #{turn}
    </Link>
  );
}

/** Each flow the chat went through, step by step, with the turns spent on each and where it ended. */
export function FlowMap({ runs, path }: { runs: FlowRun[]; path: string }) {
  if (runs.length === 0) return null;
  return (
    <div className="space-y-3 rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
      <div className="flex items-baseline gap-3">
        <h3 className="text-sm font-semibold text-slate-900">Flow map</h3>
        <span className="text-xs text-slate-500">Turns spent on each step. ↺ means the step was asked again.</span>
      </div>
      {runs.map((run, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="mr-1 font-medium text-slate-900">
            {run.title} <span className="font-normal text-slate-500">from</span> <TurnLink path={path} turn={run.startTurn} />
          </span>
          {run.steps.map((s) => {
            const stopped = (run.end.kind === "stopped" || run.end.kind === "left") && run.end.step === s.key;
            return (
              <span key={s.key} className="flex items-center gap-1.5">
                <span
                  className={`rounded-md px-2 py-1 ring-1 ${
                    stopped
                      ? "bg-rose-50 ring-rose-300"
                      : s.turns.length === 0
                        ? "bg-slate-50 text-slate-400 ring-slate-200"
                        : "bg-harbour-50 ring-harbour-100"
                  }`}
                  title={s.turns.length === 0 ? "Not asked: already known, or the chat ended first" : undefined}
                >
                  {s.title}{" "}
                  {s.turns.length === 0 ? (
                    <span>·</span>
                  ) : (
                    <>
                      {s.turns
                        .map((n) => <TurnLink key={n} path={path} turn={n} />)
                        .reduce<React.ReactNode[]>((acc, el, j) => (j ? [...acc, " ", el] : [el]), [])}
                      {s.turns.length > 1 && <span className="ml-0.5 text-amber-700">↺</span>}
                    </>
                  )}
                </span>
                <span className="text-slate-300">→</span>
              </span>
            );
          })}
          <span className={`rounded-md px-2 py-1 font-medium ${END_STYLE[run.end.kind]}`}>
            {run.end.title} <TurnLink path={path} turn={run.end.turn} />
          </span>
        </div>
      ))}
    </div>
  );
}
