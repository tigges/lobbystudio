import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** What one reply must and mustn't do. Text checks ignore case; a reply's text is all its messages joined. */
export const Expect = z
  .object({
    contains: z.array(z.string()).optional(),
    notContains: z.array(z.string()).optional(),
    /** Message kinds the reply must include, e.g. "suggest" for a booking offer or "handover". */
    kinds: z.array(z.string()).optional(),
    notKinds: z.array(z.string()).optional(),
    /** Buttons the reply must offer (a subset). */
    options: z.array(z.string()).optional(),
    /** The booking or handover step the chat is waiting on afterwards; null when no flow is active. */
    step: z.string().nullable().optional(),
    handover: z.boolean().optional(),
    /** For the judge: what a good reply does here, e.g. a reviewer's note. */
    judge: z.string().optional(),
  })
  .strict();
export type Expect = z.infer<typeof Expect>;

export const EvalTurn = z
  .object({ say: z.string().optional(), action: z.enum(["book", "handover"]).optional(), expect: Expect.optional() })
  .strict()
  .refine((t) => Boolean(t.say) !== Boolean(t.action), "each turn needs exactly one of say or action");
export type EvalTurn = z.infer<typeof EvalTurn>;

export const EvalCase = z
  .object({
    name: z.string(),
    /** Where the case came from, e.g. "label on turn 77". */
    source: z.string().optional(),
    turns: z.array(EvalTurn).min(1),
  })
  .strict();
export type EvalCase = z.infer<typeof EvalCase>;

export const EVALS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../evals");

export function casesFile(tenantId: string) {
  return path.join(EVALS_DIR, `${tenantId}.json`);
}

export function loadCases(tenantId: string): EvalCase[] {
  const file = casesFile(tenantId);
  if (!existsSync(file)) return [];
  return z.array(EvalCase).parse(JSON.parse(readFileSync(file, "utf8")));
}
