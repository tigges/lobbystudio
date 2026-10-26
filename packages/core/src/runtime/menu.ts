import type { MenuItem, MenuMode, Pack } from "../packs/types.ts";
import type { Bundle, HistoryItem, Section } from "./types.ts";

/**
 * Pills built from the website's own sections, so they follow the site as it changes: a few first-level
 * topics per kind of business, then each page's headings, three at a time.
 */
export const MORE = "More…";
const PER_PAGE = 3;

/** "Fillings and root canal treatment" → "Fillings & root canal"; questions are kept as they are. */
export function pillLabel(heading: string): string {
  if (heading.endsWith("?")) return heading;
  const words = heading.replace(/\band\b/g, "&").split(/\s+/);
  if (words.length > 3 && /^treatments?$/i.test(words.at(-1)!)) words.pop();
  return words.join(" ");
}

export function pricesLabel(heading: string): string {
  return `${pillLabel(heading)} prices`;
}

export function otherLabel(item: MenuItem): string {
  return `Other ${item.label.toLowerCase()}`;
}

/** The sections of a page that may be pills, in page order: never safety sections or the pack's skipped ones. */
export function menuSections(pack: Pack, bundle: Bundle, slug: string): Section[] {
  const safety = slug === pack.handoverSources.slug ? [pack.handoverSources.urgent, pack.handoverSources.clinical] : [];
  return (bundle.sections ?? []).filter(
    (s) => s.slug === slug && !pack.menu.skip.test(s.heading) && !safety.some((re) => re.test(s.anchor)),
  );
}

/** Up to three pills from `from`, then "More…" when there are others. */
export function pillPage(labels: string[], from = 0): string[] {
  const page = labels.slice(from, from + PER_PAGE);
  return from + PER_PAGE < labels.length ? [...page, MORE] : page;
}

export function sectionPills(pack: Pack, bundle: Bundle, slug: string, from = 0): string[] {
  return pillPage(menuSections(pack, bundle, slug).map((s) => pillLabel(s.heading)), from);
}

export function startPills(pack: Pack): string[] {
  return pack.menu.start.map((i) => i.label);
}

/** The pills the chat opens with: the page's own sections, none on quiet pages, otherwise the first-level topics. */
export function openingPills(pack: Pack, bundle: Bundle, page: string | null | undefined): string[] {
  if (page && pack.menu.quiet.includes(page)) return [];
  if (page && menuSections(pack, bundle, page).length >= 2) return sectionPills(pack, bundle, page);
  return startPills(pack);
}

/** A price list section, e.g. "White filling: from £140", answered with what it covers rather than every price. */
export function isPriceList(section: Section): boolean {
  return section.text.split("\n").filter((l) => /^[^:£]{3,}:.*£/.test(l.trim())).length >= 2;
}

/** "Fillings and root canal treatment: white filling and root canal treatment." Prices and details left out. */
export function overview(section: Section): string {
  const items: string[] = [];
  const notes: string[] = [];
  for (const raw of section.text.split("\n")) {
    const line = raw.replace(/^[-*]\s*/, "").trim();
    const item = /^([^:£]{3,}):.*£/.exec(line)?.[1];
    if (item) {
      const name = item.replace(/\s*\([^)]*\)/g, "").split(",")[0]!.trim();
      const lower = name.charAt(0).toLowerCase() + name.slice(1);
      if (!items.includes(lower)) items.push(lower);
    } else if (line && !/[£\d:]/.test(line) && notes.length === 0) {
      notes.push(line.split(/(?<=\.)\s+(?=[A-Z])/)[0]!);
    }
  }
  return [`${section.heading}: ${listOf(items)}.`, ...notes].join(" ");
}

/** The first two sentences or lines of a section, for when it can't be summarised another way. */
export function opening(section: Section): string {
  const parts = section.text
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .flatMap((l) => l.split(/(?<=\.)\s+(?=[A-Z])/));
  return parts
    .slice(0, 2)
    .map((p) => (/[.!?]$/.test(p) ? p : `${p}.`))
    .join(" ");
}

function listOf(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** NHS, private or not sure, from a pill or a typed answer. */
export function careAnswer(text: string): "NHS" | "private" | "not sure" | null {
  if (/\bnhs\b/i.test(text)) return "NHS";
  if (/\bprivate(?:ly)?\b/i.test(text)) return "private";
  if (/\b(?:not sure|unsure|don'?t know|no idea|either|both)\b/i.test(text)) return "not sure";
  return null;
}

export const ASKS_PRICE = /\b(?:how much|costs?|costing|prices?|priced|charges?|fees?|expensive|cheap)\b/i;

/** What a tap on a pill from the bot's latest message means; null when the text isn't one of its pills. */
export type Tap =
  | { kind: "start"; item: MenuItem }
  | { kind: "section"; section: Section; mode: MenuMode }
  | { kind: "prices"; section: Section }
  | { kind: "more"; slug: string; from: number; mode: MenuMode }
  | { kind: "other"; item: MenuItem & { sections: { page: string; mode: MenuMode } } };

export function readTap(pack: Pack, bundle: Bundle, text: string, lastBot: HistoryItem | undefined, page: string | null | undefined): Tap | null {
  const t = text.trim().toLowerCase();
  const start = pack.menu.start.find((i) => i.label.toLowerCase() === t);
  if (start) return { kind: "start", item: start };
  const offered = lastBot?.options ?? [];
  if (!offered.some((o) => o.toLowerCase() === t)) return null;
  const sections = bundle.sections ?? [];
  const mode: MenuMode =
    lastBot?.text === pack.price.lead || (lastBot?.kind === "greeting" && page && pack.menu.pages[page] === "prices") ? "prices" : "overview";

  if (t === MORE.toLowerCase()) {
    const shown = offered.filter((o) => o !== MORE);
    for (const slug of new Set(sections.map((s) => s.slug))) {
      const labels = menuSections(pack, bundle, slug).map((s) => pillLabel(s.heading));
      const at = labels.indexOf(shown.at(-1) ?? "");
      if (at >= 0 && shown.every((o) => labels.includes(o))) return { kind: "more", slug, from: at + 1, mode };
    }
    return null;
  }
  const other = pack.menu.start.find((i) => "sections" in i && otherLabel(i).toLowerCase() === t);
  if (other && "sections" in other) return { kind: "other", item: other };
  const priced = sections.find((s) => pricesLabel(s.heading).toLowerCase() === t);
  if (priced) return { kind: "prices", section: priced };
  const section = sections.find((s) => !s.heading.endsWith("?") && pillLabel(s.heading).toLowerCase() === t);
  return section ? { kind: "section", section, mode } : null;
}

/** The first-level item whose pills list this page, so an overview can offer the others. */
export function itemFor(pack: Pack, slug: string) {
  return pack.menu.start.find((i): i is MenuItem & { sections: { page: string; mode: MenuMode } } => "sections" in i && i.sections.page === slug);
}
