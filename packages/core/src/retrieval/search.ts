import { getPool } from "@dental-bot/db";
import type { Bundle, ScoredChunk } from "../runtime/types.ts";
import { embed } from "./embed.ts";

/** Weight of the normalised keyword rank added to the semantic score. Calibrated with `calibrate.ts`. */
export const KEYWORD_WEIGHT = 0.1;

/**
 * Hybrid search over one content version. A chunk's semantic score is the best cosine
 * similarity of the chunk or any of its lines; any-term keyword rank adds a small bonus.
 * The relevancy threshold applies to `score`.
 */
export async function searchChunks(query: string, bundle: Bundle, limit = 6): Promise<ScoredChunk[]> {
  const [vec] = await embed([query], "query");
  const { rows } = await getPool().query<{
    id: string;
    page_title: string;
    page_slug: string;
    heading: string;
    anchor: string;
    text: string;
    semantic: number;
    kw: number;
  }>(
    `WITH q AS (
       SELECT $1::vector AS v,
              NULLIF(replace(plainto_tsquery('english', $2)::text, '&', '|'), '')::tsquery AS tq
     ),
     line_scores AS (
       SELECT p.chunk_id, max(1 - (p.embedding <=> q.v)) AS line_score
         FROM passages p, q
        WHERE p.tenant_id = $3 AND p.content_version_id = $4
        GROUP BY p.chunk_id
     )
     SELECT c.id, c.page_title, c.page_slug, c.heading, c.anchor, c.text,
            greatest(coalesce(ls.line_score, 0), 1 - (c.embedding <=> q.v)) AS semantic,
            coalesce(ts_rank_cd(c.tsv, q.tq, 32), 0) AS kw
       FROM chunks c
       CROSS JOIN q
       LEFT JOIN line_scores ls ON ls.chunk_id = c.id
      WHERE c.tenant_id = $3 AND c.content_version_id = $4`,
    [`[${vec!.join(",")}]`, query, bundle.tenantId, bundle.contentVersionId],
  );
  return rows
    .map((r) => ({
      chunkId: Number(r.id),
      page: r.page_title,
      slug: r.page_slug,
      heading: r.heading,
      anchor: r.anchor,
      text: r.text,
      score: Number(r.semantic) + KEYWORD_WEIGHT * Number(r.kw),
      keywordScore: Number(r.kw),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
