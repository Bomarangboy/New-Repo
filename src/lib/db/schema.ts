import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  integer,
} from "drizzle-orm/pg-core";

/**
 * All application tables live in the `app` schema, not `public`.
 * Supabase automatically exposes `public` through its browser-facing Data API;
 * keeping our tables elsewhere means that API can never reach them, and Row Level
 * Security (see drizzle/0001_security.sql) is a second, independent barrier.
 *
 * Every company-owned table carries `company_id` and is protected by RLS policies
 * that only show rows for the company selected in the current database transaction.
 */
export const app = pgSchema("app");

export const packageTier = app.enum("package_tier", ["instant_response", "follow_up_booking", "performance_reporting"]);
export const crmMode = app.enum("crm_mode", ["unselected", "built_in", "external"]);
export const lifecycleStatus = app.enum("lifecycle_status", ["onboarding", "active", "paused", "churned", "archived"]);
export const billingStatus = app.enum("billing_status", ["not_billed", "manual_current", "manual_past_due", "cancelled"]);
export const companyKind = app.enum("company_kind", ["customer", "internal_test", "demo_template", "demo_prospect"]);
export const memberRole = app.enum("member_role", ["owner", "employee"]);
export const membershipStatus = app.enum("membership_status", ["active", "removed"]);
export const userStatus = app.enum("user_status", ["active", "disabled"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const companies = app.table(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: companyKind("kind").notNull().default("customer"),
    timezone: text("timezone").notNull().default("America/New_York"),
    package: packageTier("package").notNull().default("instant_response"),
    crmMode: crmMode("crm_mode").notNull().default("unselected"),
    lifecycleStatus: lifecycleStatus("lifecycle_status").notNull().default("onboarding"),
    billingStatus: billingStatus("billing_status").notNull().default("not_billed"),
    /** Technical suspension is separate from lifecycle and billing (see docs/PERMISSIONS.md). */
    suspended: boolean("suspended").notNull().default(false),
    suspendedReason: text("suspended_reason"),
    serviceStartDate: timestamp("service_start_date", { withTimezone: true }),
    cancellationRequestedAt: timestamp("cancellation_requested_at", { withTimezone: true }),
    serviceEndsAt: timestamp("service_ends_at", { withTimezone: true }),
    churnReason: text("churn_reason"),
    adminNotes: text("admin_notes"),
    /** Demo workspaces expire and are cleaned up automatically. */
    demoExpiresAt: timestamp("demo_expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("companies_slug_key").on(t.slug), index("companies_lifecycle_idx").on(t.lifecycleStatus)],
);

export const users = app.table(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The identity provider's user id (Supabase Auth user id, or local provider id). */
    authUserId: text("auth_user_id").notNull(),
    email: text("email").notNull(),
    fullName: text("full_name").notNull().default(""),
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    status: userStatus("status").notNull().default("active"),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    /** Any sign-in that happened before this moment is rejected ("sign out everywhere"). */
    sessionsRevokedAt: timestamp("sessions_revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_auth_user_id_key").on(t.authUserId), uniqueIndex("users_email_key").on(sql`lower(${t.email})`)],
);

export const memberships = app.table(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull(),
    status: membershipStatus("status").notNull().default("active"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("memberships_company_user_key").on(t.companyId, t.userId),
    index("memberships_user_idx").on(t.userId),
    // A company has at most one active owner at a time.
    uniqueIndex("memberships_one_owner_key").on(t.companyId).where(sql`${t.role} = 'owner' and ${t.status} = 'active'`),
  ],
);

export const invitations = app.table(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: memberRole("role").notNull(),
    /** SHA-256 of the token in the emailed link. The raw token is never stored. */
    tokenHash: text("token_hash").notNull(),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("invitations_token_hash_key").on(t.tokenHash), index("invitations_company_idx").on(t.companyId)],
);

export const packageHistory = app.table(
  "package_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    fromPackage: packageTier("from_package"),
    toPackage: packageTier("to_package").notNull(),
    changedByUserId: uuid("changed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("package_history_company_idx").on(t.companyId)],
);

/** Lifecycle changes (onboarding → active → churned …) including reactivations. */
export const lifecycleHistory = app.table(
  "lifecycle_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    fromStatus: lifecycleStatus("from_status"),
    toStatus: lifecycleStatus("to_status").notNull(),
    reason: text("reason"),
    changedByUserId: uuid("changed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lifecycle_history_company_idx").on(t.companyId)],
);

/**
 * Append-only record of important changes. The application database role may
 * insert and read, but never update or delete (enforced by grants).
 * Never store secrets or message bodies in `details`.
 */
export const auditLog = app.table(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorType: text("actor_type").notNull(), // user | platform_admin | support | system
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_company_created_idx").on(t.companyId, t.createdAt), index("audit_created_idx").on(t.createdAt)],
);

/**
 * Time-limited, reason-required access by a platform administrator to one
 * company's workspace. Visible to the company in its activity log.
 */
export const supportAccessGrants = app.table(
  "support_access_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    adminUserId: uuid("admin_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    readOnly: boolean("read_only").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("support_grants_admin_idx").on(t.adminUserId, t.companyId)],
);

/* ---------- Local development identity provider (development/test only) ---------- */

/**
 * Mirrors what Supabase Auth keeps in its own `auth` schema: the identity exists
 * independently of the Bluewater `users` row and is linked by `auth_user_id`.
 */
export const localCredentials = app.table(
  "local_credentials",
  {
    authUserId: text("auth_user_id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** Encrypted TOTP secret (AES-256-GCM). */
    totpSecretEnc: text("totp_secret_enc"),
    /** New secret awaiting its first valid code; the active factor is untouched until then. */
    pendingTotpSecretEnc: text("pending_totp_secret_enc"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    /** Last accepted TOTP time-step, so a code can't be replayed. */
    totpLastStep: integer("totp_last_step"),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("local_credentials_email_key").on(sql`lower(${t.email})`)],
);

export const localSessions = app.table(
  "local_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authUserId: text("auth_user_id").notNull().references(() => localCredentials.authUserId, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /** 1 = password only, 2 = password + verified second factor. */
    aal: integer("aal").notNull().default(1),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("local_sessions_token_key").on(t.tokenHash), index("local_sessions_user_idx").on(t.authUserId)],
);

export const passwordResetTokens = app.table("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  authUserId: text("auth_user_id").notNull().references(() => localCredentials.authUserId, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Development/test/demo "mailbox": system emails (invitations, password resets)
 * are written here instead of being sent. Never used in production.
 */
export const devOutbox = app.table("dev_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  toAddress: text("to_address").notNull(),
  subject: text("subject").notNull(),
  textBody: text("text_body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
