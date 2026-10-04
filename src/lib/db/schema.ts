import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  foreignKey,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
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

/* =====================================================================================
 * Stage 2 — built-in CRM and lead intake.
 * Every table carries company_id; child rows reference parents through (company_id, id)
 * composite keys, so a record can never point at another company's record.
 * ===================================================================================== */

export const pipelineStage = app.enum("pipeline_stage", ["new", "contacted", "booked", "won", "lost"]);
export const inquirySource = app.enum("inquiry_source", [
  "website_form", "manual", "csv_import", "meta_lead_form", "google_lead_form", "other",
]);
/**
 * Whether the automatic acknowledgment/follow-up may consider this inquiry (Stage 3).
 *  eligible  – arrived live through an intake source while the account allowed automation
 *  held      – arrived live while automation was off (onboarding/paused/suspended); never auto-sent later
 *  none      – manual entry, CSV import, backfill or sync; only an explicit enrollment can change this
 */
export const automationOrigin = app.enum("automation_origin", ["eligible", "held", "none"]);

export const contacts = app.table(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull().default(""),
    email: text("email"),
    /** Lower-cased, trimmed; used for duplicate detection. */
    emailNormalized: text("email_normalized"),
    phone: text("phone"),
    /** E.164 (+15551234567); used for duplicate detection. */
    phoneE164: text("phone_e164"),
    ...timestamps,
  },
  (t) => [
    unique("contacts_company_id_key").on(t.companyId, t.id),
    uniqueIndex("contacts_company_email_key").on(t.companyId, t.emailNormalized).where(sql`${t.emailNormalized} is not null`),
    uniqueIndex("contacts_company_phone_key").on(t.companyId, t.phoneE164).where(sql`${t.phoneE164} is not null`),
    index("contacts_company_name_idx").on(t.companyId, t.fullName),
  ],
);

/** One row per inquiry. Repeat inquiries from the same contact stay separate. */
export const inquiries = app.table(
  "inquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull(),
    source: inquirySource("source").notNull(),
    /** Human label, e.g. the website form's name. */
    sourceLabel: text("source_label"),
    intakeSourceId: uuid("intake_source_id"),
    serviceRequested: text("service_requested"),
    message: text("message"),
    /** When the person submitted it (as reported by the source). */
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    /** When Bluewater durably recorded it. */
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    stage: pipelineStage("stage").notNull().default("new"),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Recorded sale value in cents (USD). Null = no sale recorded (not zero). */
    saleValueCents: bigint("sale_value_cents", { mode: "number" }),
    saleCurrency: text("sale_currency").notNull().default("USD"),
    wonAt: timestamp("won_at", { withTimezone: true }),
    lostReason: text("lost_reason"),
    isRepeat: boolean("is_repeat").notNull().default(false),
    automationOrigin: automationOrigin("automation_origin").notNull().default("none"),
    /** utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, landing_page, referrer */
    tracking: jsonb("tracking").$type<Record<string, string>>().notNull().default({}),
    /** Platform identifiers when available: form_id, campaign_id, adset_id, ad_id, lead_id … */
    externalIds: jsonb("external_ids").$type<Record<string, string>>().notNull().default({}),
    importBatchId: uuid("import_batch_id"),
    ...timestamps,
  },
  (t) => [
    unique("inquiries_company_id_key").on(t.companyId, t.id),
    foreignKey({ columns: [t.companyId, t.contactId], foreignColumns: [contacts.companyId, contacts.id], name: "inquiries_contact_fk" }).onDelete("cascade"),
    index("inquiries_company_received_idx").on(t.companyId, t.receivedAt),
    index("inquiries_company_stage_idx").on(t.companyId, t.stage),
    index("inquiries_contact_idx").on(t.contactId),
  ],
);

/** Contact-permission evidence, captured at the moment it was given. */
export const consentRecords = app.table(
  "consent_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull(),
    inquiryId: uuid("inquiry_id"),
    channel: text("channel").notNull(), // sms | email
    purpose: text("purpose").notNull(), // inquiry_response | marketing
    granted: boolean("granted").notNull(),
    /** Exact wording shown to the person, if provided by the form. */
    statement: text("statement"),
    method: text("method").notNull(), // web_form_checkbox | lead_form | verbal_recorded_by_staff | import_attested
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    pageUrl: text("page_url"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.companyId, t.contactId], foreignColumns: [contacts.companyId, contacts.id], name: "consent_contact_fk" }).onDelete("cascade"),
    index("consent_contact_idx").on(t.companyId, t.contactId),
  ],
);

export const notes = app.table(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    inquiryId: uuid("inquiry_id").notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.companyId, t.inquiryId], foreignColumns: [inquiries.companyId, inquiries.id], name: "notes_inquiry_fk" }).onDelete("cascade"),
    index("notes_inquiry_idx").on(t.inquiryId),
  ],
);

export const tasks = app.table(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    inquiryId: uuid("inquiry_id").notNull(),
    title: text("title").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    foreignKey({ columns: [t.companyId, t.inquiryId], foreignColumns: [inquiries.companyId, inquiries.id], name: "tasks_inquiry_fk" }).onDelete("cascade"),
    index("tasks_company_open_idx").on(t.companyId, t.completedAt, t.dueAt),
  ],
);

/** Record history: every change to an inquiry, in order. */
export const inquiryEvents = app.table(
  "inquiry_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    inquiryId: uuid("inquiry_id").notNull(),
    type: text("type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorType: text("actor_type").notNull().default("user"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.companyId, t.inquiryId], foreignColumns: [inquiries.companyId, inquiries.id], name: "inquiry_events_inquiry_fk" }).onDelete("cascade"),
    index("inquiry_events_inquiry_idx").on(t.inquiryId, t.createdAt),
  ],
);

/** A configured way for leads to arrive (website form endpoint now; ad lead forms in Stage 5). */
export const intakeSources = app.table(
  "intake_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("website_form"),
    name: text("name").notNull(),
    /** Public identifier used in the intake URL. Not a secret (it appears in website code). */
    publicKey: text("public_key").notNull(),
    /** Optional HMAC secret for server-to-server submissions (encrypted). When set, signatures are required. */
    signingSecretEnc: text("signing_secret_enc"),
    allowedOrigins: jsonb("allowed_origins").$type<string[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    lastReceivedAt: timestamp("last_received_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("intake_sources_public_key_key").on(t.publicKey), index("intake_sources_company_idx").on(t.companyId)],
);

/**
 * Every submission received, written BEFORE we tell the sender "received".
 * The unique (source, idempotency_key) index makes retries and replays harmless.
 */
export const intakeEvents = app.table(
  "intake_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    intakeSourceId: uuid("intake_source_id").notNull().references(() => intakeSources.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    contentHash: text("content_hash").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("received"), // received | processed | rejected | failed
    error: text("error"),
    inquiryId: uuid("inquiry_id"),
    ipHash: text("ip_hash"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("intake_events_idempotency_key").on(t.intakeSourceId, t.idempotencyKey),
    index("intake_events_source_received_idx").on(t.intakeSourceId, t.receivedAt),
    index("intake_events_content_idx").on(t.intakeSourceId, t.contentHash, t.receivedAt),
  ],
);

/** CSV imports: validated and previewed first, committed once. */
export const importBatches = app.table(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    status: text("status").notNull().default("previewed"), // previewed | committed | cancelled
    rows: jsonb("rows").$type<unknown[]>().notNull().default([]),
    errors: jsonb("errors").$type<{ row: number; problems: string[] }[]>().notNull().default([]),
    totalRows: integer("total_rows").notNull().default(0),
    validRows: integer("valid_rows").notNull().default(0),
    createdCount: integer("created_count").notNull().default(0),
    matchedCount: integer("matched_count").notNull().default(0),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("import_batches_company_idx").on(t.companyId)],
);
