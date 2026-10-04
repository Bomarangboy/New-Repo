CREATE TABLE "app"."company_senders" (
	"company_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'not_configured' NOT NULL,
	"twilio_account_sid" text,
	"twilio_auth_token_enc" text,
	"messaging_service_sid" text,
	"from_number" text,
	"postmark_server_token_enc" text,
	"from_email" text,
	"from_name" text,
	"reply_to" text,
	"webhook_key_hash" text,
	"notes" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"last_message_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"last_human_outbound_at" timestamp with time zone,
	"needs_reply" boolean DEFAULT false NOT NULL,
	"last_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_company_id_key" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"result" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."message_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"status" text NOT NULL,
	"provider_status" text,
	"error_code" text,
	"applied" boolean NOT NULL,
	"occurred_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"inquiry_id" uuid,
	"direction" text NOT NULL,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"to_address" text NOT NULL,
	"from_address" text,
	"subject" text,
	"body" text NOT NULL,
	"transport" text NOT NULL,
	"provider_message_id" text,
	"error_code" text,
	"segments" integer,
	"idempotency_key" text,
	"template_key" text,
	"template_version" integer,
	"sent_by_user_id" uuid,
	"sending_started_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"status_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."messaging_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"ack_enabled" boolean DEFAULT true NOT NULL,
	"window_start_minute" integer DEFAULT 480 NOT NULL,
	"window_end_minute" integer DEFAULT 1260 NOT NULL,
	"window_days" jsonb DEFAULT '[0,1,2,3,4,5,6]'::jsonb NOT NULL,
	"notify_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"automation_paused" boolean DEFAULT false NOT NULL,
	"automation_paused_reason" text,
	"automation_paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"inquiry_id" uuid,
	"conversation_id" uuid,
	"title" text NOT NULL,
	"email_status" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"address" text NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"created_by_user_id" uuid,
	"lifted_at" timestamp with time zone,
	"lifted_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."company_senders" ADD CONSTRAINT "company_senders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."conversations" ADD CONSTRAINT "conversations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."conversations" ADD CONSTRAINT "conversations_contact_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "app"."contacts"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_status_events" ADD CONSTRAINT "message_status_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_status_events" ADD CONSTRAINT "message_status_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "app"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_templates" ADD CONSTRAINT "message_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_templates" ADD CONSTRAINT "message_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_conversation_fk" FOREIGN KEY ("company_id","conversation_id") REFERENCES "app"."conversations"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_contact_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "app"."contacts"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messaging_settings" ADD CONSTRAINT "messaging_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."suppressions" ADD CONSTRAINT "suppressions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."suppressions" ADD CONSTRAINT "suppressions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_senders_key" ON "app"."company_senders" USING btree ("company_id","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "company_senders_twilio_key" ON "app"."company_senders" USING btree ("twilio_account_sid") WHERE "app"."company_senders"."twilio_account_sid" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "company_senders_webhook_key" ON "app"."company_senders" USING btree ("webhook_key_hash") WHERE "app"."company_senders"."webhook_key_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_contact_key" ON "app"."conversations" USING btree ("company_id","contact_id");--> statement-breakpoint
CREATE INDEX "conversations_recent_idx" ON "app"."conversations" USING btree ("company_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_key" ON "app"."jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "app"."jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "jobs_company_idx" ON "app"."jobs" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "message_status_events_message_idx" ON "app"."message_status_events" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_templates_version_key" ON "app"."message_templates" USING btree ("company_id","key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_idempotency_key" ON "app"."messages" USING btree ("company_id","idempotency_key") WHERE "app"."messages"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_provider_key" ON "app"."messages" USING btree ("transport","provider_message_id") WHERE "app"."messages"."provider_message_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "app"."messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_company_status_idx" ON "app"."messages" USING btree ("company_id","status","created_at");--> statement-breakpoint
CREATE INDEX "messages_inquiry_idx" ON "app"."messages" USING btree ("inquiry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_once_key" ON "app"."notifications" USING btree ("company_id","user_id","kind","inquiry_id","conversation_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "app"."notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_active_key" ON "app"."suppressions" USING btree ("company_id","channel","address") WHERE "app"."suppressions"."lifted_at" is null;