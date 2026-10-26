import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { casesFile, loadCases, type EvalCase, type EvalTurn } from "./cases.ts";

type ExportedLabel = {
  label: string;
  note: string | null;
  turnId: number;
  conversationId: string;
  turn: number;
  visitor: string;
  assistant: string;
  before: { role: string; text: string }[];
  flowAfter: { step: string } | null;
};

/** Tokens stand in for personal details in the export; replays need real-looking values. */
const FAKE: Record<string, string> = { NAME: "Mia Tanaka", PHONE: "07700 900321", EMAIL: "mia@example.com" };

function untokenise(text: string) {
  return text.replace(/‹([A-Z]+)_\d+›/g, (m, kind: string) => FAKE[kind] ?? m);
}

/** A time offered from the diary, e.g. "Wed 28 Oct, 10:30 with Hana": the replay is offered other dates. */
const OFFERED_TIME = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2}\b/;

function turnFrom(text: string): EvalTurn {
  if (text === "[action:book]") return { action: "book" };
  return { say: OFFERED_TIME.test(text) ? "the first one" : untokenise(text) };
}

/**
 * A label export as draft cases, one per conversation: the visitor's messages up to its last labelled turn,
 * with each reviewer's note for the judge on the turn it was given.
 */
export function casesFromLabels(labels: ExportedLabel[]): EvalCase[] {
  const byConversation = new Map<string, ExportedLabel[]>();
  for (const l of labels) byConversation.set(l.conversationId, [...(byConversation.get(l.conversationId) ?? []), l]);
  return [...byConversation.values()].map((group) => {
    // Each label carries only the last few messages; together they usually cover the whole chat.
    const byTurn = new Map<number, string>();
    for (const l of group) {
      const earlier = l.before.filter((m) => m.role === "visitor").map((m) => m.text);
      earlier.forEach((text, i) => byTurn.set(l.turn - earlier.length + i, text));
      byTurn.set(l.turn, l.visitor);
    }
    const lastTurn = Math.max(...byTurn.keys());
    let offset = lastTurn;
    while (byTurn.has(offset - 1)) offset -= 1;
    const turns = Array.from({ length: lastTurn - offset + 1 }, (_, i) => turnFrom(byTurn.get(offset + i)!));
    for (const l of group) {
      const at = turns[l.turn - offset];
      if (!at) continue;
      const hint =
        l.label === "good"
          ? `Reviewed as good. It replied: "${untokenise(l.assistant)}"`
          : `Reviewed as ${l.label.replace(/_/g, " ")}${l.note ? `: ${l.note}` : ""}. It had replied: "${untokenise(l.assistant)}"`;
      at.expect = { judge: hint, ...(l.label === "good" ? { step: l.flowAfter?.step ?? null } : {}) };
    }
    const first = group.reduce((a, b) => (b.turn < a.turn ? b : a));
    return {
      name: `${first.label.replace(/_/g, " ")}: ${untokenise(first.visitor).slice(0, 60)}`,
      source: `labels on turns ${group.map((l) => l.turnId).sort((a, b) => a - b).join(", ")}`,
      turns,
    };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file] = process.argv.slice(2);
  if (!file || !existsSync(file)) {
    console.error("Usage: pnpm eval:labels <labels export.json>");
    process.exit(2);
  }
  const exported = JSON.parse(readFileSync(file, "utf8")) as { tenant: string; labels: ExportedLabel[] };
  const existing = loadCases(exported.tenant);
  const known = new Set(existing.map((c) => c.source));
  const fresh = casesFromLabels(exported.labels).filter((c) => !known.has(c.source));
  writeFileSync(casesFile(exported.tenant), `${JSON.stringify([...existing, ...fresh], null, 2)}\n`);
  console.log(`${fresh.length} new case(s) added to ${casesFile(exported.tenant)}; add checks to their expect blocks.`);
}
