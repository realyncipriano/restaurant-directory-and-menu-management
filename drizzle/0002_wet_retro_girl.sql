ALTER TYPE "public"."import_status" ADD VALUE 'uploading' BEFORE 'uploaded';--> statement-breakpoint
ALTER TABLE "menu_imports" ADD COLUMN "processing_token" uuid;--> statement-breakpoint
ALTER TABLE "menu_imports" ADD COLUMN "processing_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "menu_imports" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_imports" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "menu_imports" ADD COLUMN "upload_completed_at" timestamp with time zone;