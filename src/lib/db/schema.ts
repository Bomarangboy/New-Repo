import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
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
  customType,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

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

/* =====================================================================================
 * Stage 3 — background jobs, messaging, inbox, opt-outs, team notifications.
 * ===================================================================================== */

/**
 * Durable background work. A job is written in the same transaction as the event that
 * causes it. `idempotency_key` makes enqueueing the same work twice harmless.
 */
export const jobs = app.table(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null only for platform-wide maintenance jobs. */
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull(),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("queued"), // queued | running | succeeded | failed | dead | cancelled
    /** Lower runs first when work piles up: 1 = lead intake & acknowledgments, 5 = normal, 8 = reporting imports. */
    priority: integer("priority").notNull().default(5),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    result: text("result"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("jobs_idempotency_key").on(t.idempotencyKey),
    index("jobs_due_idx").on(t.status, t.runAt),
    index("jobs_company_idx").on(t.companyId, t.status),
  ],
);

/** Per-company messaging configuration (owner-editable unless noted). */
export const messagingSettings = app.table("messaging_settings", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  ackEnabled: boolean("ack_enabled").notNull().default(true),
  /** Local minutes after midnight. Default 8:00–21:00. */
  windowStartMinute: integer("window_start_minute").notNull().default(480),
  windowEndMinute: integer("window_end_minute").notNull().default(1260),
  /** Days allowed, 0 = Sunday … 6 = Saturday. */
  windowDays: jsonb("window_days").$type<number[]>().notNull().default([0, 1, 2, 3, 4, 5, 6]),
  /** Who is told about new leads/replies. Empty = the lead's assignee, else every active owner. */
  notifyUserIds: jsonb("notify_user_ids").$type<string[]>().notNull().default([]),
  /** Package 3: weekly summary email to owners (Monday morning, company timezone). */
  weeklySummaryEnabled: boolean("weekly_summary_enabled").notNull().default(true),
  /** Emergency stop for ALL automatic messages of this company. */
  automationPaused: boolean("automation_paused").notNull().default(false),
  automationPausedReason: text("automation_paused_reason"),
  automationPausedAt: timestamp("automation_paused_at", { withTimezone: true }),
  ...timestamps,
});

/** Versioned message templates. Edits create a new version; sent messages record the version used. */
export const messageTemplates = app.table(
  "message_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    key: text("key").notNull(), // ack_sms | ack_email
    version: integer("version").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("message_templates_version_key").on(t.companyId, t.key, t.version)],
);

/**
 * The company's sending identities, configured by Bluewater (Bluewater-managed senders, D-06).
 * Secrets are encrypted and never sent to browsers. Live sending requires status = verified.
 */
export const companySenders = app.table(
  "company_senders",
  {
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(), // sms | email
    status: text("status").notNull().default("not_configured"), // not_configured | pending_verification | verified | disabled
    // SMS (Twilio subaccount per client)
    twilioAccountSid: text("twilio_account_sid"),
    twilioAuthTokenEnc: text("twilio_auth_token_enc"),
    messagingServiceSid: text("messaging_service_sid"),
    fromNumber: text("from_number"),
    // Email (Postmark server per client)
    postmarkServerTokenEnc: text("postmark_server_token_enc"),
    fromEmail: text("from_email"),
    fromName: text("from_name"),
    replyTo: text("reply_to"),
    /** SHA-256 of the secret path segment used for this company's Postmark webhooks. */
    webhookKeyHash: text("webhook_key_hash"),
    notes: text("notes"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("company_senders_key").on(t.companyId, t.channel),
    uniqueIndex("company_senders_twilio_key").on(t.twilioAccountSid).where(sql`${t.twilioAccountSid} is not null`),
    uniqueIndex("company_senders_webhook_key").on(t.webhookKeyHash).where(sql`${t.webhookKeyHash} is not null`),
  ],
);

/** One conversation thread per contact. */
export const conversations = app.table(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastHumanOutboundAt: timestamp("last_human_outbound_at", { withTimezone: true }),
    /** True when the contact wrote and nobody on the team has answered or marked it read. */
    needsReply: boolean("needs_reply").notNull().default(false),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("conversations_company_id_key").on(t.companyId, t.id),
    uniqueIndex("conversations_contact_key").on(t.companyId, t.contactId),
    foreignKey({ columns: [t.companyId, t.contactId], foreignColumns: [contacts.companyId, contacts.id], name: "conversations_contact_fk" }).onDelete("cascade"),
    index("conversations_recent_idx").on(t.companyId, t.lastMessageAt),
  ],
);

export const messages = app.table(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    inquiryId: uuid("inquiry_id"),
    direction: text("direction").notNull(), // outbound | inbound
    channel: text("channel").notNull(), // sms | email
    kind: text("kind").notNull(), // acknowledgment | manual | inbound | auto_reply | follow_up | booking_confirmation | booking_reminder
    /**
     * outbound: queued → sending → submitted → delivered | failed | unknown (uncertain; needs review) | skipped
     * inbound: received
     */
    status: text("status").notNull(),
    statusReason: text("status_reason"),
    toAddress: text("to_address").notNull(),
    fromAddress: text("from_address"),
    subject: text("subject"),
    body: text("body").notNull(),
    transport: text("transport").notNull(), // simulated | twilio | postmark
    providerMessageId: text("provider_message_id"),
    errorCode: text("error_code"),
    segments: integer("segments"),
    idempotencyKey: text("idempotency_key"),
    templateKey: text("template_key"),
    templateVersion: integer("template_version"),
    sentByUserId: uuid("sent_by_user_id").references(() => users.id, { onDelete: "set null" }),
    sendingStartedAt: timestamp("sending_started_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.companyId, t.conversationId], foreignColumns: [conversations.companyId, conversations.id], name: "messages_conversation_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.companyId, t.contactId], foreignColumns: [contacts.companyId, contacts.id], name: "messages_contact_fk" }).onDelete("cascade"),
    uniqueIndex("messages_idempotency_key").on(t.companyId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    uniqueIndex("messages_provider_key").on(t.transport, t.providerMessageId).where(sql`${t.providerMessageId} is not null`),
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
    index("messages_company_status_idx").on(t.companyId, t.status, t.createdAt),
    index("messages_inquiry_idx").on(t.inquiryId),
  ],
);

/** Every provider status/delivery report as received (append-only). */
export const messageStatusEvents = app.table(
  "message_status_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    providerStatus: text("provider_status"),
    errorCode: text("error_code"),
    applied: boolean("applied").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("message_status_events_message_idx").on(t.messageId)],
);

/** Addresses that must not receive messages from this company (opt-outs, bounces, complaints). */
export const suppressions = app.table(
  "suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(), // sms | email
    /** E.164 phone or lower-case email. */
    address: text("address").notNull(),
    reason: text("reason").notNull(), // opt_out_keyword | unsubscribe_link | hard_bounce | spam_complaint | manual
    detail: text("detail"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    liftedAt: timestamp("lifted_at", { withTimezone: true }),
    liftedReason: text("lifted_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("suppressions_active_key").on(t.companyId, t.channel, t.address).where(sql`${t.liftedAt} is null`),
  ],
);

/** Alerts to team members (new lead, reply, failed acknowledgment). */
export const notifications = app.table(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // new_lead | reply | ack_problem | booking_created | booking_rescheduled | booking_cancelled | follow_up_finished
    inquiryId: uuid("inquiry_id"),
    conversationId: uuid("conversation_id"),
    /** Distinguishes repeat events of one kind for the same lead (e.g. a second reschedule). */
    refKey: text("ref_key"),
    title: text("title").notNull(),
    emailStatus: text("email_status").notNull(), // sent | failed | skipped
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notifications_once_key").on(t.companyId, t.userId, t.kind, t.inquiryId, t.conversationId, t.refKey),
    index("notifications_user_idx").on(t.userId, t.readAt),
  ],
);

/* =====================================================================================
 * Stage 4: follow-up sequences, booking and appointments (Package 2+)
 * ===================================================================================== */

/**
 * A multi-step follow-up sequence. Editing creates a new VERSION of its steps; people already
 * enrolled finish the version they started on (D-26), so a change never alters a message mid-flight.
 */
export const sequences = app.table(
  "sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"), // active | off
    /** New eligible website leads are enrolled automatically (at most one such sequence per company). */
    autoEnroll: boolean("auto_enroll").notNull().default(false),
    currentVersion: integer("current_version").notNull().default(1),
    /** Stop when a team member messages the lead by hand (the person has taken over). */
    stopOnManualMessage: boolean("stop_on_manual_message").notNull().default(true),
    /** When the last step is sent without any reply, create a call-back task for the assigned person. */
    handoffTask: boolean("handoff_task").notNull().default(true),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique("sequences_company_id_key").on(t.companyId, t.id),
    uniqueIndex("sequences_one_auto_enroll").on(t.companyId).where(sql`${t.autoEnroll} and ${t.status} = 'active'`),
  ],
);

export const sequenceSteps = app.table(
  "sequence_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    sequenceId: uuid("sequence_id").notNull(),
    version: integer("version").notNull(),
    /** 0-based order within the version. */
    position: integer("position").notNull(),
    /** Wait after enrollment (first step) or after the previous step. */
    delayMinutes: integer("delay_minutes").notNull(),
    channel: text("channel").notNull(), // sms | email | sms_or_email
    smsBody: text("sms_body"),
    emailSubject: text("email_subject"),
    emailBody: text("email_body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.companyId, t.sequenceId], foreignColumns: [sequences.companyId, sequences.id], name: "sequence_steps_sequence_fk" }).onDelete("cascade"),
    uniqueIndex("sequence_steps_position_key").on(t.sequenceId, t.version, t.position),
  ],
);

/** One person's progress through a sequence for one inquiry. */
export const sequenceEnrollments = app.table(
  "sequence_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    sequenceId: uuid("sequence_id").notNull(),
    version: integer("version").notNull(),
    inquiryId: uuid("inquiry_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    status: text("status").notNull().default("active"), // active | paused | completed | stopped
    /** Index of the next step to send. */
    nextStep: integer("next_step").notNull().default(0),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    origin: text("origin").notNull(), // auto | manual
    enrolledByUserId: uuid("enrolled_by_user_id").references(() => users.id, { onDelete: "set null" }),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    /** Why it's paused when the system paused it (e.g. a step was delayed by an outage). */
    pauseReason: text("pause_reason"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Plain-language reason it stopped (reply, booking, opt-out, …). */
    stopReason: text("stop_reason"),
    stopCode: text("stop_code"), // replied | booked | opted_out | closed | manual_message | stopped_by_user | account | paused_all | package | sequence_off | sending_off
    ...timestamps,
  },
  (t) => [
    unique("sequence_enrollments_company_id_key").on(t.companyId, t.id),
    foreignKey({ columns: [t.companyId, t.sequenceId], foreignColumns: [sequences.companyId, sequences.id], name: "enrollments_sequence_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.companyId, t.inquiryId], foreignColumns: [inquiries.companyId, inquiries.id], name: "enrollments_inquiry_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.companyId, t.contactId], foreignColumns: [contacts.companyId, contacts.id], name: "enrollments_contact_fk" }).onDelete("cascade"),
    /** A person is in at most one running follow-up at a time. */
    uniqueIndex("enrollments_one_open_per_contact").on(t.companyId, t.contactId).where(sql`${t.status} in ('active','paused')`),
    index("enrollments_company_status_idx").on(t.companyId, t.status, t.nextRunAt),
    index("enrollments_inquiry_idx").on(t.inquiryId),
  ],
);

/** Booking tool connection and reminder settings (Cal.com, D-10). */
export const bookingSettings = app.table(
  "booking_settings",
  {
    companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("calcom"),
    /** Public booking page, e.g. https://cal.com/harbor-home/estimate */
    bookingUrl: text("booking_url"),
    /** Webhook signing secret (Bluewater generates it; the client pastes it into Cal.com). Encrypted. */
    webhookSecretEnc: text("webhook_secret_enc"),
    /** SHA-256 of the secret path segment in the webhook address. */
    webhookKeyHash: text("webhook_key_hash"),
    status: text("status").notNull().default("not_connected"), // not_connected | waiting_for_test | connected | error
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    confirmationsEnabled: boolean("confirmations_enabled").notNull().default(true),
    remindersEnabled: boolean("reminders_enabled").notNull().default(true),
    /** Minutes before the appointment. */
    reminderOffsetsMinutes: jsonb("reminder_offsets_minutes").$type<number[]>().notNull().default([1440, 120]),
    /** Cal.com already emails confirmations; Bluewater emails only if this is on. Texts are Bluewater's. */
    emailAlso: boolean("email_also").notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("booking_settings_webhook_key").on(t.webhookKeyHash).where(sql`${t.webhookKeyHash} is not null`)],
);

export const appointments = app.table(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    inquiryId: uuid("inquiry_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    /** calcom (Cal.com is authoritative) | manual (entered by the team; Bluewater is authoritative) | simulated */
    source: text("source").notNull(),
    externalId: text("external_id"),
    /** Earlier booking ids replaced by reschedules; late events about them are ignored. */
    replacedExternalIds: jsonb("replaced_external_ids").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("scheduled"), // scheduled | cancelled | completed | no_show
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    title: text("title"),
    location: text("location"),
    attendeeTimezone: text("attendee_timezone"),
    /** Time of the newest provider event applied; older (out-of-order) events are ignored. */
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique("appointments_company_id_key").on(t.companyId, t.id),
    foreignKey({ columns: [t.companyId, t.inquiryId], foreignColumns: [inquiries.companyId, inquiries.id], name: "appointments_inquiry_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.companyId, t.contactId], foreignColumns: [contacts.companyId, contacts.id], name: "appointments_contact_fk" }).onDelete("cascade"),
    uniqueIndex("appointments_external_key").on(t.companyId, t.source, t.externalId).where(sql`${t.externalId} is not null`),
    index("appointments_company_start_idx").on(t.companyId, t.startsAt),
    index("appointments_inquiry_idx").on(t.inquiryId),
  ],
);

/** Every booking-tool webhook as received (append-only). Identical re-deliveries are ignored. */
export const bookingEvents = app.table(
  "booking_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    triggerEvent: text("trigger_event").notNull(),
    externalId: text("external_id"),
    bodyHash: text("body_hash").notNull(),
    outcome: text("outcome").notNull(), // created | rescheduled | cancelled | ignored_stale | ignored_unknown | ping | error
    detail: text("detail"),
    appointmentId: uuid("appointment_id"),
    eventCreatedAt: timestamp("event_created_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("booking_events_once_key").on(t.companyId, t.bodyHash), index("booking_events_company_idx").on(t.companyId, t.receivedAt)],
);

/* =====================================================================================
 * Stage 5: advertising connections (Meta, Google Ads) — lead forms (all packages) and
 * ad reporting (Package 3). Tokens are encrypted; nothing here is readable by browsers.
 * ===================================================================================== */

/** One connection per platform per company, made by signing in to the platform (never with a password). */
export const adConnections = app.table(
  "ad_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // meta | google
    /** live = real platform API; simulated = sample data (development, test, demo only). */
    mode: text("mode").notNull(),
    status: text("status").notNull().default("connected"), // connected | needs_reconnect | error | disconnected
    /** Who/what is connected, as the platform names it (e.g. the Facebook user or Google account). */
    accountLabel: text("account_label"),
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    connectedByUserId: uuid("connected_by_user_id").references(() => users.id, { onDelete: "set null" }),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastSyncOkAt: timestamp("last_sync_ok_at", { withTimezone: true }),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("ad_connections_company_id_key").on(t.companyId, t.id),
    uniqueIndex("ad_connections_platform_key").on(t.companyId, t.platform),
  ],
);

/** Ad accounts visible through a connection; only "selected" ones are reported on. */
export const adAccounts = app.table(
  "ad_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull(),
    platform: text("platform").notNull(),
    /** act_123… (Meta) or a 10-digit customer id (Google). */
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    currency: text("currency"),
    timezone: text("timezone"),
    selected: boolean("selected").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    unique("ad_accounts_company_id_key").on(t.companyId, t.id),
    foreignKey({ columns: [t.companyId, t.connectionId], foreignColumns: [adConnections.companyId, adConnections.id], name: "ad_accounts_connection_fk" }).onDelete("cascade"),
    uniqueIndex("ad_accounts_external_key").on(t.companyId, t.platform, t.externalId),
  ],
);

/**
 * Where ad lead-form leads come from: a Facebook Page (its lead forms) or a Google lead-form webhook.
 * A Facebook Page can belong to only ONE company (global unique index), so a lead is never routed twice.
 */
export const adLeadSources = app.table(
  "ad_lead_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id"),
    platform: text("platform").notNull(), // meta | google
    kind: text("kind").notNull(), // meta_page | google_webhook
    externalId: text("external_id"),
    name: text("name").notNull(),
    mode: text("mode").notNull(), // live | simulated
    pageTokenEnc: text("page_token_enc"),
    /** SHA-256 of the secret path + google_key (Google webhook). */
    webhookKeyHash: text("webhook_key_hash"),
    googleKeyHash: text("google_key_hash"),
    active: boolean("active").notNull().default(true),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastLeadAt: timestamp("last_lead_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    unique("ad_lead_sources_company_id_key").on(t.companyId, t.id),
    foreignKey({ columns: [t.companyId, t.connectionId], foreignColumns: [adConnections.companyId, adConnections.id], name: "ad_lead_sources_connection_fk" }).onDelete("cascade"),
    uniqueIndex("ad_lead_sources_meta_page_key").on(t.platform, t.externalId).where(sql`${t.kind} = 'meta_page' and ${t.active}`),
    uniqueIndex("ad_lead_sources_webhook_key").on(t.webhookKeyHash).where(sql`${t.webhookKeyHash} is not null`),
  ],
);

/** Every lead notification from an ad platform, so a lead is recorded exactly once and failures can be retried. */
export const adLeadEvents = app.table(
  "ad_lead_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    leadSourceId: uuid("lead_source_id").notNull(),
    platform: text("platform").notNull(),
    externalLeadId: text("external_lead_id").notNull(),
    formId: text("form_id"),
    /** Google sends the lead's answers in the notification; kept only until processed. */
    payload: jsonb("payload").$type<Record<string, unknown> | null>(),
    status: text("status").notNull().default("received"), // received | recorded | failed | test | rejected
    isTest: boolean("is_test").notNull().default(false),
    via: text("via").notNull().default("webhook"), // webhook | reconcile | simulated
    inquiryId: uuid("inquiry_id"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.companyId, t.leadSourceId], foreignColumns: [adLeadSources.companyId, adLeadSources.id], name: "ad_lead_events_source_fk" }).onDelete("cascade"),
    uniqueIndex("ad_lead_events_once_key").on(t.companyId, t.platform, t.externalLeadId),
    index("ad_lead_events_status_idx").on(t.companyId, t.status, t.receivedAt),
  ],
);

export const adCampaigns = app.table(
  "ad_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    adAccountId: uuid("ad_account_id").notNull(),
    platform: text("platform").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    status: text("status"),
    ...timestamps,
  },
  (t) => [
    foreignKey({ columns: [t.companyId, t.adAccountId], foreignColumns: [adAccounts.companyId, adAccounts.id], name: "ad_campaigns_account_fk" }).onDelete("cascade"),
    uniqueIndex("ad_campaigns_external_key").on(t.companyId, t.adAccountId, t.externalId),
  ],
);

/**
 * Platform-reported daily numbers per campaign, in the AD ACCOUNT's currency and timezone.
 * Re-importing a day replaces it (platforms revise recent days), so totals never double count.
 */
export const adDailyMetrics = app.table(
  "ad_daily_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    adAccountId: uuid("ad_account_id").notNull(),
    platform: text("platform").notNull(),
    campaignExternalId: text("campaign_external_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    currency: text("currency").notNull(),
    /** Spend in millionths of the currency unit (exact; no floating point). */
    spendMicros: bigint("spend_micros", { mode: "number" }).notNull(),
    impressions: bigint("impressions", { mode: "number" }).notNull(),
    clicks: bigint("clicks", { mode: "number" }).notNull(),
    /** Leads the platform counts for itself (lead forms). Null = not reported (not zero). */
    platformLeads: integer("platform_leads"),
    /** The platform's own conversion count (its definition). Null = not reported. */
    platformConversions: doublePrecision("platform_conversions"),
    mode: text("mode").notNull(), // live | simulated
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.companyId, t.adAccountId], foreignColumns: [adAccounts.companyId, adAccounts.id], name: "ad_daily_metrics_account_fk" }).onDelete("cascade"),
    uniqueIndex("ad_daily_metrics_key").on(t.companyId, t.adAccountId, t.campaignExternalId, t.day),
    index("ad_daily_metrics_day_idx").on(t.companyId, t.day),
  ],
);

/** History of imports (shown as "last updated" and used to diagnose problems). */
export const adSyncRuns = app.table(
  "ad_sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull(),
    kind: text("kind").notNull(), // metrics | leads_reconcile
    status: text("status").notNull(), // running | succeeded | failed
    rangeFrom: date("range_from", { mode: "string" }),
    rangeTo: date("range_to", { mode: "string" }),
    rows: integer("rows"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.companyId, t.connectionId], foreignColumns: [adConnections.companyId, adConnections.id], name: "ad_sync_runs_connection_fk" }).onDelete("cascade"),
    index("ad_sync_runs_recent_idx").on(t.companyId, t.startedAt),
  ],
);

/* =====================================================================================
 * Stage 7: operations — alerts, usage & billing, support, notices, retention, recovery records
 * ===================================================================================== */

/** Platform-wide settings administrators can change (e.g. unit prices for cost estimates). Platform-only. */
export const platformSettings = app.table("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Problems Bluewater should know about, opened and resolved automatically by the maintenance check.
 * One email when it opens, one "recovered" email when it resolves (grouped by key, never repeated each minute).
 */
export const opsAlerts = app.table(
  "ops_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    severity: text("severity").notNull(), // warning | critical
    title: text("title").notNull(),
    detail: text("detail"),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("open"), // open | resolved
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    recoveryNotifiedAt: timestamp("recovery_notified_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("ops_alerts_open_key").on(t.key).where(sql`${t.status} = 'open'`), index("ops_alerts_recent_idx").on(t.status, t.lastSeenAt)],
);

/** Commercial terms and usage limits per company (manual billing; nothing is charged automatically). */
export const companyBilling = app.table("company_billing", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  monthlyPriceCents: bigint("monthly_price_cents", { mode: "number" }),
  billingEmail: text("billing_email"),
  /** Texts (segments) per calendar month; null = no limit. */
  smsMonthlyLimit: integer("sms_monthly_limit"),
  emailMonthlyLimit: integer("email_monthly_limit"),
  /** warn = alert only; pause_automatic = automatic texts stop (emails/manual replies continue, leads always captured). */
  limitMode: text("limit_mode").notNull().default("warn"),
  graceDays: integer("grace_days").notNull().default(14),
  notes: text("notes"),
  ...timestamps,
});

/** Manual invoice records (Bluewater bills outside the app at first). Kept even if a company's data is deleted. */
export const invoices = app.table(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    reference: text("reference").notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("sent"), // sent | paid | failed | void
    dueDate: date("due_date", { mode: "string" }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("invoices_reference_key").on(t.reference), index("invoices_company_idx").on(t.companyId, t.periodStart)],
);

/** Customer support requests. Company-scoped; internal notes are never visible to the client. */
export const supportTickets = app.table(
  "support_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    /** Human reference, e.g. BW-1042 (unique across the platform). */
    reference: text("reference").notNull(),
    subject: text("subject").notNull(),
    category: text("category").notNull().default("question"), // question | problem | billing | urgent
    status: text("status").notNull().default("open"), // open | waiting_on_customer | resolved | closed
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    assignedAdminId: uuid("assigned_admin_id").references(() => users.id, { onDelete: "set null" }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    unique("support_tickets_company_id_key").on(t.companyId, t.id),
    uniqueIndex("support_tickets_reference_key").on(t.reference),
    index("support_tickets_status_idx").on(t.status, t.lastActivityAt),
  ],
);

export const supportTicketMessages = app.table(
  "support_ticket_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    authorType: text("author_type").notNull(), // customer | bluewater
    body: text("body").notNull(),
    /** Bluewater-only note (row-level security hides it from the client). */
    internal: boolean("internal").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.companyId, t.ticketId], foreignColumns: [supportTickets.companyId, supportTickets.id], name: "ticket_messages_ticket_fk" }).onDelete("cascade"),
    index("ticket_messages_ticket_idx").on(t.ticketId, t.createdAt),
  ],
);

/** Service notices to clients (outages, maintenance). Drafted, recipients reviewed, then sent. Platform-only. */
export const incidentNotices = app.table("incident_notices", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  audience: text("audience").notNull(), // all_active | selected
  companyIds: jsonb("company_ids").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("draft"), // draft | sent | cancelled
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  sentByUserId: uuid("sent_by_user_id").references(() => users.id, { onDelete: "set null" }),
  recipientCount: integer("recipient_count"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  ...timestamps,
});

/** Record of a company's data being deleted (kept after the deletion, with what was removed). Platform-only. */
export const dataDeletions = app.table("data_deletions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  companyName: text("company_name").notNull(),
  requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  summary: jsonb("summary").$type<Record<string, number>>().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Evidence of operational checks: backups verified, restore tests, load tests, deployment checks. Platform-only. */
export const opsRecords = app.table(
  "ops_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(), // backup_check | restore_test | load_test | deploy_check
    result: text("result").notNull(), // passed | failed | partial
    environment: text("environment").notNull(),
    summary: text("summary").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, { onDelete: "set null" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ops_records_kind_idx").on(t.kind, t.recordedAt)],
);


/* ======================= Platform Studio (appearance & content) ======================= */

/**
 * Studio configuration is stored per SCOPE: "platform" (defaults), "package:<tier>" or "company:<uuid>".
 * Each scope holds only the values set at that level (overrides); the effective configuration is the
 * platform defaults, then the package's, then the company's. Drafts are platform-only; published rows are
 * readable by the company they apply to (and platform/package rows by everyone) so pages can render them.
 */
export const studioDrafts = app.table("studio_drafts", {
  scopeKey: text("scope_key").primaryKey(),
  scopeKind: text("scope_kind").notNull(), // platform | package | company
  packageTier: packageTier("package_tier"),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  /** Optimistic lock: every save must name the revision it started from. */
  revision: integer("revision").notNull().default(0),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const studioPublished = app.table("studio_published", {
  scopeKey: text("scope_key").primaryKey(),
  scopeKind: text("scope_kind").notNull(),
  packageTier: packageTier("package_tier"),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  version: integer("version").notNull(),
  publishedByUserId: uuid("published_by_user_id").references(() => users.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Every publication, kept forever (restore copies one back into the draft). Platform-only, append-only. */
export const studioVersions = app.table(
  "studio_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeKey: text("scope_key").notNull(),
    version: integer("version").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    summary: text("summary").notNull(),
    changes: jsonb("changes").$type<string[]>().notNull().default([]),
    schemaVersion: integer("schema_version").notNull().default(1),
    publishedByUserId: uuid("published_by_user_id").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("studio_versions_scope_version").on(t.scopeKey, t.version)],
);

/** Logos and favicon (validated raster images only; never SVG or anything executable). Platform-only. */
export const studioAssets = app.table("studio_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(), // logo_light | logo_dark | favicon
  mime: text("mime").notNull(),
  bytes: bytea("bytes").notNull(),
  sha256: text("sha256").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ======================= Sequence Library ======================= */

export const libraryCategories = app.table("library_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A reusable acknowledgment template or follow-up sequence curated by Bluewater. */
export const libraryTemplates = app.table(
  "library_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    kind: text("kind").notNull(), // acknowledgment | sequence
    name: text("name").notNull(),
    description: text("description").notNull(),
    industry: text("industry").notNull(),
    objective: text("objective").notNull(),
    categoryId: uuid("category_id").references(() => libraryCategories.id, { onDelete: "set null" }),
    channels: jsonb("channels").$type<string[]>().notNull().default([]),
    stepCount: integer("step_count").notNull().default(1),
    durationDays: integer("duration_days").notNull().default(0),
    requiredPackage: packageTier("required_package").notNull(),
    requiredIntegrations: jsonb("required_integrations").$type<string[]>().notNull().default([]),
    requiredFields: jsonb("required_fields").$type<string[]>().notNull().default([]),
    recommended: boolean("recommended").notNull().default(false),
    /** draft (never shown to clients) | published | paused (emergency) | retired (no new copies) */
    status: text("status").notNull().default("draft"),
    latestVersion: integer("latest_version"),
    statusReason: text("status_reason"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("library_templates_status_idx").on(t.status)],
);

/** Work-in-progress content for the next version. Platform-only (clients never see unpublished text). */
export const libraryTemplateDrafts = app.table("library_template_drafts", {
  templateId: uuid("template_id").primaryKey().references(() => libraryTemplates.id, { onDelete: "cascade" }),
  definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
  revision: integer("revision").notNull().default(0),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Published versions never change (copies record which one they came from). */
export const libraryTemplateVersions = app.table(
  "library_template_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id").notNull().references(() => libraryTemplates.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
    changelog: text("changelog"),
    publishedByUserId: uuid("published_by_user_id").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("library_template_versions_key").on(t.templateId, t.version)],
);

/**
 * Aggregate, de-identified outcome evidence for a template (computed by an administrator from real customer
 * use; simulated, demo and test activity excluded). Shown to clients only when published AND above the
 * minimum sample. Holds no company or person identifiers.
 */
export const libraryEvidence = app.table("library_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id").notNull().references(() => libraryTemplates.id, { onDelete: "cascade" }),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  industry: text("industry"),
  leadSource: text("lead_source"),
  companies: integer("companies").notNull(),
  enrolled: integer("enrolled").notNull(),
  messagesSent: integer("messages_sent").notNull(),
  delivered: integer("delivered").notNull(),
  failed: integer("failed").notNull(),
  replied: integer("replied").notNull(),
  booked: integer("booked").notNull(),
  optedOut: integer("opted_out").notNull(),
  published: boolean("published").notNull().default(false),
  computedByUserId: uuid("computed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A company's private copy of a library template (company-owned; editing never touches the original). */
export const libraryCopies = app.table(
  "library_copies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").notNull().references(() => libraryTemplates.id, { onDelete: "restrict" }),
    templateVersion: integer("template_version").notNull(),
    kind: text("kind").notNull(), // acknowledgment | sequence
    /** For sequences: the company's own sequence created from the template (edited in the normal editor). */
    sequenceId: uuid("sequence_id"),
    /** For acknowledgments: the draft wording until it is activated. */
    draft: jsonb("draft").$type<Record<string, unknown>>().notNull().default({}),
    /** Owner confirmations from the setup checklist. */
    setup: jsonb("setup").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("draft"), // draft | active | archived
    /** Acknowledgment versions in use before activation (for an emergency rollback). */
    previous: jsonb("previous").$type<Record<string, unknown>>().notNull().default({}),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    activatedByUserId: uuid("activated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique("library_copies_company_id_key").on(t.companyId, t.id),
    uniqueIndex("library_copies_sequence_key").on(t.sequenceId),
    foreignKey({ columns: [t.companyId, t.sequenceId], foreignColumns: [sequences.companyId, sequences.id], name: "library_copies_sequence_fk" }).onDelete("cascade"),
    index("library_copies_template_idx").on(t.templateId),
  ],
);
