import { callTool, streamText } from "../llm/anthropic.ts";
import { costUsd } from "../llm/pricing.ts";
import { plannerToolSchema } from "./commands.ts";
import { BOOKING_SLOTS, nextBookingStep } from "./flows/booking-request.ts";
import type { Bundle, ComposeResult, PlannerResult, ScoredChunk, TurnContext } from "./types.ts";

export function plannerSystemPrompt(bundle: Bundle): string {
  const procedures = bundle.procedures.map((p) => `## ${p.key}: ${p.title}\n${p.steps}`).join("\n\n");
  return [
    `You are the planning component of the website chat for ${bundle.practice.name}, a dental practice.`,
    "You never write messages to the visitor. You choose commands; a deterministic system executes them",
    "and writes the reply using only the practice website and fixed templates.",
    "",
    `# Guidance (version ${bundle.versionNumber})`,
    bundle.guidance,
    "",
    "# Procedures",
    procedures,
    "",
    "# Flow catalogue",
    `- booking_request: collects slots ${BOOKING_SLOTS.join(", ")} in that order. confirm is "yes" or "no".`,
    "- handover: passes the conversation to the practice team. Use the handover command, not start_flow.",
    "",
    "# Commands",
    "- answer_from_knowledge(query): the system searches the website and answers with a citation.",
    "- start_flow(flow), set_slot(slot, value), clarify(options), handover(reason), cannot_handle(reason).",
    "",
    "# Notes",
    "- Personal details appear as tokens such as ‹NAME_1› or ‹PHONE_1›. Copy tokens exactly into set_slot values.",
    "- Emit between 1 and 4 commands. Write search queries as standalone questions.",
  ].join("\n");
}

function plannerUserMessage(ctx: TurnContext): string {
  const history = ctx.history
    .slice(-12)
    .map((h) => `${h.role === "visitor" ? "Visitor" : h.role === "staff" ? "Practice team" : "Assistant"}: ${h.text}`)
    .join("\n");
  let state = "No flow is active.";
  if (ctx.flow?.name === "booking_request") {
    const step = ctx.flow.step === "change" ? "change (visitor wants to change a detail)" : nextBookingStep(ctx.flow);
    state = `Active flow: booking_request. Waiting for: ${step}. Slots so far: ${JSON.stringify(ctx.flow.slots)}.`;
  }
  return `${history ? `Conversation so far:\n${history}\n\n` : ""}${state}\n\nLatest visitor message:\n${ctx.visitorText ?? ""}`;
}

export async function livePlan(ctx: TurnContext): Promise<PlannerResult> {
  const model = ctx.bundle.config.chatModel;
  const t0 = Date.now();
  const { input, usage } = await callTool<{ commands: unknown }>({
    model,
    system: plannerSystemPrompt(ctx.bundle),
    messages: [{ role: "user", content: plannerUserMessage(ctx) }],
    tool: {
      name: "emit_commands",
      description: "Emit the commands for this turn.",
      input_schema: plannerToolSchema,
    },
  });
  return {
    commands: input.commands,
    call: {
      role: "planner",
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: costUsd(model, usage.inputTokens, usage.outputTokens),
      latencyMs: Date.now() - t0,
    },
  };
}

const COMPOSE_SYSTEM = (practiceName: string) =>
  [
    `You turn extracts from the ${practiceName} website into a short chat answer to one question.`,
    "Rules:",
    "- Use only facts stated in the extracts. Do not add anything else.",
    "- End every sentence with the number of the extract it comes from, like [1] or [1][2].",
    "- Copy prices, times, numbers and phone numbers exactly. Keep qualifiers such as \"from\".",
    "- Never give advice about symptoms, treatment choices or medicines.",
    "- At most three short sentences, plain British English, speaking as \"we\".",
    "- If the extracts do not answer the question, reply with exactly NO_ANSWER.",
  ].join("\n");

export function composeUserMessage(query: string, chunks: ScoredChunk[]): string {
  const extracts = chunks.map((c, i) => `[${i + 1}] ${c.page} › ${c.heading}\n${c.text}`).join("\n\n");
  return `Question: ${query}\n\nExtracts:\n${extracts}`;
}

export function liveCompose(query: string, chunks: ScoredChunk[], bundle: Bundle): ComposeResult {
  const model = bundle.config.chatModel;
  const t0 = Date.now();
  const { stream, done } = streamText({
    model,
    system: COMPOSE_SYSTEM(bundle.practice.name),
    messages: [{ role: "user", content: composeUserMessage(query, chunks) }],
  });
  return {
    stream,
    done: done.then((usage) => ({
      role: "compose" as const,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: costUsd(model, usage.inputTokens, usage.outputTokens),
      latencyMs: Date.now() - t0,
    })),
  };
}
