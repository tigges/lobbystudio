import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadRootEnv } from "@dental-bot/db/env";
import { MODEL_ROLES } from "../config.ts";
import { chunkPage } from "../retrieval/chunk.ts";
import { chunkKey, generateQuestions } from "../retrieval/questions.ts";
import { businessById, HARBOUR_DENTAL } from "../businesses.ts";
import { readSeed, seedDir } from "./content.ts";

/** Regenerates seed/<business>/content/questions.json. Run after editing the seed pages: `tsx generate-questions.ts mikan-hair`. */

loadRootEnv();

const business = businessById(process.argv[2] ?? HARBOUR_DENTAL.id);
if (!business) throw new Error(`unknown business ${process.argv[2]}`);
const out: Record<string, string[]> = {};
for (const p of business.pages) {
  for (const c of chunkPage({ slug: p.slug, title: p.title, bodyMd: readSeed(business, "content", p.file) })) {
    out[chunkKey(c)] = await generateQuestions(c, MODEL_ROLES.chat);
    console.log(chunkKey(c), out[chunkKey(c)]!.length);
  }
}
writeFileSync(path.join(seedDir, business.dir, "content", "questions.json"), `${JSON.stringify(out, null, 2)}\n`);
