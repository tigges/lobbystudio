import { LABEL_GOALS, labelTitle, TURN_LABELS } from "@dental-bot/core";
import { when } from "@/lib/format";
import { labelTurnAction } from "./actions";
import { SaveButton } from "./ui";

export const LABEL_STYLE: Record<string, string> = {
  good: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  correctness: "bg-rose-50 text-rose-800 ring-rose-200",
  flow: "bg-sky-50 text-sky-800 ring-sky-200",
  workload: "bg-amber-50 text-amber-900 ring-amber-200",
};

function goalOf(key: string) {
  return TURN_LABELS.find((l) => l.key === key)?.goal ?? "flow";
}

export function LabelChip({ label }: { label: string }) {
  const urgent = label === "should_hand_over";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${urgent ? "bg-rose-600 text-white ring-rose-600" : LABEL_STYLE[goalOf(label)]}`}>
      {labelTitle(label)}
    </span>
  );
}

/** One turn's label and note. Saving with no label selected clears it. */
export function LabelForm({
  turnId,
  current,
  note,
  path,
  compact = false,
  savedAt = null,
}: {
  turnId: number;
  current: string | null;
  note: string | null;
  path: string;
  compact?: boolean;
  savedAt?: Date | string | null;
}) {
  return (
    <form action={labelTurnAction} className={compact ? "flex flex-wrap items-center gap-2" : "space-y-2"}>
      <input type="hidden" name="turnId" value={turnId} />
      <input type="hidden" name="path" value={path} />
      {compact ? (
        <select name="label" defaultValue={current ?? ""} aria-label="Label" className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs">
          <option value="">No label</option>
          {LABEL_GOALS.map((g) => (
            <optgroup key={g.key} label={g.title}>
              {TURN_LABELS.filter((l) => l.goal === g.key).map((l) => (
                <option key={l.key} value={l.key}>
                  {l.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      ) : (
        <div className="space-y-1.5">
          {LABEL_GOALS.map((g) => (
            <div key={g.key} className="flex flex-wrap items-center gap-1.5">
              <span className="w-28 shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-400">{g.title}</span>
              {TURN_LABELS.filter((l) => l.goal === g.key).map((l) => (
                <label
                  key={l.key}
                  title={l.hint}
                  className={`cursor-pointer rounded-full px-2 py-0.5 text-xs ring-1 ring-slate-200 hover:bg-slate-50 has-[:checked]:text-white has-[:checked]:ring-transparent ${
                    l.key === "should_hand_over" ? "has-[:checked]:bg-rose-600" : "has-[:checked]:bg-slate-800"
                  }`}
                >
                  <input type="radio" name="label" value={l.key} defaultChecked={current === l.key} className="sr-only" />
                  {l.title}
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
      <input
        name="note"
        defaultValue={note ?? ""}
        placeholder="Note (optional): what should have happened?"
        aria-label="Note"
        className={`rounded-lg border border-slate-300 px-2 py-1 text-xs ${compact ? "min-w-48 flex-1" : "w-full"}`}
      />
      <div className="flex items-center gap-2">
        <SaveButton>Save label</SaveButton>
        {current && savedAt && <span className="text-[11px] text-slate-400">saved {when(savedAt)}</span>}
        {current && !compact && (
          <button name="clear" value="1" className="rounded-lg px-3 py-1 text-xs text-slate-500 hover:bg-slate-100">
            Clear
          </button>
        )}
      </div>
    </form>
  );
}
