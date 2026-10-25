import type { Business, DiaryStaff } from "../businesses.ts";
import type { BookingSystem, OfferedSlot, SlotQuery } from "./types.ts";
import { localParts, slotLabel, wantedDays, wantedHours } from "./when.ts";

const STEP_MINUTES = 30;
const SEARCH_DAYS = 21;
const MAX_PER_DAY = 2;

/** Booked in this process, so a time isn't offered again after someone takes it. */
const taken = new Set<string>();

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export type ServiceKind = "highlights" | "colour" | "treatment" | "blowdry" | "cut";

/** The visitor's words for a service, as one of the services the diary knows how long to book. */
export function serviceKind(service: string): ServiceKind {
  if (/balayage|highlight|foil|bleach|blonde/i.test(service)) return "highlights";
  if (/colou?r|roots|tint|toner|gloss/i.test(service)) return "colour";
  if (/treatment|smooth|keratin|brazilian/i.test(service)) return "treatment";
  if (/blow-?dry/i.test(service)) return "blowdry";
  return "cut";
}

const DEFAULT_MINUTES: Record<ServiceKind, number> = { highlights: 180, colour: 120, treatment: 90, blowdry: 45, cut: 60 };

export function serviceMinutes(service: string, minutes: Record<string, number>) {
  const kind = serviceKind(service);
  return minutes[kind] ?? DEFAULT_MINUTES[kind];
}

export function staffFor(stylist: string | null, staff: DiaryStaff[]) {
  if (!stylist || stylist === "No preference") return staff;
  const byLevel = staff.filter((s) => s.level.toLowerCase() === stylist.toLowerCase());
  if (byLevel.length) return byLevel;
  const first = stylist.trim().split(/\s+/)[0]!.toLowerCase();
  return staff.filter((s) => s.name.toLowerCase() === first);
}

/**
 * A made-up diary for demos without booking-system credentials: the business's hours and staff, with
 * roughly half the times already taken. The same question always gets the same times.
 */
export function demoDiary(business: Business): BookingSystem {
  const diary = business.diary;
  if (!diary) throw new Error(`${business.id} has no diary`);
  return {
    name: "demo diary",
    async availability(q: SlotQuery): Promise<OfferedSlot[]> {
      const minutes = serviceMinutes(q.service, diary.minutes);
      const people = staffFor(q.stylist, diary.staff);
      const days = wantedDays(q.preferredTime);
      const hours = wantedHours(q.preferredTime, q.partOfDay);
      const step = STEP_MINUTES * 60_000;
      const out: OfferedSlot[] = [];
      const perDay = new Map<string, number>();
      let t = Math.ceil(q.earliest.getTime() / step) * step;
      const end = q.earliest.getTime() + SEARCH_DAYS * 86_400_000;
      for (; t < end && out.length < 3; t += step) {
        const start = new Date(t);
        const { weekday, hour, minute } = localParts(start, q.timeZone);
        const open = diary.hours[weekday as keyof typeof diary.hours];
        if (!open) continue;
        const from = hour + minute / 60;
        if (from < open[0] || from + minutes / 60 > open[1]) continue;
        if (days && !days.has(weekday)) continue;
        if (hours && (from < hours[0] || from >= hours[1])) continue;
        const day = start.toISOString().slice(0, 10);
        if ((perDay.get(day) ?? 0) >= MAX_PER_DAY) continue;
        const person = people.find((p) => {
          const id = `${p.id}@${start.toISOString()}`;
          return !taken.has(id) && hash(`${business.id}:${id}:${minutes}`) % 100 >= 55;
        });
        if (!person) continue;
        perDay.set(day, (perDay.get(day) ?? 0) + 1);
        out.push({
          id: `${person.id}@${start.toISOString()}`,
          start: start.toISOString(),
          staffId: person.id,
          staffName: person.name,
          label: `${slotLabel(start, q.timeZone)} with ${person.name}`,
        });
      }
      return out;
    },
    async book({ slot }) {
      if (taken.has(slot.id)) throw new Error("that time has just been taken");
      taken.add(slot.id);
      return { system: "demo diary", ref: `DEMO-${hash(slot.id).toString(36).slice(0, 5).toUpperCase()}` };
    },
  };
}
