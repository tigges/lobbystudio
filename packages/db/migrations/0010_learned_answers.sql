ALTER TABLE "labelled_answers" ADD COLUMN "asked" text;--> statement-breakpoint
ALTER TABLE "labelled_answers" ADD COLUMN "status" text DEFAULT 'held' NOT NULL;--> statement-breakpoint
ALTER TABLE "labelled_answers" ADD COLUMN "held_reason" text;--> statement-breakpoint
ALTER TABLE "labelled_answers" ADD COLUMN "embedding" vector(384);--> statement-breakpoint
ALTER TABLE "labelled_answers" ADD COLUMN "reviewed_at" timestamp with time zone;