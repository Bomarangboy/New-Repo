CREATE TABLE "app"."ad_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"currency" text,
	"timezone" text,
	"selected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_accounts_company_id_key" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."ad_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ad_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"account_label" text,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"token_expires_at" timestamp with time zone,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"connected_by_user_id" uuid,
	"connected_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_sync_ok_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_connections_company_id_key" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."ad_daily_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"campaign_external_id" text NOT NULL,
	"day" date NOT NULL,
	"currency" text NOT NULL,
	"spend_micros" bigint NOT NULL,
	"impressions" bigint NOT NULL,
	"clicks" bigint NOT NULL,
	"platform_leads" integer,
	"platform_conversions" double precision,
	"mode" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ad_lead_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"lead_source_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_lead_id" text NOT NULL,
	"form_id" text,
	"payload" jsonb,
	"status" text DEFAULT 'received' NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"via" text DEFAULT 'webhook' NOT NULL,
	"inquiry_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."ad_lead_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"connection_id" uuid,
	"platform" text NOT NULL,
	"kind" text NOT NULL,
	"external_id" text,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	"page_token_enc" text,
	"webhook_key_hash" text,
	"google_key_hash" text,
	"active" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp with time zone,
	"last_lead_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_lead_sources_company_id_key" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."ad_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"range_from" date,
	"range_to" date,
	"rows" integer,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."ad_accounts" ADD CONSTRAINT "ad_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ad_accounts" ADD CONSTRAINT "ad_accounts_connection_fk" FOREIGN KEY ("company_id","connection_id") REFERENCES "app"."ad_connections"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ad_campaigns" ADD CONSTRAINT "ad_campaigns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ad_campaigns" ADD CONSTRAINT "ad_campaigns_account_fk" FOREIGN KEY ("company_id","ad_account_id") REFERENCES "app"."ad_accounts"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ad_connections" ADD CONSTRAINT "ad_connections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ad_connections" ADD CONSTRAINT "ad_connections_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ad_daily_metrics" ADD CONSTRAINT "ad_daily_metrics_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ad_daily_metrics" ADD CONSTRAINT "ad_daily_metrics_account_fk" FOREIGN KEY ("company_id","ad_account_id") REFERENCES "app"."ad_accounts"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ad_lead_events" ADD CONSTRAINT "ad_lead_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ad_lead_events" ADD CONSTRAINT "ad_lead_events_source_fk" FOREIGN KEY ("company_id","lead_source_id") REFERENCES "app"."ad_lead_sources"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ad_lead_sources" ADD CONSTRAINT "ad_lead_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ad_lead_sources" ADD CONSTRAINT "ad_lead_sources_connection_fk" FOREIGN KEY ("company_id","connection_id") REFERENCES "app"."ad_connections"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ad_sync_runs" ADD CONSTRAINT "ad_sync_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ad_sync_runs" ADD CONSTRAINT "ad_sync_runs_connection_fk" FOREIGN KEY ("company_id","connection_id") REFERENCES "app"."ad_connections"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_accounts_external_key" ON "app"."ad_accounts" USING btree ("company_id","platform","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_campaigns_external_key" ON "app"."ad_campaigns" USING btree ("company_id","ad_account_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_connections_platform_key" ON "app"."ad_connections" USING btree ("company_id","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_daily_metrics_key" ON "app"."ad_daily_metrics" USING btree ("company_id","ad_account_id","campaign_external_id","day");--> statement-breakpoint
CREATE INDEX "ad_daily_metrics_day_idx" ON "app"."ad_daily_metrics" USING btree ("company_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_lead_events_once_key" ON "app"."ad_lead_events" USING btree ("company_id","platform","external_lead_id");--> statement-breakpoint
CREATE INDEX "ad_lead_events_status_idx" ON "app"."ad_lead_events" USING btree ("company_id","status","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_lead_sources_meta_page_key" ON "app"."ad_lead_sources" USING btree ("platform","external_id") WHERE "app"."ad_lead_sources"."kind" = 'meta_page' and "app"."ad_lead_sources"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "ad_lead_sources_webhook_key" ON "app"."ad_lead_sources" USING btree ("webhook_key_hash") WHERE "app"."ad_lead_sources"."webhook_key_hash" is not null;--> statement-breakpoint
CREATE INDEX "ad_sync_runs_recent_idx" ON "app"."ad_sync_runs" USING btree ("company_id","started_at");