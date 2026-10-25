import { writeEmbeddingCache } from "../retrieval/embed.ts";
import { passageTexts, seedPages, seedQuestions } from "./content.ts";

/** Run at image build time: ships the seed content's passage vectors so first boot skips the model work. */
const started = Date.now();
const size = await writeEmbeddingCache(passageTexts(seedPages(), seedQuestions()));
console.log(`[embed] cached ${size} passage vectors in ${Date.now() - started} ms`);
