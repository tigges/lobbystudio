import type { BookingConfig } from "@dental-bot/db";
import type { Synonym } from "./packs/synonyms.ts";
import type { Vertical } from "./packs/types.ts";

export type SeedPage = { slug: string; title: string; navLabel: string; file: string };

/** A member of staff the demo diary can book; `level` matches the stylist levels the salon chat asks about. */
export type DiaryStaff = { id: string; name: string; level: string };

/** Opening hours by weekday (0 = Sunday) as [open, close] in 24h hours; missing days are closed. */
export type DiaryHours = Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, [number, number]>>;

export type Business = {
  id: string;
  name: string;
  phone: string;
  vertical: Vertical;
  booking: BookingConfig;
  /** Folder under `packages/core/seed` holding `content/` and `behaviour/`. */
  dir: string;
  pages: SeedPage[];
  retrievalThreshold: number;
  /** This business's own words for things, on top of its pack's, e.g. a local landmark. */
  synonyms?: Synonym[];
  diary?: { staff: DiaryStaff[]; hours: DiaryHours; minutes: Record<string, number> };
};

export const HARBOUR_DENTAL: Business = {
  id: "harbour-dental",
  name: "Harbour Dental",
  phone: "020 7946 0321",
  vertical: "dental",
  booking: { mode: "callback" },
  dir: "harbour-dental",
  pages: [
    { slug: "contact", title: "Opening hours and contact", navLabel: "Hours & contact", file: "contact.md" },
    { slug: "treatments", title: "Treatments and prices", navLabel: "Treatments & prices", file: "treatments.md" },
    { slug: "nhs-private-faq", title: "NHS and private FAQ", navLabel: "NHS & private FAQ", file: "nhs-private-faq.md" },
    { slug: "emergencies", title: "Emergencies", navLabel: "Emergencies", file: "emergencies.md" },
    { slug: "book", title: "Book an appointment", navLabel: "Book", file: "book.md" },
  ],
  retrievalThreshold: 0.68,
};

/** Fictional salon, loosely modelled on a Japanese-run London salon that books through Phorest. */
export const MIKAN_HAIR: Business = {
  id: "mikan-hair",
  name: "Mikan Hair Studio",
  phone: "020 7946 0588",
  vertical: "salon",
  booking: { mode: "online", system: "phorest" },
  dir: "mikan-hair",
  pages: [
    { slug: "contact", title: "Opening hours and contact", navLabel: "Hours & contact", file: "contact.md" },
    { slug: "prices", title: "Services and prices", navLabel: "Services & prices", file: "prices.md" },
    { slug: "patch-tests", title: "Patch tests and aftercare", navLabel: "Patch tests", file: "patch-tests.md" },
    { slug: "faq", title: "Frequently asked questions", navLabel: "FAQ", file: "faq.md" },
    { slug: "offers", title: "Offers", navLabel: "Offers", file: "offers.md" },
    { slug: "book", title: "Book an appointment", navLabel: "Book", file: "book.md" },
  ],
  retrievalThreshold: 0.74,
  diary: {
    staff: [
      { id: "st-aiko", name: "Aiko", level: "Creative director" },
      { id: "st-hana", name: "Hana", level: "Senior stylist" },
      { id: "st-sam", name: "Sam", level: "Senior stylist" },
      { id: "st-leo", name: "Leo", level: "Stylist" },
      { id: "st-mei", name: "Mei", level: "Stylist" },
      { id: "st-ella", name: "Ella", level: "Graduate stylist" },
    ],
    hours: { 2: [10, 20], 3: [10, 20], 4: [10, 20], 5: [10, 20], 6: [9, 18] },
    minutes: { cut: 60, colour: 120, highlights: 180, treatment: 90, blowdry: 45 },
  },
};

export const BUSINESSES: Business[] = [HARBOUR_DENTAL, MIKAN_HAIR];

export function businessById(id: string): Business | undefined {
  return BUSINESSES.find((b) => b.id === id);
}
