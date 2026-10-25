import { type BookingDef, commonSlot, needsPartOfDay, SLOT_STEP, type SlotResult, TIME_OF_DAY_OPTIONS, timeSummary } from "./booking.ts";

/** Salon booking: qualified in the chat, then booked into the salon's diary or passed on as a call-back request. */
export const SALON_SLOTS = [
  "service",
  "length",
  "stylist",
  "patch_test",
  "preferred_time",
  "time_of_day",
  SLOT_STEP,
  "name",
  "phone",
  "confirm",
] as const;

/** Services that use colour, so the salon needs a patch test at least 48 hours before. */
export const COLOUR_SERVICE = /\b(colou?r\w*|roots?|tint\w*|highlights?|balayage|foil\w*|ombr[eé]|toner|gloss|bleach\w*|lighten\w*|blonde)\b/i;
/** Services priced by hair length. */
const LENGTH_PRICED = /\b(colou?r\w*|roots?|tint\w*|highlights?|balayage|foil\w*|ombr[eé]|bleach\w*|lighten\w*|blonde|smooth\w*|keratin|brazilian|treatments?)\b/i;

const NOT_A_NAME =
  /\b(cut|trim|style|colou?r|highlights?|balayage|blow-?dry|treatment|smoothing|appointment|book\w*|stylist|senior|graduate|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|yes|no|hi|hello|thanks?)\b/i;

const STYLIST_LEVELS: [RegExp, string][] = [
  [/\b(creative|director)\b/i, "Creative director"],
  [/\bsenior\b/i, "Senior stylist"],
  [/\b(graduate|junior|trainee)\b/i, "Graduate stylist"],
  [/\b(no preference|any(one|body)?|whoever|don'?t mind|first available|no one in particular)\b/i, "No preference"],
  [/\bstylist\b/i, "Stylist"],
];

export function validateSalonSlot(slot: string, value: string): SlotResult {
  const v = value.trim();
  switch (slot) {
    case "service":
      return v.length >= 2 && v.length <= 80 ? { ok: true, value: v } : { ok: false, error: "service length" };
    case "length":
      if (/\b(below (?:the )?chest|very long|extra long|waist|hip)\b/i.test(v)) return { ok: true, value: "below chest" };
      if (/\b(short|pixie|crop\w*|above (?:the )?(?:ears?|chin))\b/i.test(v)) return { ok: true, value: "short" };
      if (/\b(shoulder|medium|mid|bob|collarbone|chin)\b/i.test(v)) return { ok: true, value: "shoulder length" };
      if (/\blong\b/i.test(v)) return { ok: true, value: "long" };
      return { ok: false, error: "short, shoulder length, long or below chest" };
    case "stylist": {
      for (const [pattern, level] of STYLIST_LEVELS) if (pattern.test(v)) return { ok: true, value: level };
      // A stylist asked for by name; the booking system matches it to the diary.
      const name = /^(?:with\s+)?([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)(?:,?\s+please)?[.!]?$/.exec(v);
      return name ? { ok: true, value: name[1]! } : { ok: false, error: "a stylist level or a name" };
    }
    case "patch_test":
      if (/\b(no|not|never|need|new|first|haven'?t|don'?t think)\b/i.test(v)) return { ok: true, value: "needed" };
      if (/\b(yes|yeah|yep|had|done|recent\w*|last (?:few )?(?:weeks?|months?))\b/i.test(v)) return { ok: true, value: "done" };
      return { ok: false, error: "had one recently or needs one" };
    default:
      return commonSlot(slot, v, NOT_A_NAME);
  }
}

export function stylistPhrase(stylist: string | undefined) {
  if (!stylist || stylist === "No preference") return "with whoever's free first";
  if (/stylist|director/i.test(stylist)) return `with ${/^[aeiou]/i.test(stylist) ? "an" : "a"} ${stylist.toLowerCase()}`;
  return `with ${stylist}`;
}

function serviceText(slots: Record<string, string>) {
  return [slots.service, slots.length && `${slots.length} hair`].filter(Boolean).join(", ");
}

export const PATCH_NOTE = "You'll need a patch test at least 48 hours before; it takes five minutes and you can just walk in.";

export const SALON_BOOKING: BookingDef = {
  slots: SALON_SLOTS,
  titles: {
    service: "Service",
    length: "Hair length",
    stylist: "Stylist",
    patch_test: "Patch test",
    preferred_time: "When",
    time_of_day: "Time of day",
    [SLOT_STEP]: "Time",
    name: "Name",
    phone: "Phone",
    confirm: "Confirm",
  },
  prompts: {
    service: "Lovely. What would you like to book? Pick one below or tell me in your own words.",
    length: "How long is your hair at the moment? It helps us book enough time.",
    stylist: "Would you like a senior stylist, a stylist or a graduate stylist? Prices differ by level, or you can ask for someone by name.",
    patch_test: "Colour needs a patch test at least 48 hours before. Have you had one with us in the last 6 months?",
    preferred_time: "Which days or times usually suit you?",
    time_of_day: "And is morning, afternoon or evening best?",
    name: "Thanks. What name should the booking be under?",
    phone: "And the best mobile number for the booking?",
  },
  options: {
    service: ["Cut & style", "Colour", "Highlights or balayage", "Treatment"],
    length: ["Short", "Shoulder length", "Long", "Below chest"],
    stylist: ["Senior stylist", "Stylist", "Graduate stylist", "No preference"],
    patch_test: ["Yes, in the last 6 months", "No, I need one"],
    time_of_day: TIME_OF_DAY_OPTIONS,
    confirm: ["Yes, please", "Change something"],
  },
  exactOnly: ["service"],
  conditional: {
    length: (s) => LENGTH_PRICED.test(s.service ?? ""),
    patch_test: (s) => COLOUR_SERVICE.test(s.service ?? ""),
    time_of_day: needsPartOfDay,
    [SLOT_STEP]: (_s, ctx) => ctx.online,
  },
  dependents: {
    service: ["length", "patch_test", SLOT_STEP, "slot_id", "slot_start", "offered"],
    length: [SLOT_STEP, "slot_id", "slot_start", "offered"],
    stylist: [SLOT_STEP, "slot_id", "slot_start", "offered"],
    patch_test: [SLOT_STEP, "slot_id", "slot_start", "offered"],
    preferred_time: ["time_of_day", SLOT_STEP, "slot_id", "slot_start", "offered"],
    time_of_day: [SLOT_STEP, "slot_id", "slot_start", "offered"],
  },
  validate: validateSalonSlot,
  invalid: {
    length: "Sorry, is your hair short, shoulder length, long or below the chest?",
    stylist: "Sorry, would you like a senior stylist, a stylist, a graduate stylist, or anyone who's free?",
    patch_test: "Sorry, have you had a patch test with us in the last 6 months?",
    phone: "That doesn't look like a UK phone number. Could you check it? For example 07700 900123.",
    name: "Sorry, I didn't catch your name. What should the booking be under?",
    confirm: "Shall I go ahead? Please answer yes or no.",
  },
  contextQuery: {},
  summary(slots) {
    const when = slots.slot_id ? `on ${slots.slot}` : `best time ${timeSummary(slots)}`;
    const patch = slots.patch_test === "needed" ? ` ${PATCH_NOTE}` : "";
    return (
      `Here's what I have: ${serviceText(slots)} ${stylistPhrase(slots.stylist)}, ${when}, for ${slots.name} on ${slots.phone}.${patch} ` +
      `Shall I ${slots.slot_id ? "book this in" : "send this to the team"}?`
    );
  },
  done: (slots) =>
    `Done. The team will call you on ${slots.phone} to find a time${slots.patch_test === "needed" ? " and book your patch test" : ""}, ` +
    `usually the same working day. Is there anything else I can help with before your visit?`,
  changePrompt:
    "No problem. Which detail would you like to change: the service, hair length, stylist, patch test, preferred times, your name or your number?",
  timeNote: "I can't promise a time from the chat. Once I know what you'd like, I'll show you the free times, or the team can call you to find one.",
  ready: "Your booking is ready. Shall I go ahead?",
  continue: "Let's carry on with your booking.",
  columns: [
    { title: "Service", value: (s) => (s.service ? serviceText(s) : null) },
    { title: "Stylist", value: (s) => s.stylist ?? null },
    { title: "Patch test", value: (s) => (s.patch_test ? (s.patch_test === "needed" ? "needed" : "had one") : null) },
    { title: "Time", value: (s) => (s.slot_id ? s.slot! : s.preferred_time ? timeSummary(s) : null) },
  ],
  plannerNotes: [
    `- booking_request: collects slots ${SALON_SLOTS.join(", ")} in that order. service is the visitor's words, e.g. "Balayage"; confirm is "yes" or "no".`,
    `  length ("short", "shoulder length", "long" or "below chest") is only asked for colour and treatments; stylist is a level ("Senior stylist", "Stylist", "Graduate stylist", "Creative director", "No preference") or a stylist's first name;`,
    `  patch_test ("done" or "needed") only for colour; time_of_day only when preferred_time names no part of the day; slot is one of the times offered, or "none".`,
  ].join("\n"),
  changeSlot: (text) =>
    /phone|number|mobile/i.test(text)
      ? "phone"
      : /name/i.test(text)
        ? "name"
        : /stylist|senior|graduate|director/i.test(text)
          ? "stylist"
          : /length|long|short/i.test(text)
            ? "length"
            : /patch/i.test(text)
              ? "patch_test"
              : /time|day/i.test(text)
                ? "preferred_time"
                : "service",
  firstValueFrom(text) {
    if (/balayage/i.test(text)) return "Balayage";
    if (/highlight|foil/i.test(text)) return "Highlights";
    if (/colou?r|roots|tint/i.test(text)) return "Colour";
    if (/blow-?dry/i.test(text)) return "Blow-dry";
    if (/smoothing|keratin|brazilian/i.test(text)) return "Smoothing treatment";
    if (/\b(cut|trim|haircut)\b/i.test(text)) return "Cut & style";
    return null;
  },
};
