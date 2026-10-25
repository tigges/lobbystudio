import { callTool } from "../llm/anthropic.ts";
import type { ChunkInput } from "./chunk.ts";

/**
 * Asks the chat model for the questions a visitor might ask that this chunk answers.
 * They are embedded as extra passages so retrieval matches how people phrase questions.
 */
export async function generateQuestions(chunk: ChunkInput, model: string): Promise<string[]> {
  const { input } = await callTool<{ questions: string[] }>({
    model,
    maxTokens: 500,
    system:
      "You write the short questions a visitor to a UK dental practice website might type into a chat, " +
      "which the given website section answers directly. Only questions the section fully answers. " +
      "Vary the wording, include casual phrasings. 4 to 8 questions.",
    messages: [{ role: "user", content: `${chunk.pageTitle} › ${chunk.heading}\n\n${chunk.text}` }],
    tool: {
      name: "questions",
      description: "Return the questions",
      input_schema: {
        type: "object",
        properties: { questions: { type: "array", items: { type: "string" }, maxItems: 8 } },
        required: ["questions"],
      },
    },
  });
  return input.questions.map((q) => q.trim()).filter(Boolean);
}

export function chunkKey(c: Pick<ChunkInput, "pageSlug" | "anchor">): string {
  return `${c.pageSlug}#${c.anchor}`;
}
