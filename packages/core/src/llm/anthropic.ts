const API = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";

export function anthropicKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || undefined;
}

export type Usage = { inputTokens: number; outputTokens: number };

/** Some models think by default, which can spend the whole small token budget before any text. */
const NO_THINKING = { type: "disabled" } as const;

type Message = { role: "user" | "assistant"; content: string };

async function post(body: unknown, signal?: AbortSignal): Promise<Response> {
  const key = anthropicKey();
  if (!key) throw new Error("no Anthropic API key configured");
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": VERSION, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(20_000),
      });
      if (res.ok) return res;
      const detail = await res.text();
      lastError = new Error(`anthropic ${res.status}: ${detail.slice(0, 300)}`);
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw lastError;
}

export async function callTool<T>(opts: {
  model: string;
  system: string;
  messages: Message[];
  tool: { name: string; description: string; input_schema: unknown };
  maxTokens?: number;
}): Promise<{ input: T; usage: Usage }> {
  const res = await post({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 400,
    thinking: NO_THINKING,
    system: opts.system,
    messages: opts.messages,
    tools: [opts.tool],
    tool_choice: { type: "tool", name: opts.tool.name },
  });
  const json = (await res.json()) as {
    content: { type: string; name?: string; input?: unknown }[];
    usage: { input_tokens: number; output_tokens: number };
  };
  const block = json.content.find((c) => c.type === "tool_use" && c.name === opts.tool.name);
  if (!block) throw new Error("model did not call the tool");
  return {
    input: block.input as T,
    usage: { inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens },
  };
}

/** Streams text deltas. `done` resolves with token usage once the stream ends. */
export function streamText(opts: {
  model: string;
  system: string;
  messages: Message[];
  maxTokens?: number;
}): { stream: AsyncIterable<string>; done: Promise<Usage> } {
  let resolveUsage!: (u: Usage) => void;
  let rejectUsage!: (e: unknown) => void;
  const done = new Promise<Usage>((res, rej) => {
    resolveUsage = res;
    rejectUsage = rej;
  });
  done.catch(() => {});

  async function* run(): AsyncGenerator<string> {
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    try {
      const res = await post({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 350,
        thinking: NO_THINKING,
        stream: true,
        system: opts.system,
        messages: opts.messages,
      });
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += value;
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          const event = JSON.parse(dataLine.slice(6)) as {
            type: string;
            delta?: { type?: string; text?: string };
            message?: { usage?: { input_tokens: number; output_tokens: number } };
            usage?: { output_tokens: number };
            error?: { message: string };
          };
          if (event.type === "message_start" && event.message?.usage) {
            usage.inputTokens = event.message.usage.input_tokens;
            usage.outputTokens = event.message.usage.output_tokens;
          } else if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
            yield event.delta.text;
          } else if (event.type === "message_delta" && event.usage) {
            usage.outputTokens = event.usage.output_tokens;
          } else if (event.type === "error") {
            throw new Error(event.error?.message ?? "stream error");
          }
        }
      }
      resolveUsage(usage);
    } catch (err) {
      rejectUsage(err);
      throw err;
    }
  }

  return { stream: run(), done };
}
