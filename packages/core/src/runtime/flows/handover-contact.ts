import type { FlowState } from "@dental-bot/db/schema";
import { tokenKind } from "../../pii/detect.ts";
import { validateSlot } from "./booking-request.ts";

/**
 * After a handover the bot asks for these, so the team can always get back to the visitor.
 * Phone comes first: visitors often leave after one question, and a number alone is enough to call back.
 */
export const CONTACT_SLOTS = ["phone", "name"] as const;
export type ContactSlot = (typeof CONTACT_SLOTS)[number];

const PROMPTS: Record<ContactSlot, string> = {
  phone: "In case you leave the chat, what's the best phone number for the team to reach you on?",
  name: "Thanks. And your name, so the team knows who they're calling?",
};

const INVALID: Record<ContactSlot, string> = {
  name: "Sorry, I didn't catch your name. What should the team call you?",
  phone: "That doesn't look like a UK phone number. Could you check it? For example 07700 900123.",
};

const DECLINE = /^(?:no(?:pe)?|no thanks?(?: you)?|not now|rather not|i'?d rather not|skip|don'?t want to|prefer not(?: to)?)(?: say)?\b[ .!,]*$/i;

export const CONTACT_OPTIONS = ["I'd rather not say"];

/** Answers longer than this are treated as a message for the team rather than a reply to the prompt. */
const MAX_ANSWER_WORDS = 5;

/** Name and phone already known: from a booking in progress, or tokens the visitor typed in this message. */
export function knownContact(flow: FlowState | null, text: string): Record<string, string> {
  const known: Record<string, string> = {};
  if (flow?.name === "booking_request") {
    if (flow.slots.name) known.name = flow.slots.name;
    if (flow.slots.phone) known.phone = flow.slots.phone;
  }
  for (const token of text.match(/‹[A-Z]+_\d+›/g) ?? []) {
    const kind = tokenKind(token);
    if (kind === "NAME") known.name ??= token;
    if (kind === "PHONE") known.phone ??= token;
  }
  return known;
}

function nextStep(slots: Record<string, string>): ContactSlot | "waiting" {
  return CONTACT_SLOTS.find((s) => !slots[s]) ?? "waiting";
}

/** Details are asked for first when one question gives the team what they need to act, e.g. an invoice number. */
export function startContact(
  known: Record<string, string>,
  detailsPrompt: string | null = null,
): { flow: FlowState; prompt: string | null; options: string[] } {
  if (detailsPrompt) return { flow: { name: "handover", step: "details", slots: known }, prompt: detailsPrompt, options: [] };
  const step = nextStep(known);
  return { flow: { name: "handover", step, slots: known }, prompt: step === "waiting" ? null : PROMPTS[step], options: CONTACT_OPTIONS };
}

export function isCollectingContact(flow: FlowState | null): flow is FlowState {
  return flow?.name === "handover" && (flow.step === "details" || (CONTACT_SLOTS as readonly string[]).includes(flow.step));
}

const MAX_DETAILS = 400;

/**
 * One visitor message while contact details are being collected. Returns the reply (null to stay
 * quiet, e.g. when the message is for the team) and the new flow.
 */
export function collectContact(
  flow: FlowState,
  text: string,
): { flow: FlowState; reply: string | null; options: string[]; changed: boolean } {
  const t = text.trim();
  if (flow.step === "details") {
    const slots = DECLINE.test(t) ? flow.slots : { ...flow.slots, details: t.slice(0, MAX_DETAILS) };
    const next = nextStep(slots);
    const lead = "Thanks, I've added that for the team.";
    return {
      flow: { ...flow, step: next, slots },
      reply: next === "waiting" ? `${lead} They'll reply here soon.` : `${lead} ${PROMPTS[next]}`,
      options: next === "waiting" ? [] : CONTACT_OPTIONS,
      changed: true,
    };
  }
  const step = flow.step as ContactSlot;
  if (DECLINE.test(t)) {
    return { flow: { ...flow, step: "waiting" }, reply: "No problem. The team will reply here.", options: [], changed: false };
  }
  const known = knownContact(null, t);
  const v = known[step] ? { ok: true as const, value: known[step]! } : validateSlot(step, t);
  if (!v.ok) {
    if (t.split(/\s+/).length > MAX_ANSWER_WORDS) return { flow, reply: null, options: [], changed: false };
    return { flow, reply: INVALID[step], options: CONTACT_OPTIONS, changed: false };
  }
  const slots = { ...known, ...flow.slots, [step]: v.value };
  const next = nextStep(slots);
  const updated: FlowState = { ...flow, step: next, slots };
  if (next !== "waiting") return { flow: updated, reply: PROMPTS[next], options: CONTACT_OPTIONS, changed: true };
  return {
    flow: updated,
    reply: `Thanks, ${slots.name}. The team will reply here, or call you on ${slots.phone}.`,
    options: [],
    changed: true,
  };
}
