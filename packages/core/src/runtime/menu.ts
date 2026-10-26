import type { MenuItem, MenuMode, Pack } from "../packs/types.ts";
import { BOOK_PILL } from "./templates.ts";
import type { Bundle, HistoryItem, Section } from "./types.ts";

/**
 * Pills built from the website's own sections, so they follow the site as it changes: a few first-level
 * topics per kind of business, then each page's headings. Every pill is the next best step for what we
 * know, and a reply never offers more than three, counting Book and "More…".
 */
export const MORE = "More…";
export const MAX_PILLS = 3;

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

export type PageTopic = Extract<MenuItem, { page: string }>;
export type SectionTopic = Extract<MenuItem, { heading: string }>;

export function otherLabel(item: PageTopic): string {
  return `Other ${item.label.toLowerCase()}`;
}

/** The sections of a page that may be pills, in page order: never safety sections or the pack's skipped ones. */
export function menuSections(pack: Pack, bundle: Bundle, slug: string): Section[] {
  const safety = slug === pack.handoverSources.slug ? [pack.handoverSources.urgent, pack.handoverSources.clinical] : [];
  return (bundle.sections ?? []).filter(
    (s) => s.slug === slug && !pack.menu.skip.test(s.heading) && !safety.some((re) => re.test(s.anchor)),
  );
}

/** The rest of a list from `from`: all of it when it fits in three pills, otherwise two and "More…". */
export function pillPage(labels: string[], from = 0): string[] {
  const rest = labels.slice(from);
  return rest.length <= MAX_PILLS ? rest : [...rest.slice(0, MAX_PILLS - 1), MORE];
}

export function sectionPills(pack: Pack, bundle: Bundle, slug: string, from = 0): string[] {
  return pillPage(menuSections(pack, bundle, slug).map((s) => pillLabel(s.heading)), from);
}

export function startPills(pack: Pack): string[] {
  return pack.menu.start.slice(0, MAX_PILLS);
}

/** After a section topic such as Hours: the other section topics, e.g. Find us, then Book. */
export function nextAfter(pack: Pack, label: string): string[] {
  const others = pack.menu.topics.filter((t): t is SectionTopic => "heading" in t && t.label !== label).map((t) => t.label);
  return [...others.slice(0, MAX_PILLS - 1), BOOK_PILL];
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

/** "Colour: root colour from £68, full head colour from £85 and toner or gloss from £35." Each service at its lowest price. */
export function priceSummary(section: Section): string {
  const items: string[] = [];
  for (const raw of section.text.split("\n")) {
    const m = /^([^:£]{3,}):(.*)$/.exec(raw.replace(/^[-*]\s*/, "").trim());
    const prices = m?.[2]!.match(/£[\d,]+(?:\.\d\d)?/g);
    if (!m || !prices) continue;
    const lowest = prices.reduce((a, b) => (Number(b.slice(1).replace(/,/g, "")) < Number(a.slice(1).replace(/,/g, "")) ? b : a));
    const from = prices.length > 1 || /\bfrom\b/i.test(m[2]!) ? "from " : "";
    const name = m[1]!.replace(/\s*\([^)]*\)/g, "").trim();
    items.push(`${name.charAt(0).toLowerCase()}${name.slice(1)} ${from}${lowest}`);
  }
  return `${section.heading}: ${listOf(items)}.`;
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
  | { kind: "topic"; item: MenuItem }
  | { kind: "section"; section: Section; mode: MenuMode }
  | { kind: "prices"; section: Section }
  | { kind: "more"; slug: string; from: number; mode: MenuMode }
  | { kind: "other"; item: PageTopic };

export function readTap(pack: Pack, bundle: Bundle, text: string, lastBot: HistoryItem | undefined): Tap | null {
  const t = text.trim().toLowerCase();
  const topic = pack.menu.topics.find((i) => i.label.toLowerCase() === t);
  if (topic) return { kind: "topic", item: topic };
  const offered = lastBot?.options ?? [];
  if (!offered.some((o) => o.toLowerCase() === t)) return null;
  const sections = bundle.sections ?? [];
  const modeOf = (slug: string): MenuMode => (lastBot?.text === pack.price.lead ? "prices" : (pack.menu.pages[slug] ?? "overview"));

  if (t === MORE.toLowerCase()) {
    const shown = offered.filter((o) => o !== MORE);
    for (const slug of new Set(sections.map((s) => s.slug))) {
      const labels = menuSections(pack, bundle, slug).map((s) => pillLabel(s.heading));
      const at = labels.indexOf(shown.at(-1) ?? "");
      if (at >= 0 && shown.every((o) => labels.includes(o))) return { kind: "more", slug, from: at + 1, mode: modeOf(slug) };
    }
    return null;
  }
  const other = pack.menu.topics.find((i): i is PageTopic => "page" in i && otherLabel(i).toLowerCase() === t);
  if (other) return { kind: "other", item: other };
  const priced = sections.find((s) => pricesLabel(s.heading).toLowerCase() === t);
  if (priced) return { kind: "prices", section: priced };
  const section = sections.find((s) => !s.heading.endsWith("?") && pillLabel(s.heading).toLowerCase() === t);
  return section ? { kind: "section", section, mode: modeOf(section.slug) } : null;
}

/** The topic whose pills list this page, so an answer from it can offer the others. */
export function itemFor(pack: Pack, slug: string): PageTopic | undefined {
  return pack.menu.topics.find((i): i is PageTopic => "page" in i && i.page === slug);
}
