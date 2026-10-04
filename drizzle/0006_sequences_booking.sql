CREATE TABLE "app"."appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"inquiry_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text,
	"replaced_external_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"title" text,
	"location" text,
	"attendee_timezone" text,
	"last_event_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_company_id_key" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."booking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"trigger_event" text NOT NULL,
	"external_id" text,
	"body_hash" text NOT NULL,
	"outcome" text NOT NULL,
	"detail" text,
	"appointment_id" uuid,
	"event_created_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."booking_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'calcom' NOT NULL,
	"booking_url" text,
	"webhook_secret_enc" text,
	"webhook_key_hash" text,
	"status" text DEFAULT 'not_connected' NOT NULL,
	"last_event_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"confirmations_enabled" boolean DEFAULT true NOT NULL,
	"reminders_enabled" boolean DEFAULT true NOT NULL,
	"reminder_offsets_minutes" jsonb DEFAULT '[1440,120]'::jsonb NOT NULL,
	"email_also" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sequence_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"inquiry_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"next_step" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone,
	"origin" text NOT NULL,
	"enrolled_by_user_id" uuid,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paused_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"stop_reason" text,
	"stop_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sequence_enrollments_company_id_key" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."sequence_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"position" integer NOT NULL,
	"delay_minutes" integer NOT NULL,
	"channel" text NOT NULL,
	"sms_body" text,
	"email_subject" text,
	"email_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"auto_enroll" boolean DEFAULT false NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"stop_on_manual_message" boolean DEFAULT true NOT NULL,
	"handoff_task" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sequences_company_id_key" UNIQUE("company_id","id")
);
--> statement-breakpoint
DROP INDEX "app"."notifications_once_key";--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD COLUMN "ref_key" text;--> statement-breakpoint
ALTER TABLE "app"."appointments" ADD CONSTRAINT "appointments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointments" ADD CONSTRAINT "appointments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointments" ADD CONSTRAINT "appointments_inquiry_fk" FOREIGN KEY ("company_id","inquiry_id") REFERENCES "app"."inquiries"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointments" ADD CONSTRAINT "appointments_contact_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "app"."contacts"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."booking_events" ADD CONSTRAINT "booking_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."booking_settings" ADD CONSTRAINT "booking_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_enrolled_by_user_id_users_id_fk" FOREIGN KEY ("enrolled_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sequence_enrollments" ADD CONSTRAINT "enrollments_sequence_fk" FOREIGN KEY ("company_id","sequence_id") REFERENCES "app"."sequences"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sequence_enrollments" ADD CONSTRAINT "enrollments_inquiry_fk" FOREIGN KEY ("company_id","inquiry_id") REFERENCES "app"."inquiries"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sequence_enrollments" ADD CONSTRAINT "enrollments_contact_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "app"."contacts"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sequence_steps" ADD CONSTRAINT "sequence_steps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sequence_steps" ADD CONSTRAINT "sequence_steps_sequence_fk" FOREIGN KEY ("company_id","sequence_id") REFERENCES "app"."sequences"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sequences" ADD CONSTRAINT "sequences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sequences" ADD CONSTRAINT "sequences_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_external_key" ON "app"."appointments" USING btree ("company_id","source","external_id") WHERE "app"."appointments"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "appointments_company_start_idx" ON "app"."appointments" USING btree ("company_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_inquiry_idx" ON "app"."appointments" USING btree ("inquiry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_events_once_key" ON "app"."booking_events" USING btree ("company_id","body_hash");--> statement-breakpoint
CREATE INDEX "booking_events_company_idx" ON "app"."booking_events" USING btree ("company_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_settings_webhook_key" ON "app"."booking_settings" USING btree ("webhook_key_hash") WHERE "app"."booking_settings"."webhook_key_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_one_open_per_contact" ON "app"."sequence_enrollments" USING btree ("company_id","contact_id") WHERE "app"."sequence_enrollments"."status" in ('active','paused');--> statement-breakpoint
CREATE INDEX "enrollments_company_status_idx" ON "app"."sequence_enrollments" USING btree ("company_id","status","next_run_at");--> statement-breakpoint
CREATE INDEX "enrollments_inquiry_idx" ON "app"."sequence_enrollments" USING btree ("inquiry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sequence_steps_position_key" ON "app"."sequence_steps" USING btree ("sequence_id","version","position");--> statement-breakpoint
CREATE UNIQUE INDEX "sequences_one_auto_enroll" ON "app"."sequences" USING btree ("company_id") WHERE "app"."sequences"."auto_enroll" and "app"."sequences"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_once_key" ON "app"."notifications" USING btree ("company_id","user_id","kind","inquiry_id","conversation_id","ref_key");