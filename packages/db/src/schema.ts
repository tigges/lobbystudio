import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const outcomeEnum = pgEnum("outcome", [
  "resolved_by_bot",
  "resolved_after_handover",
  "abandoned",
  "escalated_unresolved",
  "out_of_scope",
  "blocked_by_guardrail",
]);

export const outcomeBasisEnum = pgEnum("outcome_basis", ["confirmed", "assumed", "reversed"]);

export const conversationStatusEnum = pgEnum("conversation_status", ["active", "handed_over", "closed"]);

export const messageRoleEnum = pgEnum("message_role", ["visitor", "bot", "staff", "system"]);

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** One immutable snapshot of the practice website. The site and retrieval both read the promoted one. */
export const contentVersions = pgTable(
  "content_versions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: text("tenant_id").notNull(),
    number: integer("number").notNull(),
    note: text("note").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("content_versions_tenant_number").on(t.tenantId, t.number)],
);

export const contentPages = pgTable(
  "content_pages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: text("tenant_id").notNull(),
    contentVersionId: integer("content_version_id").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    navLabel: text("nav_label").notNull(),
    position: smallint("position").notNull(),
    bodyMd: text("body_md").notNull(),
  },
  (t) => [uniqueIndex("content_pages_version_slug").on(t.contentVersionId, t.slug)],
);

export const chunks = pgTable(
  "chunks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: text("tenant_id").notNull(),
    contentVersionId: integer("content_version_id").notNull(),
    pageSlug: text("page_slug").notNull(),
    pageTitle: text("page_title").notNull(),
    heading: text("heading").notNull(),
    anchor: text("anchor").notNull(),
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: 384 }).notNull(),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('english', heading || ' ' || text)`),
  },
  (t) => [
    index("chunks_version").on(t.tenantId, t.contentVersionId),
    index("chunks_tsv").using("gin", t.tsv),
  ],
);

/** Single lines of a chunk, embedded with their heading. A chunk's relevance is its best line. */
export const passages = pgTable(
  "passages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: text("tenant_id").notNull(),
    contentVersionId: integer("content_version_id").notNull(),
    chunkId: integer("chunk_id").notNull(),
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: 384 }).notNull(),
  },
  (t) => [index("passages_version").on(t.tenantId, t.contentVersionId)],
);

export type Procedure = { key: string; title: string; steps: string };

export type BundleConfig = {
  chatModel: string;
  retrievalThreshold: number;
  maxChunks: number;
};

/** Numbered, immutable behaviour bundle. Updates and deletes are rejected by a trigger. */
export const versions = pgTable(
  "versions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: text("tenant_id").notNull(),
    number: integer("number").notNull(),
    parentVersionId: integer("parent_version_id"),
    contentVersionId: integer("content_version_id").notNull(),
    guidance: text("guidance").notNull(),
    procedures: jsonb("procedures").$type<Procedure[]>().notNull(),
    flowCatalogue: jsonb("flow_catalogue").$type<string[]>().notNull(),
    config: jsonb("config").$type<BundleConfig>().notNull(),
    note: text("note").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("versions_tenant_number").on(t.tenantId, t.number)],
);

export const deployments = pgTable("deployments", {
  tenantId: text("tenant_id").primaryKey(),
  promotedVersionId: integer("promoted_version_id").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const deploymentEvents = pgTable("deployment_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: text("tenant_id").notNull(),
  action: text("action").$type<"promote" | "rollback">().notNull(),
  fromVersionId: integer("from_version_id"),
  toVersionId: integer("to_version_id").notNull(),
  actor: text("actor").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type FlowState = {
  name: "booking_request" | "handover";
  step: string;
  slots: Record<string, string>;
};

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    visitorId: text("visitor_id").notNull(),
    versionId: integer("version_id").notNull(),
    status: conversationStatusEnum("status").notNull().default("active"),
    flow: jsonb("flow").$type<FlowState | null>(),
    topic: text("topic"),
    answeredCount: integer("answered_count").notNull().default(0),
    fallbackCount: integer("fallback_count").notNull().default(0),
    lastBotAct: text("last_bot_act"),
    affirmedAt: ts("affirmed_at"),
    outcome: outcomeEnum("outcome"),
    outcomeBasis: outcomeBasisEnum("outcome_basis"),
    outcomeAt: ts("outcome_at"),
    reversedByConversationId: uuid("reversed_by_conversation_id"),
    rating: smallint("rating"),
    startedAt: ts("started_at").notNull().defaultNow(),
    lastActivityAt: ts("last_activity_at").notNull().defaultNow(),
    lastVisitorAt: ts("last_visitor_at"),
    lastHumanAt: ts("last_human_at"),
    handedOverAt: ts("handed_over_at"),
    isDemo: boolean("is_demo").notNull().default(false),
  },
  (t) => [
    index("conversations_tenant_activity").on(t.tenantId, t.lastActivityAt),
    index("conversations_visitor").on(t.tenantId, t.visitorId, t.startedAt),
  ],
);

export type Source = { page: string; slug: string; heading: string; anchor: string; chunkId: number };

export const messages = pgTable(
  "messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: text("tenant_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    turnId: integer("turn_id"),
    role: messageRoleEnum("role").notNull(),
    text: text("text").notNull(),
    sources: jsonb("sources").$type<Source[]>().notNull().default([]),
    options: jsonb("options").$type<string[]>().notNull().default([]),
    kind: text("kind").notNull().default("text"),
    feedback: smallint("feedback"),
    authorName: text("author_name"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("messages_conversation").on(t.conversationId, t.id)],
);

export type RetrievedChunk = {
  chunkId: number;
  page: string;
  heading: string;
  score: number;
  keywordScore: number;
  used: "cited" | "context" | "below_threshold";
};

export type GuardrailHit = { rule: string; result: "pass" | "hit" | "blocked" | "dropped"; detail?: string };

export type TraceCommand = { cmd: string; [key: string]: unknown };

export type ModelCall = {
  role: "planner" | "compose";
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
};

/** Trace ledger: one row per visitor turn, written before the reply is considered served. */
export const turns = pgTable(
  "turns",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: text("tenant_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    index: integer("index").notNull(),
    versionId: integer("version_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    contentVersionNumber: integer("content_version_number").notNull(),
    llmMode: text("llm_mode").notNull(),
    input: text("input").notNull(),
    commands: jsonb("commands").$type<TraceCommand[]>().notNull(),
    rejectedCommands: jsonb("rejected_commands").$type<unknown[]>().notNull().default([]),
    modelCalls: jsonb("model_calls").$type<ModelCall[]>().notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }).notNull(),
    latencyMs: integer("latency_ms").notNull(),
    firstTokenMs: integer("first_token_ms"),
    retrieved: jsonb("retrieved").$type<RetrievedChunk[]>().notNull(),
    guardrails: jsonb("guardrails").$type<GuardrailHit[]>().notNull(),
    flowBefore: jsonb("flow_before").$type<FlowState | null>(),
    flowAfter: jsonb("flow_after").$type<FlowState | null>(),
    error: text("error"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("turns_conversation_index").on(t.conversationId, t.index)],
);

export const piiVault = pgTable(
  "pii_vault",
  {
    tenantId: text("tenant_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    token: text("token").notNull(),
    kind: text("kind").notNull(),
    valueHash: text("value_hash").notNull(),
    ciphertext: text("ciphertext").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.token] })],
);

export const handovers = pgTable(
  "handovers",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: text("tenant_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    reason: text("reason").notNull(),
    trigger: text("trigger").notNull(),
    status: text("status").$type<"open" | "replied" | "released">().notNull().default("open"),
    /** Name and phone the bot collected after handing over, as vault tokens. */
    contact: jsonb("contact").$type<Record<string, string>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
    repliedAt: ts("replied_at"),
  },
  (t) => [index("handovers_tenant_status").on(t.tenantId, t.status)],
);

/** A practice reply to a handed-over question, kept as the labelled correct answer for later learning. */
export const labelledAnswers = pgTable("labelled_answers", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: text("tenant_id").notNull(),
  conversationId: uuid("conversation_id").notNull(),
  handoverId: integer("handover_id").notNull(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  author: text("author").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const bookingRequests = pgTable("booking_requests", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: text("tenant_id").notNull(),
  conversationId: uuid("conversation_id").notNull(),
  slots: jsonb("slots").$type<Record<string, string>>().notNull(),
  status: text("status").$type<"new" | "contacted">().notNull().default("new"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
