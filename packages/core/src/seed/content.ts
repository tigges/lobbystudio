import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunks, contentPages, contentVersions, getDb, passages, type Db } from "@dental-bot/db";
import { BUSINESSES, type Business } from "../businesses.ts";
import { chunkLines, chunkPage, embeddingText } from "../retrieval/chunk.ts";
import { embed } from "../retrieval/embed.ts";
import { chunkKey } from "../retrieval/questions.ts";

export const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../seed");

export function readSeed(business: Business, ...parts: string[]): string {
  return readFileSync(path.join(seedDir, business.dir, ...parts), "utf8").trim();
}

export function seedPages(business: Business) {
  return business.pages.map((p) => ({ slug: p.slug, title: p.title, navLabel: p.navLabel, bodyMd: readSeed(business, "content", p.file) }));
}

export function seedQuestions(business: Business): Record<string, string[]> {
  return JSON.parse(readSeed(business, "content", "questions.json")) as Record<string, string[]>;
}

/** Every business's seed passages, for the embedding cache baked into the image. */
export function allSeedPassageTexts() {
  return BUSINESSES.flatMap((b) => passageTexts(seedPages(b), seedQuestions(b)));
}

/** Every passage text a content version embeds: chunk texts, then their lines and questions. */
export function passageTexts(pages: { slug: string; title: string; bodyMd: string }[], questions: Record<string, string[]> = {}) {
  const pieces = pages.flatMap((p) => chunkPage(p));
  return [
    ...pieces.map(embeddingText),
    ...pieces.flatMap((c) => [...chunkLines(c), ...(questions[chunkKey(c)] ?? [])]),
  ];
}

/** Creates an immutable content version: pages plus their embedded chunks. */
export async function createContentVersion(
  tenantId: string,
  number: number,
  note: string,
  pages: { slug: string; title: string; navLabel: string; bodyMd: string }[],
  questions: Record<string, string[]> = {},
  db: Pick<Db, "insert"> = getDb(),
): Promise<number> {
  const [cv] = await db.insert(contentVersions).values({ tenantId, number, note }).returning();
  await db.insert(contentPages).values(
    pages.map((p, i) => ({ tenantId, contentVersionId: cv!.id, position: i, ...p })),
  );
  const pieces = pages.flatMap((p) => chunkPage(p));
  const vectors = await embed(pieces.map(embeddingText), "passage");
  const inserted = await db
    .insert(chunks)
    .values(pieces.map((c, i) => ({ tenantId, contentVersionId: cv!.id, ...c, embedding: vectors[i]! })))
    .returning({ id: chunks.id });
  const lines = pieces.flatMap((c, i) =>
    [...chunkLines(c), ...(questions[chunkKey(c)] ?? [])].map((text) => ({ chunkId: inserted[i]!.id, text })),
  );
  const lineVectors = await embed(
    lines.map((l) => l.text),
    "passage",
  );
  await db
    .insert(passages)
    .values(lines.map((l, i) => ({ tenantId, contentVersionId: cv!.id, ...l, embedding: lineVectors[i]! })));
  return cv!.id;
}
