import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

export const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
export const EMBEDDING_DIMENSIONS = 384;
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

/**
 * Precomputed passage vectors, written at image build time, so a first boot on a tiny CPU
 * doesn't have to embed the whole site. Missing entries fall back to the model.
 */
export const EMBEDDING_CACHE_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../seed/.embedding-cache.json",
);

const globalForEmbed = globalThis as unknown as {
  __dentalBotEmbedder?: Promise<FeatureExtractionPipeline>;
  __dentalBotEmbedCache?: Map<string, number[]>;
};

function embedder(): Promise<FeatureExtractionPipeline> {
  globalForEmbed.__dentalBotEmbedder ??= import("@huggingface/transformers").then(
    ({ pipeline }) => pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" }) as Promise<FeatureExtractionPipeline>,
  );
  return globalForEmbed.__dentalBotEmbedder;
}

function cacheKey(kind: string, text: string) {
  return createHash("sha1").update(`${EMBEDDING_MODEL}\n${kind}\n${text}`).digest("base64url");
}

function cache(): Map<string, number[]> {
  if (!globalForEmbed.__dentalBotEmbedCache) {
    globalForEmbed.__dentalBotEmbedCache = existsSync(EMBEDDING_CACHE_FILE)
      ? new Map(Object.entries(JSON.parse(readFileSync(EMBEDDING_CACHE_FILE, "utf8")) as Record<string, number[]>))
      : new Map();
  }
  return globalForEmbed.__dentalBotEmbedCache;
}

/** Small batches keep peak memory low enough for a 512 MB instance; one big batch pads every text to the longest. */
const BATCH_SIZE = 16;

async function embedWithModel(input: string[]): Promise<number[][]> {
  const fe = await embedder();
  const vectors: number[][] = [];
  for (let i = 0; i < input.length; i += BATCH_SIZE) {
    const out = await fe(input.slice(i, i + BATCH_SIZE), { pooling: "cls", normalize: true });
    vectors.push(...(out.tolist() as number[][]));
    out.dispose();
  }
  return vectors;
}

/** Runs locally, so visitor text never leaves the server for embedding. */
export async function embed(texts: string[], kind: "query" | "passage"): Promise<number[][]> {
  if (kind === "query") return embedWithModel(texts.map((t) => QUERY_PREFIX + t));
  const known = cache();
  const keys = texts.map((t) => cacheKey(kind, t));
  const missing = [...new Set(texts.filter((_, i) => !known.has(keys[i]!)))];
  if (missing.length) {
    const fresh = await embedWithModel(missing);
    missing.forEach((t, i) => known.set(cacheKey(kind, t), fresh[i]!));
  }
  return keys.map((k) => known.get(k)!);
}

/** Embeds the given passages and writes them to the cache file shipped with the image. */
export async function writeEmbeddingCache(passages: string[]) {
  globalForEmbed.__dentalBotEmbedCache = new Map();
  await embed(passages, "passage");
  writeFileSync(EMBEDDING_CACHE_FILE, JSON.stringify(Object.fromEntries(cache())));
  return cache().size;
}
