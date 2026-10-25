const DAYS: [RegExp, number][] = [
  [/\bsun(day)?s?\b/i, 0],
  [/\bmon(day)?s?\b/i, 1],
  [/\btue(s|sday)?s?\b/i, 2],
  [/\bwed(nesday)?s?\b/i, 3],
  [/\bthu(rs|rsday)?s?\b/i, 4],
  [/\bfri(day)?s?\b/i, 5],
  [/\bsat(urday)?s?\b/i, 6],
];

/** Weekdays (0 = Sunday) the visitor's words ask for, or null when any day will do. */
export function wantedDays(text: string | null): Set<number> | null {
  if (!text) return null;
  const t = text.replace(/\s*\([^)]*\)/g, "");
  if (/\bweekends?\b/i.test(t)) return new Set([0, 6]);
  if (/\bweekdays?\b/i.test(t)) return new Set([1, 2, 3, 4, 5]);
  const days = new Set(DAYS.filter(([re]) => re.test(t)).map(([, d]) => d));
  return days.size ? days : null;
}

/** Hours of the day [from, to) the visitor's words ask for, or null when any time will do. */
export function wantedHours(text: string | null, partOfDay: string | null): [number, number] | null {
  const t = `${text ?? ""} ${partOfDay ?? ""}`;
  if (/\b(after work|evenings?)\b/i.test(t)) return [17, 24];
  if (/\b(before work|mornings?|am)\b/i.test(t)) return [0, 12];
  if (/\b(lunch\w*)\b/i.test(t)) return [12, 14];
  if (/\b(afternoons?|after school|pm)\b/i.test(t)) return [12, 17];
  return null;
}

/** Date parts of an instant in a time zone. */
export function localParts(d: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday!);
  return { weekday, hour: Number(parts.hour), minute: Number(parts.minute) };
}

/** "Sat 31 Oct, 10:30" in the business's time zone. */
export function slotLabel(d: Date, timeZone: string) {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${day}, ${time}`;
}
