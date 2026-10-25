const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
type Day = (typeof DAYS)[number];
export type WeeklyHours = Partial<Record<Day, { open: number; close: number } | null>>;

/** "Are you open now?", "still open today?", "what time do you close tonight?" */
export const OPEN_NOW =
  /\b(?:open|closed?|closing)\b.*\b(?:now|right now|at the moment|currently|today|tonight|still)\b|\b(?:now|right now|at the moment|currently|today|tonight|still)\b.*\b(?:open|closed?|closing)\b/i;

function minutes(t: string): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(t.trim());
  if (!m) return null;
  const h = (Number(m[1]) % 12) + (m[3]!.toLowerCase() === "pm" ? 12 : 0);
  return h * 60 + Number(m[2] ?? 0);
}

/** Reads lines such as "| Monday | 8am to 6pm |" or "Sunday: Closed" from the published opening hours. */
export function parseHours(text: string): WeeklyHours {
  const hours: WeeklyHours = {};
  for (const day of DAYS) {
    const m = new RegExp(`\\b${day}\\b[\\s|:]*([^|\\n]+)`, "i").exec(text);
    if (!m) continue;
    const value = m[1]!.trim();
    if (/^closed/i.test(value)) {
      hours[day] = null;
      continue;
    }
    const range = /(\d{1,2}(?::\d{2})?\s*[ap]m)\s*(?:to|-|–)\s*(\d{1,2}(?::\d{2})?\s*[ap]m)/i.exec(value);
    const open = range ? minutes(range[1]!) : null;
    const close = range ? minutes(range[2]!) : null;
    if (open !== null && close !== null) hours[day] = { open, close };
  }
  return hours;
}

function clock(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
}

export function localTime(now: Date, timeZone: string): { day: Day; mins: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: get("weekday") as Day, mins: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** A one-sentence answer, or null when the published hours don't cover enough days to say. */
export function openNowAnswer(hours: WeeklyHours, now: Date, timeZone: string): string | null {
  if (Object.keys(hours).length < 5) return null;
  const { day, mins } = localTime(now, timeZone);
  const today = hours[day];
  if (today && mins >= today.open && mins < today.close) return `Yes, we're open now until ${clock(today.close)} today.`;
  if (today && mins < today.open) return `We're closed right now. We open today at ${clock(today.open)}.`;
  for (let i = 1; i <= 7; i++) {
    const next = DAYS[(DAYS.indexOf(day) + i) % 7]!;
    const h = hours[next];
    if (h) return `We're closed right now. We open again ${i === 1 ? "tomorrow" : `on ${next}`} at ${clock(h.open)}.`;
  }
  return null;
}
