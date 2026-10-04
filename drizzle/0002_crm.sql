CREATE TYPE "app"."automation_origin" AS ENUM('eligible', 'held', 'none');--> statement-breakpoint
CREATE TYPE "app"."inquiry_source" AS ENUM('website_form', 'manual', 'csv_import', 'meta_lead_form', 'google_lead_form', 'other');--> statement-breakpoint
CREATE TYPE "app"."pipeline_stage" AS ENUM('new', 'contacted', 'booked', 'won', 'lost');--> statement-breakpoint
CREATE TABLE "app"."consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"inquiry_id" uuid,
	"channel" text NOT NULL,
	"purpose" text NOT NULL,
	"granted" boolean NOT NULL,
	"statement" text,
	"method" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"page_url" text,
	"ip_address" text,
	"user_agent" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"full_name" text DEFAULT '' NOT NULL,
	"email" text,
	"email_normalized" text,
	"phone" text,
	"phone_e164" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_company_id_key" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"status" text DEFAULT 'previewed' NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"source" "app"."inquiry_source" NOT NULL,
	"source_label" text,
	"intake_source_id" uuid,
	"service_requested" text,
	"message" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stage" "app"."pipeline_stage" DEFAULT 'new' NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_user_id" uuid,
	"sale_value_cents" bigint,
	"sale_currency" text DEFAULT 'USD' NOT NULL,
	"won_at" timestamp with time zone,
	"lost_reason" text,
	"is_repeat" boolean DEFAULT false NOT NULL,
	"automation_origin" "app"."automation_origin" DEFAULT 'none' NOT NULL,
	"tracking" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inquiries_company_id_key" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."inquiry_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"inquiry_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_user_id" uuid,
	"actor_type" text DEFAULT 'user' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."intake_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"intake_source_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"payload" jsonb,
	"status" text DEFAULT 'received' NOT NULL,
	"error" text,
	"inquiry_id" uuid,
	"ip_hash" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."intake_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text DEFAULT 'website_form' NOT NULL,
	"name" text NOT NULL,
	"public_key" text NOT NULL,
	"signing_secret_enc" text,
	"allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"inquiry_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"inquiry_id" uuid NOT NULL,
	"title" text NOT NULL,
	"due_at" timestamp with time zone,
	"assigned_user_id" uuid,
	"completed_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."consent_records" ADD CONSTRAINT "consent_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."consent_records" ADD CONSTRAINT "consent_records_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."consent_records" ADD CONSTRAINT "consent_contact_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "app"."contacts"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."import_batches" ADD CONSTRAINT "import_batches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."import_batches" ADD CONSTRAINT "import_batches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inquiries" ADD CONSTRAINT "inquiries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inquiries" ADD CONSTRAINT "inquiries_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inquiries" ADD CONSTRAINT "inquiries_contact_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "app"."contacts"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inquiry_events" ADD CONSTRAINT "inquiry_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inquiry_events" ADD CONSTRAINT "inquiry_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inquiry_events" ADD CONSTRAINT "inquiry_events_inquiry_fk" FOREIGN KEY ("company_id","inquiry_id") REFERENCES "app"."inquiries"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."intake_events" ADD CONSTRAINT "intake_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."intake_events" ADD CONSTRAINT "intake_events_intake_source_id_intake_sources_id_fk" FOREIGN KEY ("intake_source_id") REFERENCES "app"."intake_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."intake_sources" ADD CONSTRAINT "intake_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notes" ADD CONSTRAINT "notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notes" ADD CONSTRAINT "notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notes" ADD CONSTRAINT "notes_inquiry_fk" FOREIGN KEY ("company_id","inquiry_id") REFERENCES "app"."inquiries"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_inquiry_fk" FOREIGN KEY ("company_id","inquiry_id") REFERENCES "app"."inquiries"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_contact_idx" ON "app"."consent_records" USING btree ("company_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_company_email_key" ON "app"."contacts" USING btree ("company_id","email_normalized") WHERE "app"."contacts"."email_normalized" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_company_phone_key" ON "app"."contacts" USING btree ("company_id","phone_e164") WHERE "app"."contacts"."phone_e164" is not null;--> statement-breakpoint
CREATE INDEX "contacts_company_name_idx" ON "app"."contacts" USING btree ("company_id","full_name");--> statement-breakpoint
CREATE INDEX "import_batches_company_idx" ON "app"."import_batches" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "inquiries_company_received_idx" ON "app"."inquiries" USING btree ("company_id","received_at");--> statement-breakpoint
CREATE INDEX "inquiries_company_stage_idx" ON "app"."inquiries" USING btree ("company_id","stage");--> statement-breakpoint
CREATE INDEX "inquiries_contact_idx" ON "app"."inquiries" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "inquiry_events_inquiry_idx" ON "app"."inquiry_events" USING btree ("inquiry_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "intake_events_idempotency_key" ON "app"."intake_events" USING btree ("intake_source_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "intake_events_source_received_idx" ON "app"."intake_events" USING btree ("intake_source_id","received_at");--> statement-breakpoint
CREATE INDEX "intake_events_content_idx" ON "app"."intake_events" USING btree ("intake_source_id","content_hash","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "intake_sources_public_key_key" ON "app"."intake_sources" USING btree ("public_key");--> statement-breakpoint
CREATE INDEX "intake_sources_company_idx" ON "app"."intake_sources" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "notes_inquiry_idx" ON "app"."notes" USING btree ("inquiry_id");--> statement-breakpoint
CREATE INDEX "tasks_company_open_idx" ON "app"."tasks" USING btree ("company_id","completed_at","due_at");