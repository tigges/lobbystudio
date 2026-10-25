ALTER TABLE "booking_requests" ADD COLUMN "channel" text DEFAULT 'callback' NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "system" text;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "vertical" text DEFAULT 'dental' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "booking" jsonb DEFAULT '{"mode":"callback"}'::jsonb NOT NULL;