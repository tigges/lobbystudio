import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunks, contentPages, contentVersions, getDb, passages } from "@dental-bot/db";
import { chunkLines, chunkPage, embeddingText } from "../retrieval/chunk.ts";
import { embed } from "../retrieval/embed.ts";
import { chunkKey } from "../retrieval/questions.ts";

export const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../seed");

export const PAGES = [
  { slug: "contact", title: "Opening hours and contact", navLabel: "Hours & contact", file: "contact.md" },
  { slug: "treatments", title: "Treatments and prices", navLabel: "Treatments & prices", file: "treatments.md" },
  { slug: "nhs-private-faq", title: "NHS and private FAQ", navLabel: "NHS & private FAQ", file: "nhs-private-faq.md" },
  { slug: "emergencies", title: "Emergencies", navLabel: "Emergencies", file: "emergencies.md" },
  { slug: "book", title: "Book an appointment", navLabel: "Book", file: "book.md" },
] as const;

export function readSeed(...parts: string[]): string {
  return readFileSync(path.join(seedDir, ...parts), "utf8").trim();
}

export function seedPages() {
  return PAGES.map((p) => ({ slug: p.slug, title: p.title, navLabel: p.navLabel, bodyMd: readSeed("content", p.file) }));
}

export function seedQuestions(): Record<string, string[]> {
  return JSON.parse(readSeed("content", "questions.json")) as Record<string, string[]>;
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
): Promise<number> {
  const db = getDb();
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
