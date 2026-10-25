CREATE TYPE "public"."conversation_status" AS ENUM('active', 'handed_over', 'closed');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('visitor', 'bot', 'staff', 'system');--> statement-breakpoint
CREATE TYPE "public"."outcome_basis" AS ENUM('confirmed', 'assumed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."outcome" AS ENUM('resolved_by_bot', 'resolved_after_handover', 'abandoned', 'escalated_unresolved', 'out_of_scope', 'blocked_by_guardrail');--> statement-breakpoint
CREATE TABLE "booking_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"slots" jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"content_version_id" integer NOT NULL,
	"page_slug" text NOT NULL,
	"page_title" text NOT NULL,
	"heading" text NOT NULL,
	"anchor" text NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', heading || ' ' || text)) STORED
);
--> statement-breakpoint
CREATE TABLE "content_pages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"content_version_id" integer NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"nav_label" text NOT NULL,
	"position" smallint NOT NULL,
	"body_md" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"number" integer NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"visitor_id" text NOT NULL,
	"version_id" integer NOT NULL,
	"status" "conversation_status" DEFAULT 'active' NOT NULL,
	"flow" jsonb,
	"topic" text,
	"answered_count" integer DEFAULT 0 NOT NULL,
	"fallback_count" integer DEFAULT 0 NOT NULL,
	"last_bot_act" text,
	"affirmed_at" timestamp with time zone,
	"outcome" "outcome",
	"outcome_basis" "outcome_basis",
	"outcome_at" timestamp with time zone,
	"reversed_by_conversation_id" uuid,
	"rating" smallint,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_visitor_at" timestamp with time zone,
	"last_human_at" timestamp with time zone,
	"handed_over_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"action" text NOT NULL,
	"from_version_id" integer,
	"to_version_id" integer NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"promoted_version_id" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handovers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "labelled_answers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"handover_id" integer NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"author" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"turn_id" integer,
	"role" "message_role" NOT NULL,
	"text" text NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"feedback" smallint,
	"author_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"content_version_id" integer NOT NULL,
	"chunk_id" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(384) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pii_vault" (
	"tenant_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"token" text NOT NULL,
	"kind" text NOT NULL,
	"value_hash" text NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pii_vault_conversation_id_token_pk" PRIMARY KEY("conversation_id","token")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"version_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"content_version_number" integer NOT NULL,
	"llm_mode" text NOT NULL,
	"input" text NOT NULL,
	"commands" jsonb NOT NULL,
	"rejected_commands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_calls" jsonb NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd" numeric(12, 6) NOT NULL,
	"latency_ms" integer NOT NULL,
	"first_token_ms" integer,
	"retrieved" jsonb NOT NULL,
	"guardrails" jsonb NOT NULL,
	"flow_before" jsonb,
	"flow_after" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"number" integer NOT NULL,
	"parent_version_id" integer,
	"content_version_id" integer NOT NULL,
	"guidance" text NOT NULL,
	"procedures" jsonb NOT NULL,
	"flow_catalogue" jsonb NOT NULL,
	"config" jsonb NOT NULL,
	"note" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chunks_version" ON "chunks" USING btree ("tenant_id","content_version_id");--> statement-breakpoint
CREATE INDEX "chunks_tsv" ON "chunks" USING gin ("tsv");--> statement-breakpoint
CREATE UNIQUE INDEX "content_pages_version_slug" ON "content_pages" USING btree ("content_version_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "content_versions_tenant_number" ON "content_versions" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "conversations_tenant_activity" ON "conversations" USING btree ("tenant_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "conversations_visitor" ON "conversations" USING btree ("tenant_id","visitor_id","started_at");--> statement-breakpoint
CREATE INDEX "handovers_tenant_status" ON "handovers" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "messages_conversation" ON "messages" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE INDEX "passages_version" ON "passages" USING btree ("tenant_id","content_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "turns_conversation_index" ON "turns" USING btree ("conversation_id","index");--> statement-breakpoint
CREATE UNIQUE INDEX "versions_tenant_number" ON "versions" USING btree ("tenant_id","number");