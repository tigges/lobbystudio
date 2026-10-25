CREATE TABLE "turn_labels" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"turn_id" integer NOT NULL,
	"label" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "build" text;--> statement-breakpoint
CREATE UNIQUE INDEX "turn_labels_turn" ON "turn_labels" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX "turn_labels_tenant_label" ON "turn_labels" USING btree ("tenant_id","label");