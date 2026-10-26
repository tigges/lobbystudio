import { loadRootEnv } from "@dental-bot/db/env";
import { closeDb } from "@dental-bot/db";
import { BUSINESSES } from "../businesses.ts";
import { llmMode, type LlmMode } from "../config.ts";
import { anthropicKey } from "../llm/anthropic.ts";
import { runEvals } from "./run.ts";

loadRootEnv();

/**
 * pnpm eval [business…] [--live|--offline] [--judge] [--only <name>] [--no-save]
 * Exits 1 when any check fails, so it can gate a deploy.
 */
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = value("only");
const tenants = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--only");
const mode: LlmMode = flag("live") ? "live" : flag("offline") ? "offline" : llmMode();
const judge = flag("judge");
if ((mode === "live" || judge) && !anthropicKey()) {
  console.error("Live mode and --judge need ANTHROPIC_API_KEY.");
  process.exit(2);
}

let failed = 0;
for (const id of tenants.length ? tenants : BUSINESSES.map((b) => b.id)) {
  console.log(`\n${id} (${mode}${judge ? ", judged" : ""})`);
  const run = await runEvals({
    tenantId: id,
    mode,
    judge,
    only,
    save: !flag("no-save"),
    onCase(c) {
      console.log(`  ${c.passed ? "pass" : "FAIL"}  ${c.name}`);
      for (const t of c.turns) {
        const j = t.judgement;
        const weak = j && Math.min(j.correct, j.grounded, j.answers, j.nextStep) <= 3;
        if (!t.failures.length && !weak) continue;
        console.log(`        > ${t.say}`);
        for (const f of t.failures) console.log(`          ${f}`);
        if (weak) console.log(`          judge ${j.correct}/${j.grounded}/${j.answers}/${j.nextStep}: ${j.note}`);
        console.log(`          reply: ${t.reply}`);
      }
    },
  });
  failed += run.cases.length - run.passed;
  const s = run.scores;
  console.log(
    `  ${run.passed}/${run.cases.length} passed` +
      (s ? `; judge: correct ${s.correct}, grounded ${s.grounded}, answers ${s.answers}, next step ${s.nextStep}; $${run.costUsd}` : ""),
  );
}
await closeDb();
process.exit(failed ? 1 : 0);
