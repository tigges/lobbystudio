ALTER TABLE "conversations" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "turn_labels" ADD COLUMN "actioned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "turn_labels" ADD COLUMN "actioned_in" text;