import type { TurnResult } from "../runtime/types.ts";
import type { Expect } from "./cases.ts";

export function replyText(result: Pick<TurnResult, "segments">): string {
  return result.segments.map((s) => s.text).join(" ");
}

/** The checks one reply failed, in words; empty when it passed. */
export function checkReply(expect: Expect | undefined, result: Pick<TurnResult, "segments" | "flow" | "handover">): string[] {
  if (!expect) return [];
  const failures: string[] = [];
  const text = replyText(result).toLowerCase();
  const kinds = result.segments.map((s) => s.kind as string);
  const options = result.segments.flatMap((s) => s.options);
  for (const c of expect.contains ?? []) if (!text.includes(c.toLowerCase())) failures.push(`should say "${c}"`);
  for (const c of expect.notContains ?? []) if (text.includes(c.toLowerCase())) failures.push(`shouldn't say "${c}"`);
  for (const k of expect.kinds ?? []) if (!kinds.includes(k)) failures.push(`should include a ${k} message`);
  for (const k of expect.notKinds ?? []) if (kinds.includes(k)) failures.push(`shouldn't include a ${k} message`);
  for (const o of expect.options ?? []) if (!options.includes(o)) failures.push(`should offer "${o}"`);
  if (expect.step !== undefined) {
    const step = result.flow?.step ?? null;
    if (step !== expect.step) failures.push(`should wait on ${expect.step ?? "nothing"}, waits on ${step ?? "nothing"}`);
  }
  if (expect.handover !== undefined && Boolean(result.handover) !== expect.handover) {
    failures.push(expect.handover ? "should hand over to the team" : "shouldn't hand over");
  }
  return failures;
}
