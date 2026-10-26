import type { EvalScores } from "@dental-bot/db/schema";
import { MODEL_ROLES } from "../config.ts";
import { callTool } from "../llm/anthropic.ts";
import { costUsd } from "../llm/pricing.ts";

export type Judgement = EvalScores & { note: string; costUsd: number };

const SYSTEM = [
  "You review one reply from a small business's website chat assistant and score it from 1 (bad) to 5 (excellent).",
  "- correct: everything it says is right for the question, given the extracts it was answered from.",
  "- grounded: every fact comes from the extracts or the fixed booking and handover wording; nothing invented.",
  "- answers: it answers what was actually asked, no more and no less, in plain, warm British English.",
  "- nextStep: it moves the visitor on sensibly, e.g. an offer to book that fits what they said, the next booking",
  "  question, or passing them to the team when it can't help. 5 when no next step is needed and none is forced.",
  "Fixed booking prompts, buttons and handover messages are written by the business and count as grounded.",
  "Personal details appear as tokens such as ‹NAME_1›; treat them as real values.",
  "The note is one short sentence on the biggest problem, or \"Fine\".",
].join("\n");

const TOOL = {
  name: "score_reply",
  description: "Score the assistant's latest reply.",
  input_schema: {
    type: "object",
    properties: {
      correct: { type: "integer", minimum: 1, maximum: 5 },
      grounded: { type: "integer", minimum: 1, maximum: 5 },
      answers: { type: "integer", minimum: 1, maximum: 5 },
      nextStep: { type: "integer", minimum: 1, maximum: 5 },
      note: { type: "string" },
    },
    required: ["correct", "grounded", "answers", "nextStep", "note"],
  },
};

export async function judgeReply(opts: {
  business: string;
  transcript: { role: string; text: string }[];
  reply: string;
  extracts: string[];
  hint?: string;
}): Promise<Judgement> {
  const model = MODEL_ROLES.reflection;
  const content = [
    `Business: ${opts.business}`,
    `Conversation so far:\n${opts.transcript.map((m) => `${m.role}: ${m.text}`).join("\n") || "(none)"}`,
    `Latest reply from the assistant:\n${opts.reply}`,
    `Extracts it was answered from:\n${opts.extracts.join("\n---\n") || "(none: fixed wording only)"}`,
    opts.hint ? `A reviewer's note on what a good reply does here: ${opts.hint}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const { input, usage } = await callTool<EvalScores & { note: string }>({
    model,
    system: SYSTEM,
    messages: [{ role: "user", content }],
    tool: TOOL,
    maxTokens: 300,
  });
  return { ...input, costUsd: costUsd(model, usage.inputTokens, usage.outputTokens) };
}

export function averageScores(all: EvalScores[]): EvalScores | null {
  if (all.length === 0) return null;
  const avg = (k: keyof EvalScores) => Math.round((all.reduce((n, s) => n + s[k], 0) / all.length) * 100) / 100;
  return { correct: avg("correct"), grounded: avg("grounded"), answers: avg("answers"), nextStep: avg("nextStep") };
}
