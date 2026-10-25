import { callTool, streamText } from "../llm/anthropic.ts";
import { costUsd } from "../llm/pricing.ts";
import { plannerToolSchema } from "./commands.ts";
import { packFor } from "../packs/index.ts";
import { nextBookingStep } from "./flows/booking.ts";
import type { Bundle, ComposeResult, PlannerResult, ScoredChunk, TurnContext } from "./types.ts";

export function plannerSystemPrompt(bundle: Bundle): string {
  const procedures = bundle.procedures.map((p) => `## ${p.key}: ${p.title}\n${p.steps}`).join("\n\n");
  const pack = packFor(bundle.vertical);
  return [
    `You are the planning component of the website chat for ${bundle.practice.name}, ${pack.kind}.`,
    "You never write messages to the visitor. You choose commands; a deterministic system executes them",
    `and writes the reply using only the ${pack.place} website and fixed templates.`,
    "",
    `# Guidance (version ${bundle.versionNumber})`,
    bundle.guidance,
    "",
    "# Procedures",
    procedures,
    "",
    "# Flow catalogue",
    pack.booking.plannerNotes,
    `- handover: passes the conversation to the ${pack.place} team. Use the handover command, not start_flow.`,
    "",
    "# Commands",
    "- answer_from_knowledge(query): the system searches the website and answers with a citation.",
    "- start_flow(flow), set_slot(slot, value), clarify(options), handover(reason), cannot_handle(reason).",
    "",
    "# Notes",
    "- Personal details appear as tokens such as ‹NAME_1› or ‹PHONE_1›. Copy tokens exactly into set_slot values.",
    "- Emit between 1 and 4 commands. Write search queries as standalone questions.",
    "- Clarify options are sent back as the visitor's next message, so write each one as a specific question",
    "  the website answers, e.g. \"What are your opening hours?\", never a menu heading like \"Ask about prices\".",
    "- If the visitor just picked an option you offered, answer it; do not clarify again.",
    "- Questions about today, tomorrow or right now are answerable from the opening hours: use answer_from_knowledge.",
  ].join("\n");
}

/** The business's local day and time, so "are you open now?" can be answered from the opening hours. */
export function practiceNow(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function plannerUserMessage(ctx: TurnContext): string {
  const pack = packFor(ctx.bundle.vertical);
  const team = `${pack.place.charAt(0).toUpperCase()}${pack.place.slice(1)} team`;
  const history = ctx.history
    .slice(-12)
    .map((h) => `${h.role === "visitor" ? "Visitor" : h.role === "staff" ? team : "Assistant"}: ${h.text}`)
    .join("\n");
  let state = "No flow is active.";
  if (ctx.flow?.name === "booking_request") {
    const step =
      ctx.flow.step === "change"
        ? "change (visitor wants to change a detail)"
        : nextBookingStep(pack.booking, ctx.flow, { online: ctx.bundle.booking?.mode === "online" });
    const { offered, slot_id: _id, slot_start: _start, ...slots } = ctx.flow.slots;
    const times = offered ? ` Times offered: ${(JSON.parse(offered) as { label: string }[]).map((o) => `"${o.label}"`).join(", ")}.` : "";
    state = `Active flow: booking_request. Waiting for: ${step}. Slots so far: ${JSON.stringify(slots)}.${times}`;
  }
  return (
    `${history ? `Conversation so far:\n${history}\n\n` : ""}${state}\n` +
    `Last assistant act: ${ctx.lastBotAct ?? "none"}. Now at the ${pack.place}: ${practiceNow()}.\n\n` +
    `Latest visitor message:\n${ctx.visitorText ?? ""}`
  );
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

const COMPOSE_SYSTEM = (practiceName: string, place: string) =>
  [
    `You turn extracts from the ${practiceName} website into a short chat answer to one question.`,
    "Rules:",
    "- Use only facts stated in the extracts. Do not add anything else.",
    "- End every sentence with the number of the extract it comes from, like [1] or [1][2].",
    "- Copy prices, times, numbers and phone numbers exactly. Keep qualifiers such as \"from\".",
    "- Never give advice about symptoms, treatment choices or medicines.",
    "- At most three short sentences, plain British English, speaking as \"we\".",
    "- Answer only what was asked. When the question names one service, level or size, give just that one",
    "  (\"A cut and blow-dry with a senior stylist is £75\"), not the whole list. Never say the same fact twice.",
    `- State facts as the ${place}'s own knowledge. Never mention the website, pages, extracts or sources,`,
    "  unless the visitor asks where to find something on the website; then name the page.",
    `- You are told the current day and time at the ${place}. For questions about now, today or tomorrow,`,
    "  work the answer out from the opening hours, naming the day (\"we're closed on Sundays\") and only times",
    "  that appear in the extracts. Never state the current time or date itself.",
    "- If the extracts do not answer the question, reply with exactly NO_ANSWER.",
  ].join("\n");

export function composeUserMessage(query: string, chunks: ScoredChunk[], now: string = practiceNow(), place = "practice"): string {
  const extracts = chunks.map((c, i) => `[${i + 1}] ${c.page} › ${c.heading}\n${c.text}`).join("\n\n");
  return `Question: ${query}\nNow at the ${place}: ${now}\n\nExtracts:\n${extracts}`;
}

export function liveCompose(query: string, chunks: ScoredChunk[], bundle: Bundle): ComposeResult {
  const model = bundle.config.chatModel;
  const t0 = Date.now();
  const { stream, done } = streamText({
    model,
    system: COMPOSE_SYSTEM(bundle.practice.name, packFor(bundle.vertical).place),
    messages: [{ role: "user", content: composeUserMessage(query, chunks, practiceNow(), packFor(bundle.vertical).place) }],
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
