export type PageInput = { slug: string; title: string; bodyMd: string };

export type ChunkInput = { pageSlug: string; pageTitle: string; heading: string; anchor: string; text: string };

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function tableToLines(rows: string[]): string[] {
  const cells = rows.map((r) =>
    r
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim()),
  );
  const [header, , ...body] = cells;
  if (!header) return [];
  return body.map((row) => {
    if (row.length === 2) return `${row[0]}: ${row[1]} (${header[1]!.toLowerCase()})`.replace(" (hours)", "");
    const [first, ...rest] = row;
    return `${first}: ${rest.map((c, i) => `${header[i + 1]!.toLowerCase()} ${c}`).join("; ")}`;
  });
}

function plain(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim().startsWith("|")) {
      const block: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) block.push(lines[i++]!);
      i--;
      out.push(...tableToLines(block));
    } else {
      out.push(lines[i]!.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[(.+?)\]\(.+?\)/g, "$1"));
    }
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** One chunk per H2 section, plus the introduction. Sections on these pages are short. */
export function chunkPage(page: PageInput): ChunkInput[] {
  const parts = page.bodyMd.split(/^## /m);
  const chunks: ChunkInput[] = [];
  const intro = parts[0]!.trim();
  if (intro) {
    chunks.push({ pageSlug: page.slug, pageTitle: page.title, heading: page.title, anchor: "top", text: plain(intro) });
  }
  for (const part of parts.slice(1)) {
    const [headingLine, ...rest] = part.split("\n");
    const heading = headingLine!.trim();
    const text = plain(rest.join("\n"));
    if (!text) continue;
    chunks.push({ pageSlug: page.slug, pageTitle: page.title, heading, anchor: slugify(heading), text });
  }
  return chunks;
}

export function embeddingText(c: Pick<ChunkInput, "pageTitle" | "heading" | "text">): string {
  return `${c.pageTitle} — ${c.heading}\n${c.text}`;
}

/** The heading on its own plus each sentence, list item or table row, prefixed with the heading. */
export function chunkLines(c: ChunkInput): string[] {
  const lines = [`${c.pageTitle} — ${c.heading}`];
  for (const raw of c.text.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)) {
    const line = raw.replace(/^[-*]\s*/, "").trim();
    if (line.length > 5) lines.push(`${c.heading}: ${line}`);
  }
  return lines;
}
