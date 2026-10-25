import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadRootEnv } from "@dental-bot/db/env";
import { MODEL_ROLES } from "../config.ts";
import { chunkPage } from "../retrieval/chunk.ts";
import { chunkKey, generateQuestions } from "../retrieval/questions.ts";
import { PAGES, readSeed, seedDir } from "./content.ts";

/** Regenerates seed/content/questions.json. Run after editing the seed pages. */

loadRootEnv();

const out: Record<string, string[]> = {};
for (const p of PAGES) {
  for (const c of chunkPage({ slug: p.slug, title: p.title, bodyMd: readSeed("content", p.file) })) {
    out[chunkKey(c)] = await generateQuestions(c, MODEL_ROLES.chat);
    console.log(chunkKey(c), out[chunkKey(c)]!.length);
  }
}
writeFileSync(path.join(seedDir, "content", "questions.json"), `${JSON.stringify(out, null, 2)}\n`);
