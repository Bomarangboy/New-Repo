CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TYPE "app"."billing_status" AS ENUM('not_billed', 'manual_current', 'manual_past_due', 'cancelled');--> statement-breakpoint
CREATE TYPE "app"."company_kind" AS ENUM('customer', 'internal_test', 'demo_template', 'demo_prospect');--> statement-breakpoint
CREATE TYPE "app"."crm_mode" AS ENUM('unselected', 'built_in', 'external');--> statement-breakpoint
CREATE TYPE "app"."lifecycle_status" AS ENUM('onboarding', 'active', 'paused', 'churned', 'archived');--> statement-breakpoint
CREATE TYPE "app"."member_role" AS ENUM('owner', 'employee');--> statement-breakpoint
CREATE TYPE "app"."membership_status" AS ENUM('active', 'removed');--> statement-breakpoint
CREATE TYPE "app"."package_tier" AS ENUM('instant_response', 'follow_up_booking', 'performance_reporting');--> statement-breakpoint
CREATE TYPE "app"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "app"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"actor_user_id" uuid,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" "app"."company_kind" DEFAULT 'customer' NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"package" "app"."package_tier" DEFAULT 'instant_response' NOT NULL,
	"crm_mode" "app"."crm_mode" DEFAULT 'unselected' NOT NULL,
	"lifecycle_status" "app"."lifecycle_status" DEFAULT 'onboarding' NOT NULL,
	"billing_status" "app"."billing_status" DEFAULT 'not_billed' NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"suspended_reason" text,
	"service_start_date" timestamp with time zone,
	"cancellation_requested_at" timestamp with time zone,
	"service_ends_at" timestamp with time zone,
	"churn_reason" text,
	"admin_notes" text,
	"demo_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."dev_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"text_body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "app"."member_role" NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."lifecycle_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"from_status" "app"."lifecycle_status",
	"to_status" "app"."lifecycle_status" NOT NULL,
	"reason" text,
	"changed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."local_credentials" (
	"auth_user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_enc" text,
	"pending_totp_secret_enc" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"totp_last_step" integer,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."local_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"aal" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "app"."member_role" NOT NULL,
	"status" "app"."membership_status" DEFAULT 'active' NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."package_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"from_package" "app"."package_tier",
	"to_package" "app"."package_tier" NOT NULL,
	"changed_by_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "app"."support_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"read_only" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" text NOT NULL,
	"email" text NOT NULL,
	"full_name" text DEFAULT '' NOT NULL,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"status" "app"."user_status" DEFAULT 'active' NOT NULL,
	"last_sign_in_at" timestamp with time zone,
	"sessions_revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."audit_log" ADD CONSTRAINT "audit_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."invitations" ADD CONSTRAINT "invitations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."invitations" ADD CONSTRAINT "invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lifecycle_history" ADD CONSTRAINT "lifecycle_history_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lifecycle_history" ADD CONSTRAINT "lifecycle_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_sessions" ADD CONSTRAINT "local_sessions_auth_user_id_local_credentials_auth_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "app"."local_credentials"("auth_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD CONSTRAINT "memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."package_history" ADD CONSTRAINT "package_history_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."package_history" ADD CONSTRAINT "package_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_auth_user_id_local_credentials_auth_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "app"."local_credentials"("auth_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_access_grants" ADD CONSTRAINT "support_access_grants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_access_grants" ADD CONSTRAINT "support_access_grants_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_company_created_idx" ON "app"."audit_log" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "app"."audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_slug_key" ON "app"."companies" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "companies_lifecycle_idx" ON "app"."companies" USING btree ("lifecycle_status");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "app"."invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_company_idx" ON "app"."invitations" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "lifecycle_history_company_idx" ON "app"."lifecycle_history" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "local_credentials_email_key" ON "app"."local_credentials" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "local_sessions_token_key" ON "app"."local_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "local_sessions_user_idx" ON "app"."local_sessions" USING btree ("auth_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_company_user_key" ON "app"."memberships" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "app"."memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_one_owner_key" ON "app"."memberships" USING btree ("company_id") WHERE "app"."memberships"."role" = 'owner' and "app"."memberships"."status" = 'active';--> statement-breakpoint
CREATE INDEX "package_history_company_idx" ON "app"."package_history" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "support_grants_admin_idx" ON "app"."support_access_grants" USING btree ("admin_user_id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_user_id_key" ON "app"."users" USING btree ("auth_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "app"."users" USING btree (lower("email"));