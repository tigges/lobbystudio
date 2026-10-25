import { writeEmbeddingCache } from "../retrieval/embed.ts";
import { allSeedPassageTexts } from "./content.ts";

/** Run at image build time: ships every seeded business's passage vectors so first boot skips the model work. */
const started = Date.now();
const size = await writeEmbeddingCache(allSeedPassageTexts());
console.log(`[embed] cached ${size} passage vectors in ${Date.now() - started} ms`);
