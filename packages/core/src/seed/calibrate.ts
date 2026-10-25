import { loadRootEnv } from "@dental-bot/db/env";
import { closeDb } from "@dental-bot/db";
import { DEFAULT_TENANT } from "../config.ts";
import { searchChunks } from "../retrieval/search.ts";
import { loadBundle, promotedVersionId } from "../versions.ts";

/**
 * Prints the top retrieval score for questions the website answers and for ones it does not,
 * to choose the relevancy threshold. Phase 1 replaces this with the golden set.
 */

loadRootEnv();

const ANSWERABLE = [
  "Is there parking near the practice?",
  "Is the practice step-free?",
  "How much is a hygienist appointment?",
  "Are you open on Saturdays?",
  "What time do you close on Thursday?",
  "How much is a filling?",
  "Are you taking new NHS patients?",
  "How much is a band 2 NHS treatment?",
  "Do you see children?",
  "How do I cancel an appointment?",
  "Do you offer sedation?",
  "What is the nearest station?",
  "Do you have a dental plan?",
  "How much does a crown cost?",
  "Can I pay in instalments?",
  "Do you take cash?",
  "what's your email address",
  "who is the hygienist",
  "how much are implants",
  "what should I bring to my first appointment",
  "do you send appointment reminders",
  "can I book by email",
];

const NOT_ANSWERABLE = [
  "Do you offer treatment for sleep apnoea?",
  "Do you do botox?",
  "Can I bring my dog?",
  "Do you accept Bupa insurance?",
  "Is there wifi in the waiting room?",
  "What languages do your dentists speak?",
  "Do you do orthodontic braces for adults with metal brackets?",
  "Do you sell electric toothbrushes?",
  "Can I get a sick note?",
  "Is Dr Okafor married?",
  "Who won the football?",
  "Do you offer gift vouchers?",
];

const bundle = await loadBundle(await promotedVersionId(DEFAULT_TENANT));
const report = async (label: string, qs: string[]) => {
  console.log(`\n${label}`);
  const scores: number[] = [];
  for (const q of qs) {
    const [top] = await searchChunks(q, bundle);
    scores.push(top?.score ?? 0);
    console.log(`${(top?.score ?? 0).toFixed(3)}  ${q.padEnd(62)} → ${top?.page} › ${top?.heading}`);
  }
  return scores;
};
const yes = await report("Answerable", ANSWERABLE);
const no = await report("Not answerable", NOT_ANSWERABLE);
for (let t = 0.56; t <= 0.76; t += 0.02) {
  const recall = yes.filter((s) => s >= t).length / yes.length;
  const leak = no.filter((s) => s >= t).length / no.length;
  console.log(`threshold ${t.toFixed(2)}: answerable kept ${(recall * 100).toFixed(0)}%, unanswerable passed ${(leak * 100).toFixed(0)}%`);
}
await closeDb();
