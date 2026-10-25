import type { FeatureExtractionPipeline } from "@huggingface/transformers";

export const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
export const EMBEDDING_DIMENSIONS = 384;
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

const globalForEmbed = globalThis as unknown as { __dentalBotEmbedder?: Promise<FeatureExtractionPipeline> };

function embedder(): Promise<FeatureExtractionPipeline> {
  globalForEmbed.__dentalBotEmbedder ??= import("@huggingface/transformers").then(
    ({ pipeline }) => pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" }) as Promise<FeatureExtractionPipeline>,
  );
  return globalForEmbed.__dentalBotEmbedder;
}

/** Runs locally, so visitor text never leaves the server for embedding. */
export async function embed(texts: string[], kind: "query" | "passage"): Promise<number[][]> {
  const fe = await embedder();
  const input = kind === "query" ? texts.map((t) => QUERY_PREFIX + t) : texts;
  const out = await fe(input, { pooling: "cls", normalize: true });
  return out.tolist() as number[][];
}
