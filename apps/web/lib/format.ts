const TZ = "Europe/London";

export function when(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function label(s: string | null | undefined) {
  return s ? s.replace(/_/g, " ") : "—";
}

export const OUTCOME_STYLE: Record<string, string> = {
  resolved_by_bot: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  resolved_after_handover: "bg-teal-50 text-teal-800 ring-teal-200",
  abandoned: "bg-slate-100 text-slate-700 ring-slate-200",
  escalated_unresolved: "bg-rose-50 text-rose-800 ring-rose-200",
  out_of_scope: "bg-violet-50 text-violet-800 ring-violet-200",
  blocked_by_guardrail: "bg-amber-50 text-amber-900 ring-amber-200",
};

export const REASON_STYLE: Record<string, string> = {
  emergency: "bg-rose-600 text-white",
  pain_or_symptoms: "bg-rose-50 text-rose-800 ring-1 ring-rose-200",
  clinical_advice: "bg-amber-50 text-amber-900 ring-1 ring-amber-200",
};
