CREATE TABLE "app"."library_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "app"."library_copies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"template_version" integer NOT NULL,
	"kind" text NOT NULL,
	"sequence_id" uuid,
	"draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"setup" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"previous" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"activated_at" timestamp with time zone,
	"activated_by_user_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_copies_company_id_key" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."library_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"industry" text,
	"lead_source" text,
	"companies" integer NOT NULL,
	"enrolled" integer NOT NULL,
	"messages_sent" integer NOT NULL,
	"delivered" integer NOT NULL,
	"failed" integer NOT NULL,
	"replied" integer NOT NULL,
	"booked" integer NOT NULL,
	"opted_out" integer NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"computed_by_user_id" uuid,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."library_template_drafts" (
	"template_id" uuid PRIMARY KEY NOT NULL,
	"definition" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."library_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"changelog" text,
	"published_by_user_id" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."library_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"industry" text NOT NULL,
	"objective" text NOT NULL,
	"category_id" uuid,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"step_count" integer DEFAULT 1 NOT NULL,
	"duration_days" integer DEFAULT 0 NOT NULL,
	"required_package" "app"."package_tier" NOT NULL,
	"required_integrations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommended" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"latest_version" integer,
	"status_reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "app"."studio_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."studio_drafts" (
	"scope_key" text PRIMARY KEY NOT NULL,
	"scope_kind" text NOT NULL,
	"package_tier" "app"."package_tier",
	"company_id" uuid,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."studio_published" (
	"scope_key" text PRIMARY KEY NOT NULL,
	"scope_kind" text NOT NULL,
	"package_tier" "app"."package_tier",
	"company_id" uuid,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer NOT NULL,
	"published_by_user_id" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."studio_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_key" text NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"summary" text NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"published_by_user_id" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."library_copies" ADD CONSTRAINT "library_copies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."library_copies" ADD CONSTRAINT "library_copies_template_id_library_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "app"."library_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."library_copies" ADD CONSTRAINT "library_copies_activated_by_user_id_users_id_fk" FOREIGN KEY ("activated_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."library_copies" ADD CONSTRAINT "library_copies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."library_copies" ADD CONSTRAINT "library_copies_sequence_fk" FOREIGN KEY ("company_id","sequence_id") REFERENCES "app"."sequences"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."library_evidence" ADD CONSTRAINT "library_evidence_template_id_library_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "app"."library_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."library_evidence" ADD CONSTRAINT "library_evidence_computed_by_user_id_users_id_fk" FOREIGN KEY ("computed_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."library_template_drafts" ADD CONSTRAINT "library_template_drafts_template_id_library_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "app"."library_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."library_template_drafts" ADD CONSTRAINT "library_template_drafts_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."library_template_versions" ADD CONSTRAINT "library_template_versions_template_id_library_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "app"."library_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."library_template_versions" ADD CONSTRAINT "library_template_versions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."library_templates" ADD CONSTRAINT "library_templates_category_id_library_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "app"."library_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."library_templates" ADD CONSTRAINT "library_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."studio_assets" ADD CONSTRAINT "studio_assets_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."studio_drafts" ADD CONSTRAINT "studio_drafts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."studio_drafts" ADD CONSTRAINT "studio_drafts_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."studio_published" ADD CONSTRAINT "studio_published_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."studio_published" ADD CONSTRAINT "studio_published_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."studio_versions" ADD CONSTRAINT "studio_versions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "library_copies_sequence_key" ON "app"."library_copies" USING btree ("sequence_id");--> statement-breakpoint
CREATE INDEX "library_copies_template_idx" ON "app"."library_copies" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "library_template_versions_key" ON "app"."library_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "library_templates_status_idx" ON "app"."library_templates" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_versions_scope_version" ON "app"."studio_versions" USING btree ("scope_key","version");