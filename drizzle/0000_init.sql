CREATE TYPE "public"."account_status" AS ENUM('invited', 'active', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."auth_token_purpose" AS ENUM('invite', 'password_reset');--> statement-breakpoint
CREATE TYPE "public"."availability_status" AS ENUM('available', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."change_action" AS ENUM('restaurant_created', 'restaurant_updated', 'restaurant_archived', 'restaurant_activated', 'menu_created', 'menu_duplicated', 'menu_updated', 'menu_published', 'menu_unpublished', 'menu_archived', 'category_created', 'category_updated', 'category_deleted', 'item_created', 'item_updated', 'item_deleted', 'item_availability_changed', 'price_changed', 'import_applied', 'permission_granted', 'permission_revoked', 'user_invited', 'user_activated', 'user_deactivated', 'user_reactivated', 'settings_updated');--> statement-breakpoint
CREATE TYPE "public"."import_change_type" AS ENUM('new', 'renamed', 'description_changed', 'price_changed', 'availability_changed', 'unchanged', 'removed');--> statement-breakpoint
CREATE TYPE "public"."import_item_decision" AS ENUM('pending', 'accept', 'reject');--> statement-breakpoint
CREATE TYPE "public"."import_page_status" AS ENUM('pending', 'uploaded', 'processing', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('uploaded', 'processing', 'needs_review', 'reviewed', 'applied', 'failed');--> statement-breakpoint
CREATE TYPE "public"."menu_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."restaurant_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'authorized_user');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_email" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "auth_token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"ip_hash" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"role" "user_role" DEFAULT 'authorized_user' NOT NULL,
	"account_status" "account_status" DEFAULT 'invited' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restaurant_user_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"can_view_management_data" boolean DEFAULT true NOT NULL,
	"can_edit_menu" boolean DEFAULT false NOT NULL,
	"can_publish_menu" boolean DEFAULT false NOT NULL,
	"can_manage_restaurant" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_user_permissions_view_required" CHECK ("restaurant_user_permissions"."can_view_management_data" = true)
);
--> statement-breakpoint
CREATE TABLE "restaurants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"cuisine_type" text,
	"address" text,
	"location" text,
	"contact_phone" text,
	"contact_email" text,
	"operating_hours" text,
	"currency" text DEFAULT 'PHP' NOT NULL,
	"logo_object_key" text,
	"cover_object_key" text,
	"status" "restaurant_status" DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurants_slug_format" CHECK ("restaurants"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "restaurants_currency_format" CHECK ("restaurants"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "menu_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_categories_sort_non_negative" CHECK ("menu_categories"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "menu_item_modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"additional_price_minor" integer DEFAULT 0 NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_item_modifiers_price_non_negative" CHECK ("menu_item_modifiers"."additional_price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "menu_item_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_minor" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_item_variants_price_non_negative" CHECK ("menu_item_variants"."price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"logical_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_price_minor" integer,
	"currency" text DEFAULT 'PHP' NOT NULL,
	"image_object_key" text,
	"availability_status" "availability_status" DEFAULT 'available' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_items_base_price_non_negative" CHECK ("menu_items"."base_price_minor" IS NULL OR "menu_items"."base_price_minor" >= 0),
	CONSTRAINT "menu_items_currency_format" CHECK ("menu_items"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "menu_items_sort_non_negative" CHECK ("menu_items"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"status" "menu_status" DEFAULT 'draft' NOT NULL,
	"lineage_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"cloned_from_menu_id" uuid,
	"published_at" timestamp with time zone,
	"last_updated_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menus_version_positive" CHECK ("menus"."version" >= 1),
	CONSTRAINT "menus_slug_format" CHECK ("menus"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "menu_change_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"menu_id" uuid,
	"menu_item_id" uuid,
	"menu_item_logical_id" uuid,
	"action" "change_action" NOT NULL,
	"previous_values" jsonb,
	"new_values" jsonb,
	"changed_by" uuid,
	"import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_import_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"page_number" integer,
	"category_name" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_price_minor" integer,
	"currency" text DEFAULT 'PHP' NOT NULL,
	"variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"modifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"availability_status" "availability_status" DEFAULT 'available' NOT NULL,
	"confidence" integer,
	"needs_review" boolean DEFAULT false NOT NULL,
	"duplicate_of_import_item_id" uuid,
	"matched_menu_item_id" uuid,
	"matched_logical_id" uuid,
	"change_type" "import_change_type" DEFAULT 'new' NOT NULL,
	"decision" "import_item_decision" DEFAULT 'pending' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_import_items_confidence_range" CHECK ("menu_import_items"."confidence" IS NULL OR ("menu_import_items"."confidence" >= 0 AND "menu_import_items"."confidence" <= 100)),
	CONSTRAINT "menu_import_items_price_non_negative" CHECK ("menu_import_items"."base_price_minor" IS NULL OR "menu_import_items"."base_price_minor" >= 0),
	CONSTRAINT "menu_import_items_sort_non_negative" CHECK ("menu_import_items"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "menu_import_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"private_source_object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"processing_status" "import_page_status" DEFAULT 'pending' NOT NULL,
	"extraction_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_import_pages_page_positive" CHECK ("menu_import_pages"."page_number" >= 1),
	CONSTRAINT "menu_import_pages_size_positive" CHECK ("menu_import_pages"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "menu_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"menu_id" uuid,
	"uploaded_by" uuid,
	"reviewed_by" uuid,
	"status" "import_status" DEFAULT 'uploaded' NOT NULL,
	"extraction_provider" text,
	"error_details" jsonb,
	"reviewed_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_user_permissions" ADD CONSTRAINT "restaurant_user_permissions_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_user_permissions" ADD CONSTRAINT "restaurant_user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_modifiers" ADD CONSTRAINT "menu_item_modifiers_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_variants" ADD CONSTRAINT "menu_item_variants_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_id_menu_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."menu_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_cloned_from_menu_id_menus_id_fk" FOREIGN KEY ("cloned_from_menu_id") REFERENCES "public"."menus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_change_logs" ADD CONSTRAINT "menu_change_logs_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_change_logs" ADD CONSTRAINT "menu_change_logs_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_change_logs" ADD CONSTRAINT "menu_change_logs_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_change_logs" ADD CONSTRAINT "menu_change_logs_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_change_logs" ADD CONSTRAINT "menu_change_logs_import_id_menu_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."menu_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_import_items" ADD CONSTRAINT "menu_import_items_import_id_menu_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."menu_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_import_items" ADD CONSTRAINT "menu_import_items_duplicate_of_import_item_id_menu_import_items_id_fk" FOREIGN KEY ("duplicate_of_import_item_id") REFERENCES "public"."menu_import_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_import_items" ADD CONSTRAINT "menu_import_items_matched_menu_item_id_menu_items_id_fk" FOREIGN KEY ("matched_menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_import_pages" ADD CONSTRAINT "menu_import_pages_import_id_menu_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."menu_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_imports" ADD CONSTRAINT "menu_imports_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_imports" ADD CONSTRAINT "menu_imports_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_imports" ADD CONSTRAINT "menu_imports_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_imports" ADD CONSTRAINT "menu_imports_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_token_hash_unique" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_purpose_idx" ON "auth_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "auth_tokens_expires_idx" ON "auth_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "rate_limits_window_idx" ON "rate_limits" USING btree ("window_ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("account_status");--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_user_permissions_unique" ON "restaurant_user_permissions" USING btree ("restaurant_id","user_id");--> statement-breakpoint
CREATE INDEX "restaurant_user_permissions_user_idx" ON "restaurant_user_permissions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "restaurants_slug_unique" ON "restaurants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "restaurants_status_idx" ON "restaurants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "restaurants_cuisine_idx" ON "restaurants" USING btree ("cuisine_type");--> statement-breakpoint
CREATE INDEX "restaurants_location_idx" ON "restaurants" USING btree ("location");--> statement-breakpoint
CREATE INDEX "menu_categories_menu_sort_idx" ON "menu_categories" USING btree ("menu_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_categories_menu_name_unique" ON "menu_categories" USING btree ("menu_id",lower("name"));--> statement-breakpoint
CREATE INDEX "menu_item_modifiers_item_sort_idx" ON "menu_item_modifiers" USING btree ("menu_item_id","sort_order");--> statement-breakpoint
CREATE INDEX "menu_item_variants_item_sort_idx" ON "menu_item_variants" USING btree ("menu_item_id","sort_order");--> statement-breakpoint
CREATE INDEX "menu_items_category_sort_idx" ON "menu_items" USING btree ("category_id","sort_order");--> statement-breakpoint
CREATE INDEX "menu_items_logical_idx" ON "menu_items" USING btree ("logical_id");--> statement-breakpoint
CREATE UNIQUE INDEX "menus_restaurant_lineage_version_unique" ON "menus" USING btree ("restaurant_id","lineage_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "menus_published_slug_unique" ON "menus" USING btree ("restaurant_id","slug") WHERE "menus"."status" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "menus_published_lineage_unique" ON "menus" USING btree ("restaurant_id","lineage_id") WHERE "menus"."status" = 'published';--> statement-breakpoint
CREATE INDEX "menus_restaurant_status_idx" ON "menus" USING btree ("restaurant_id","status");--> statement-breakpoint
CREATE INDEX "menus_lineage_idx" ON "menus" USING btree ("lineage_id");--> statement-breakpoint
CREATE INDEX "menu_change_logs_restaurant_created_idx" ON "menu_change_logs" USING btree ("restaurant_id","created_at");--> statement-breakpoint
CREATE INDEX "menu_change_logs_menu_created_idx" ON "menu_change_logs" USING btree ("menu_id","created_at");--> statement-breakpoint
CREATE INDEX "menu_change_logs_logical_created_idx" ON "menu_change_logs" USING btree ("menu_item_logical_id","created_at");--> statement-breakpoint
CREATE INDEX "menu_import_items_import_sort_idx" ON "menu_import_items" USING btree ("import_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_import_pages_import_page_unique" ON "menu_import_pages" USING btree ("import_id","page_number");--> statement-breakpoint
CREATE INDEX "menu_imports_restaurant_status_idx" ON "menu_imports" USING btree ("restaurant_id","status");--> statement-breakpoint
CREATE INDEX "menu_imports_created_idx" ON "menu_imports" USING btree ("created_at");