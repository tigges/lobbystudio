/**
 * The compose step may only rephrase retrieved chunks. Every sentence must end with
 * citations like [1] or [1][2]; this module splits a streamed reply into such sentences.
 */

export type CitedSentence = { text: string; cites: number[] };

const TRAILING_CITES = /((?:\s*\[\d+\])+)\s*([.!?]?)\s*$/;

export function parseSentence(raw: string): CitedSentence {
  const trimmed = raw.trim();
  const m = TRAILING_CITES.exec(trimmed);
  if (!m) return { text: trimmed.replace(/\s*\[\d+\]/g, "").trim(), cites: [] };
  const cites = [...m[1]!.matchAll(/\[(\d+)\]/g)].map((c) => Number(c[1]));
  let text = trimmed.slice(0, m.index).replace(/\s*\[\d+\]/g, "").trim();
  if (m[2] && !/[.!?]$/.test(text)) text += m[2];
  if (!/[.!?]$/.test(text)) text += ".";
  return { text, cites: [...new Set(cites)] };
}

/**
 * Incrementally splits streamed text into sentences. A sentence ends after its citation
 * group (and optional punctuation) when followed by whitespace, or at end of stream.
 */
export class SentenceSplitter {
  private buffer = "";

  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    const boundary = /(?:\[\d+\])+[.!?]?(?=\s)/g;
    let last = 0;
    for (const m of this.buffer.matchAll(boundary)) {
      const end = (m.index ?? 0) + m[0].length;
      out.push(this.buffer.slice(last, end));
      last = end;
    }
    this.buffer = this.buffer.slice(last);
    return out.filter((s) => s.trim());
  }

  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest ? [rest] : [];
  }
}

export const NO_ANSWER = "NO_ANSWER";
