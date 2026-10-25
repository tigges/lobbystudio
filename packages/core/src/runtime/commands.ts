import { z } from "zod";

export const FLOW_NAMES = ["booking_request", "handover"] as const;
export type FlowName = (typeof FLOW_NAMES)[number];

export const HANDOVER_REASONS = [
  "emergency",
  "pain_or_symptoms",
  "clinical_advice",
  "complaint",
  "patient_record",
  "visitor_request",
  "other",
] as const;
export type HandoverReason = (typeof HANDOVER_REASONS)[number];

export const CANNOT_HANDLE_REASONS = ["out_of_scope", "unsupported_request", "abusive"] as const;

export const answerFromKnowledge = z.object({
  cmd: z.literal("answer_from_knowledge"),
  query: z.string().trim().min(2).max(300),
});

export const startFlow = z.object({
  cmd: z.literal("start_flow"),
  flow: z.enum(FLOW_NAMES),
});

export const setSlot = z.object({
  cmd: z.literal("set_slot"),
  slot: z.string().trim().min(1).max(40),
  value: z.string().trim().min(1).max(200),
});

export const clarify = z.object({
  cmd: z.literal("clarify"),
  options: z.array(z.string().trim().min(2).max(60)).min(2).max(3),
});

export const handover = z.object({
  cmd: z.literal("handover"),
  reason: z.enum(HANDOVER_REASONS),
});

export const cannotHandle = z.object({
  cmd: z.literal("cannot_handle"),
  reason: z.enum(CANNOT_HANDLE_REASONS),
});

export const command = z.discriminatedUnion("cmd", [
  answerFromKnowledge,
  startFlow,
  setSlot,
  clarify,
  handover,
  cannotHandle,
]);

export type Command = z.infer<typeof command>;
export type CommandName = Command["cmd"];

export const MAX_COMMANDS_PER_TURN = 4;

/** JSON schema handed to the planner model as its only tool. Validation happens again with zod. */
export const plannerToolSchema = {
  type: "object",
  properties: {
    commands: {
      type: "array",
      maxItems: MAX_COMMANDS_PER_TURN,
      items: {
        type: "object",
        properties: {
          cmd: {
            type: "string",
            enum: ["answer_from_knowledge", "start_flow", "set_slot", "clarify", "handover", "cannot_handle"],
          },
          query: { type: "string", description: "answer_from_knowledge: a self-contained search query" },
          flow: { type: "string", enum: [...FLOW_NAMES], description: "start_flow" },
          slot: { type: "string", description: "set_slot: slot name from the active flow" },
          value: { type: "string", description: "set_slot: the visitor's value, copying tokens exactly" },
          options: {
            type: "array",
            items: { type: "string" },
            description: "clarify: 2-3 short options, no prices or numbers",
          },
          reason: {
            type: "string",
            enum: [...HANDOVER_REASONS, ...CANNOT_HANDLE_REASONS],
            description: "handover or cannot_handle reason",
          },
        },
        required: ["cmd"],
      },
    },
  },
  required: ["commands"],
} as const;

export function parseCommands(raw: unknown): { valid: Command[]; rejected: { raw: unknown; error: string }[] } {
  const list = Array.isArray(raw) ? raw : [];
  const valid: Command[] = [];
  const rejected: { raw: unknown; error: string }[] = [];
  for (const item of list.slice(0, MAX_COMMANDS_PER_TURN)) {
    const parsed = command.safeParse(stripNulls(item));
    if (parsed.success) valid.push(parsed.data);
    else rejected.push({ raw: item, error: parsed.error.issues.map((i) => i.message).join("; ") });
  }
  for (const item of list.slice(MAX_COMMANDS_PER_TURN)) {
    rejected.push({ raw: item, error: "over the per-turn command limit" });
  }
  return { valid, rejected };
}

function stripNulls(item: unknown): unknown {
  if (!item || typeof item !== "object") return item;
  return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== null && v !== undefined && v !== ""));
}
