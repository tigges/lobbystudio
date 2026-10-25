export type PiiKind = "NAME" | "PHONE" | "EMAIL" | "NHS_NUMBER" | "DATE" | "POSTCODE" | "CARD";

export type PiiMatch = { kind: PiiKind; value: string; start: number; end: number };

export const TOKEN_RE = /‹([A-Z_]+)_(\d+)›/g;

export function tokenKind(value: string): PiiKind | null {
  const m = /^‹([A-Z_]+)_\d+›$/.exec(value.trim());
  return m ? (m[1] as PiiKind) : null;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const PHONE = /(?<![\d])(?:\+44\s?\(?0?\)?\s?|0)(?:\d[\s-]?){9,10}(?![\d])/g;
const NHS = /\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/g;
const DATE = /\b\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})\b/g;
const POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi;
const NAME_INTRO =
  /\b(?:[Mm]y name is|[Mm]y name's|[Nn]ame is|[Nn]ame's|I am|[Ii]'m|[Ii]m|[Tt]his is|[Cc]all me|[Ii]t's|[Ii]ts)\s+((?:[A-Z][\p{L}'-]+)(?:\s+[A-Z][\p{L}'-]+){0,2})/gu;

const NOT_NAMES = new Set([
  "I",
  "Interested",
  "Looking",
  "Not",
  "Just",
  "Here",
  "Fine",
  "Ok",
  "Okay",
  "Sorry",
  "Happy",
  "Free",
  "Available",
  "New",
  "NHS",
  "Private",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
  "Morning",
  "Afternoon",
  "Evening",
  "Harbour",
]);

export function isPhoneLike(value: string): boolean {
  const digits = value.replace(/[^\d+]/g, "");
  return /^(?:\+44|0)\d{9,10}$/.test(digits.replace(/^\+440/, "+44"));
}

export function isValidNhsNumber(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 10) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
  const check = 11 - (sum % 11);
  const expected = check === 11 ? 0 : check;
  return expected !== 10 && expected === Number(digits[9]);
}

function luhn(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

function collect(re: RegExp, text: string, kind: PiiKind, accept?: (v: string) => boolean, group = 0): PiiMatch[] {
  const out: PiiMatch[] = [];
  for (const m of text.matchAll(re)) {
    const value = (m[group] ?? "").trim();
    if (!value || (accept && !accept(value))) continue;
    const start = (m.index ?? 0) + (group ? m[0].indexOf(value) : 0);
    out.push({ kind, value, start, end: start + value.length });
  }
  return out;
}

export type DetectOptions = {
  /** When a flow is waiting for the visitor's name, a short reply is treated as the name. */
  expectingName?: boolean;
};

/** Finds personal data. Overlaps are resolved in priority order: earlier kinds win. */
export function detectPii(text: string, opts: DetectOptions = {}): PiiMatch[] {
  const candidates: PiiMatch[] = [
    ...collect(EMAIL, text, "EMAIL"),
    ...collect(CARD, text, "CARD", luhn),
    ...collect(NHS, text, "NHS_NUMBER", isValidNhsNumber),
    ...collect(PHONE, text, "PHONE", isPhoneLike),
    ...collect(DATE, text, "DATE"),
    ...collect(POSTCODE, text, "POSTCODE"),
    ...collect(NAME_INTRO, text, "NAME", (v) => !NOT_NAMES.has(v.split(/\s+/)[0]!), 1),
  ];

  if (opts.expectingName) {
    const stripped = text
      .trim()
      .replace(/^(?:it's|its|i'm|im|i am|my name is|my name's|this is)\s+/i, "")
      .replace(/[.!]+$/, "")
      .trim();
    if (/^[\p{L}][\p{L}' -]{0,58}$/u.test(stripped) && stripped.split(/\s+/).length <= 4) {
      const start = text.indexOf(stripped);
      candidates.push({ kind: "NAME", value: stripped, start, end: start + stripped.length });
    }
  }

  const taken: PiiMatch[] = [];
  for (const c of candidates) {
    if (taken.some((t) => c.start < t.end && t.start < c.end)) continue;
    taken.push(c);
  }
  return taken.sort((a, b) => a.start - b.start);
}

export function normaliseValue(kind: PiiKind, value: string): string {
  if (kind === "PHONE" || kind === "NHS_NUMBER" || kind === "CARD") return value.replace(/[^\d+]/g, "");
  if (kind === "POSTCODE") return value.replace(/\s+/g, "").toUpperCase();
  return value.trim().toLowerCase();
}

export type TokenMap = Map<string, string>;

/**
 * Replaces personal data with stable per-conversation tokens such as ‹PHONE_1›.
 * `known` maps "KIND:normalised value" to an existing token so repeats reuse it.
 */
export function tokenise(
  text: string,
  known: TokenMap,
  opts: DetectOptions = {},
): { text: string; created: { token: string; kind: PiiKind; value: string; key: string }[] } {
  const matches = detectPii(text, opts);
  if (!matches.length) return { text, created: [] };

  const counters = new Map<string, number>();
  for (const token of known.values()) {
    const m = /^‹([A-Z_]+)_(\d+)›$/.exec(token);
    if (m) counters.set(m[1]!, Math.max(counters.get(m[1]!) ?? 0, Number(m[2])));
  }

  const created: { token: string; kind: PiiKind; value: string; key: string }[] = [];
  let out = "";
  let cursor = 0;
  for (const m of matches) {
    const key = `${m.kind}:${normaliseValue(m.kind, m.value)}`;
    let token = known.get(key);
    if (!token) {
      const n = (counters.get(m.kind) ?? 0) + 1;
      counters.set(m.kind, n);
      token = `‹${m.kind}_${n}›`;
      known.set(key, token);
      created.push({ token, kind: m.kind, value: m.value, key });
    }
    out += text.slice(cursor, m.start) + token;
    cursor = m.end;
  }
  out += text.slice(cursor);
  return { text: out, created };
}

export function detokenise(text: string, values: Map<string, string>): string {
  return text.replace(TOKEN_RE, (whole) => values.get(whole) ?? whole);
}
