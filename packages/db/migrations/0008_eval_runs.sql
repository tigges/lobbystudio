CREATE TABLE "eval_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"build" text,
	"llm_mode" text NOT NULL,
	"cases" integer NOT NULL,
	"passed" integer NOT NULL,
	"scores" jsonb,
	"results" jsonb NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "eval_runs_tenant_created" ON "eval_runs" USING btree ("tenant_id","created_at");