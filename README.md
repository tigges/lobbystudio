# dental-bot

A web-chat assistant for a small dental practice that is meant to get measurably better each week. Every behaviour change goes through a proposal queue that a human approves.

The demo practice, **Harbour Dental**, is fictitious. Its address, phone number (Ofcom drama range), staff and prices are invented.

## Run it

Requirements: Node 22+, pnpm 10, and either Docker or a local Postgres 16 with pgvector.

```bash
pnpm install
pnpm dev
```

`pnpm dev` does the following:

1. Creates `.env` from `.env.example` if it's missing.
2. Starts Postgres with Docker, but only if nothing is listening on the `DATABASE_URL` port.
3. Runs migrations and seeds the practice, content v1, behaviour v1 and 15 demo conversations. Seeding is idempotent.
4. Builds the widget and starts the site, worker and widget watcher.

Once it's running, use these addresses:

- Site with the widget: http://localhost:3000
- Practice console (handovers, booking requests, conversations and per-turn trace): http://localhost:3000/console

Set `ANTHROPIC_API_KEY` (or `CLAUDE_API_KEY`) for live mode. Without a key, the runtime uses a deterministic offline planner and an extractive composer, so the demo still runs. You can force either mode with `LLM_MODE=live|offline`.

Other commands:

| Command | Purpose |
| --- | --- |
| `pnpm test` | Unit tests: executor, guardrails, outcomes, PII |
| `pnpm typecheck` | All packages |
| `pnpm db:reset` | Drop everything, then re-migrate and re-seed |
| `pnpm --filter @dental-bot/core exec tsx src/seed/calibrate.ts` | Retrieval-threshold recall and leak over probe questions |

## Deploy (Render)

`render.yaml` is a Render Blueprint for two services, built from the root `Dockerfile` in Frankfurt:

- `lobbystudio`: the web service, serving the site, widget API and console
- `lobbystudio-worker`: the outcome sweep

Both read `DATABASE_URL` from the existing Render Postgres instance named `lobbystudio`. `PII_KEY` is generated once and shared through an environment group, and Render prompts for `ANTHROPIC_API_KEY` and `CONSOLE_PASSWORD` when the Blueprint is created.

Every boot runs the migrations and the idempotent seed (`scripts/start-web.sh`). The embedding model is baked into the image at build time.

## Layout

```
apps/web        Next.js: the five-page practice site, widget API (SSE), practice console
apps/worker     Background jobs (phase 0: outcome sweep every 5 min, advisory-locked)
packages/db     Drizzle schema + migrations (Postgres + pgvector); immutability triggers
packages/core   Runtime (planner → commands → deterministic executor), retrieval, PII vault,
                outcomes, versions, services, seed content and behaviour
packages/widget Vanilla TS widget, one <script> tag, Shadow DOM, ~5 KB gzipped
```

## How a turn works

1. The visitor's text is tokenised before storage and before any model call. Names, phones, emails, NHS numbers, card numbers, dates and postcodes become tokens such as `‹PHONE_1›`. The real values are kept in an AES-GCM vault scoped to the conversation.
2. A deterministic clinical precheck runs first. Emergencies, pain, swelling and requests for clinical advice always hand over, without a model call.
3. Otherwise the planner (Claude Haiku-tier) emits only commands: `answer_from_knowledge`, `start_flow`, `set_slot`, `clarify`, `handover` or `cannot_handle`. They are validated with zod, and the executor applies them deterministically.
4. `answer_from_knowledge` retrieves from the promoted content version using hybrid line-level and chunk-level vectors plus a keyword bonus.
   - Below the relevancy threshold, the bot says it doesn't know and gives the phone number.
   - Above it, a constrained compose step streams sentences. Each sentence must cite a chunk, and every number in it must appear in the cited text. Uncited or ungrounded sentences are dropped.
5. Every turn writes a ledger row with:
   - the versions served
   - commands, including rejected ones
   - model calls, tokens, cost and latency
   - retrieved chunks with scores
   - guardrail hits
   - flow before and after

Outcomes come from a closed enum: `resolved_by_bot`, `resolved_after_handover`, `abandoned`, `escalated_unresolved`, `out_of_scope` and `blocked_by_guardrail`.

- **Confirmed:** the visitor affirms, or a flow completes.
- **Assumed:** the worker sweeps after 24 hours of inactivity with no human and no return.
- **Reversed:** the visitor comes back on the same topic within 7 days.

Versions are immutable bundles of Guidance (1,500-character cap), Procedures, flow catalogue, content version and config. Database triggers reject updates. The widget always serves the version that `deployments` points to.

## Phase notes

**Phase 0 (this):** The phase delivers:

- the site, the widget, the command runtime with two flows (booking request and handover), and grounded retrieval
- the trace ledger, outcomes, and PII tokenisation
- the handover stub, where practice replies are stored as labelled answers
- seeded demo conversations

There are three deviations from the announced stack:

- The Anthropic API is called with plain `fetch` rather than the Vercel AI SDK.
- Embeddings are local (`bge-small-en-v1.5` through transformers.js), so no visitor text leaves the box for embedding.
- There's a simple worker loop instead of pg-boss.

Prices in the cost column are list-price assumptions in `packages/core/src/llm/pricing.ts`.

**Next (phase 1):** a golden set of 100–150 cases, persona simulations, a judge from a different model family (needs `OPENAI_API_KEY`), version diffs and the full inspector.
