ALTER TABLE "menu_imports" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "menu_imports" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "menu_imports" ADD CONSTRAINT "menu_imports_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menu_imports_deleted_idx" ON "menu_imports" USING btree ("deleted_at");