import type { Bundle, ComposeResult, ExecutorDeps, ScoredChunk, TurnContext } from "../src/runtime/types.ts";

export const bundle: Bundle = {
  tenantId: "test",
  versionId: 1,
  versionNumber: 7,
  contentVersionId: 1,
  contentVersionNumber: 1,
  guidance: "Be kind.",
  procedures: [],
  flowCatalogue: ["booking_request", "handover"],
  config: { chatModel: "test-model", retrievalThreshold: 0.68, maxChunks: 4 },
  practice: { name: "Harbour Dental", phone: "020 7946 0321" },
  vertical: "dental",
  booking: { mode: "callback" },
  handoverSources: {
    urgent: [{ page: "Emergencies", slug: "emergencies", heading: "Call 999 or go to A&E", anchor: "call-999-or-go-to-a-and-e", chunkId: 90 }],
    clinical: [{ page: "Emergencies", slug: "emergencies", heading: "What we cannot do in the chat", anchor: "what-we-cannot-do-in-the-chat", chunkId: 94 }],
  },
};

export const hygieneChunk: ScoredChunk = {
  chunkId: 11,
  page: "Treatments and prices",
  slug: "treatments",
  heading: "Check-ups and hygiene",
  anchor: "check-ups-and-hygiene",
  text: "Hygienist appointment (30 minutes): £75 (private price)\nRoutine check-up for existing patients: £55 (private price)",
  score: 0.91,
  keywordScore: 0.2,
};

export const fillingChunk: ScoredChunk = {
  chunkId: 12,
  page: "Treatments and prices",
  slug: "treatments",
  heading: "Fillings and root canal treatment",
  anchor: "fillings-and-root-canal-treatment",
  text: "White filling: from £140 (private price)",
  score: 0.86,
  keywordScore: 0.1,
};

export const hoursChunk: ScoredChunk = {
  chunkId: 21,
  page: "Opening hours and contact",
  slug: "contact",
  heading: "Opening hours",
  anchor: "opening-hours",
  text: "Saturday: 9am to 1pm\nSunday: Closed",
  score: 0.88,
  keywordScore: 0.1,
};

export function ctx(overrides: Partial<TurnContext> = {}): TurnContext {
  return { visitorText: "hello", action: null, flow: null, status: "active", history: [], bundle, ...overrides };
}

function composeOf(text: string): ComposeResult {
  async function* stream() {
    for (const piece of text.match(/.{1,7}/gs) ?? []) yield piece;
  }
  return { stream: stream(), done: Promise.resolve({ role: "compose", model: "test-model", inputTokens: 100, outputTokens: 20, costUsd: 0.0002, latencyMs: 5 }) };
}

export type FakeOptions = {
  commands?: unknown[];
  chunks?: Record<string, ScoredChunk[]> | ScoredChunk[];
  composed?: string | ((query: string) => string);
  planThrows?: boolean;
};

export function fakeDeps(opts: FakeOptions = {}) {
  const calls = { plan: 0, retrieve: [] as string[], compose: [] as string[] };
  const deps: ExecutorDeps = {
    async plan() {
      calls.plan += 1;
      if (opts.planThrows) throw new Error("model unavailable");
      return {
        commands: opts.commands ?? [],
        call: { role: "planner", model: "test-model", inputTokens: 500, outputTokens: 40, costUsd: 0.0007, latencyMs: 10 },
      };
    },
    async retrieve(query) {
      calls.retrieve.push(query);
      if (Array.isArray(opts.chunks)) return opts.chunks;
      return opts.chunks?.[query] ?? [];
    },
    compose(query) {
      calls.compose.push(query);
      const text = typeof opts.composed === "function" ? opts.composed(query) : (opts.composed ?? "NO_ANSWER");
      return composeOf(text);
    },
    now: (() => {
      let t = 0;
      return () => (t += 5);
    })(),
  };
  return { deps, calls };
}
