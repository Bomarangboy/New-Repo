# Architecture

Plain‑English summary first, technical detail after.

## In one paragraph

Bluewater Collective is **one web application** (Next.js) hosted on **Vercel**, with one **PostgreSQL
database** and sign‑in service hosted by **Supabase**. Every client company shares the same application but
sees only its own data: the server checks who you are, which company you belong to, your role, your package
and the account's status on every request, and the database itself independently refuses to show one
company's rows to another. Background work (acknowledgments, follow‑ups, syncs) is stored as jobs in the
database and processed every minute by a scheduled trigger, so it keeps running when every browser — and your
computer — is off. Outside services (Twilio for texts, Postmark for email, Meta/Google for ads, a scheduling
tool, a CRM) plug in through small "connector" modules, each of which can be simulated for development and
the sales demo.

```
 Browser (desktop/phone) ──HTTPS──► Vercel: Next.js app ─────────────► Supabase Postgres (app schema, RLS)
                                     │  pages, forms, API routes          ▲   jobs table, audit log
                                     │  /api/intake/* (webhooks)          │
                                     │  /api/jobs/run  ◄── every minute ── Supabase Cron (pg_cron + pg_net)
                                     ├──► Supabase Auth (sign‑in, MFA, password reset)
                                     └──► Connectors: Twilio · Postmark · Meta · Google Ads · Cal.com · CRM
                                            (each has a simulated twin for dev/demo)
 External uptime monitor ──► checks /api/health from outside; alerts you directly (not via our app)
```

## Components

| Part | Technology | Notes |
|---|---|---|
| Web app + API | Next.js 16 App Router, React 19, TypeScript | Server Components + Server Actions; no secrets in browser code |
| Styling | Tailwind CSS 4, Figtree font (self‑hosted), Lucide icons | Brand tokens in `src/app/globals.css` |
| Database | PostgreSQL 16 (Supabase) via Drizzle ORM | Migrations in `drizzle/`; tables in schema `app` |
| Sign‑in | Supabase Auth (prod) / local provider (dev & tests only) | `src/lib/auth/*` |
| Authorization | `src/lib/authz/*` | Roles, packages, account status — one code path |
| Background jobs | Postgres `jobs` table + Supabase Cron → `/api/jobs/run` | Stage 3 |
| System email | Postmark (dev: on‑screen mailbox) | Bluewater's own emails only |
| Client messaging | Twilio (SMS), Postmark (email) behind a transport interface | Stage 3; simulated in dev/demo |

## Security model

1. **Identity** — Supabase Auth verifies the password (and TOTP code if enrolled). The server verifies the
   signed token on every request (`getClaims()`), never trusting browser‑supplied data alone.
2. **User** — the identity is mapped to a Bluewater `users` row; disabled users and sign‑ins older than a
   "sign out everywhere" are rejected (`resolveUser`).
3. **Company context** — the browser may *suggest* a company (cookie), but access requires an **active
   membership** in the database, or for administrators a **live, time‑limited support grant** with MFA
   (`resolveCompanyContext`). A company ID from the browser is never proof of access.
4. **Role, package, status** — checked in the same function against `permissions.ts`, `entitlements.ts`,
   `account-policy.ts` (see PERMISSIONS.md).
5. **Database isolation** — the app connects as `bluewater_app`, which cannot bypass Row Level Security.
   `withCompanyDb` sets the verified company for the transaction; every policy compares rows to it. With no
   context, company tables appear empty. Restricted columns (package, status, admin flag) are protected by
   database triggers even inside a valid company context.
6. **Three doors only** — `withCompanyDb` (client screens), `withPlatformDb` (MFA‑verified admins),
   `withSystemDb` (sign‑in, webhooks, jobs; each call states its purpose). A test forbids the latter two in
   client workspace pages.
7. **Secrets** — environment variables only; integration tokens/MFA secrets encrypted with AES‑256‑GCM
   (`ENCRYPTION_KEY`); tokens/links stored only as SHA‑256 hashes; activity‑log details redacted
   automatically; error messages shown to users never include internals (`userMessage`).
8. **Activity log** — append‑only (the app role has no UPDATE/DELETE grant). Support access is recorded in
   the client's own log.
9. **Administrators** — MFA mandatory; created only from the command line (`npm run admin:create`), never
   through the website. Recovery of a lost admin second factor is a manual, documented procedure performed
   in the Supabase dashboard by the account owner — there is no "skip MFA" link.

## Data model (Stage 1)

`companies` (package, CRM mode, lifecycle, billing status, suspension, demo expiry — separate fields) ·
`users` · `memberships` (role, one active owner enforced by a unique index) · `invitations` (hashed,
single‑use, 7‑day) · `package_history` · `lifecycle_history` · `audit_log` · `support_access_grants` ·
local‑provider tables (`local_credentials`, `local_sessions`, `password_reset_tokens`) · `dev_outbox`.

Stage 2 (built): `contacts` (unique per company on normalized email / E.164 phone) · `inquiries` (stage,
assignee, sale value, tracking, external IDs, automation eligibility; child of contact via (company_id, id)) ·
`consent_records` (append-only evidence) · `notes` · `tasks` · `inquiry_events` (append-only history) ·
`intake_sources` (website form connections) · `intake_events` (every submission, unique per idempotency key) ·
`import_batches` (previewed → committed once). See INTAKE.md and METRICS.md. Stage 3 added `jobs`, `messaging_settings`, `message_templates` (versioned),
`company_senders` (encrypted provider tokens; platform-writable only), `conversations`, `messages`
(queued/sending/submitted/delivered/failed/unknown), `message_status_events` (append-only), `suppressions`
and `notifications` — all with forced RLS. Rules: MESSAGING.md.

Stage 4 added `sequences`, `sequence_steps` (versioned, append-only), `sequence_enrollments` (at most one open per
contact), `booking_settings` (encrypted Cal.com webhook secret, hashed address), `appointments` (one row kept across
reschedules) and `booking_events` (append-only webhook log) — all with forced RLS and composite company keys.
Rules: MESSAGING.md (follow-ups) and BOOKING.md.

Stage 5 added `ad_connections` (encrypted tokens), `ad_accounts`, `ad_lead_sources` (one active Facebook Page per
company, enforced by a global unique index), `ad_lead_events` (once per platform lead id), `ad_campaigns`,
`ad_daily_metrics` (unique per account/campaign/day; imports replace date ranges) and `ad_sync_runs`. Platform clients
implement one connector interface (`server/ads/clients/types.ts`) — live Meta, live Google, or simulated. ADS.md.

## Background processing (built in Stage 3, D‑07)

- A job row is written **in the same transaction** as the event that causes it (e.g. new inquiry ⇒
  acknowledgment job) — no lead without its job, no job without its lead.
- Every job has an **idempotency key** (e.g. `ack:<inquiry_id>`), a `run_after` time, attempts, and a lease.
  Workers claim with `FOR UPDATE SKIP LOCKED`, so two runs never process the same job.
- **Pre‑send check** inside the job, immediately before sending: contact replied? opted out? booked? closed?
  paused? company status allows sending? within sending window? already sent? Outdated jobs are cancelled,
  not sent. Accumulated follow‑ups after an outage are **expired**, not batch‑sent.
- Uncertain provider outcomes (timeout after submission) become `unknown` and are **reconciled** with the
  provider before any retry.
- Fairness: per‑company concurrency caps so one client can't monopolize processing.

## Lead intake (Stage 2, built)

`POST /api/intake/<form-key>`: identify form → verify signature or allowed website → rate limit → account status
(410 when closed) → duplicate check under a per-form lock → **store the raw submission and commit** → turn it into
a contact + inquiry in a second transaction (201), or report problems (422), or leave it stored for retry (202).
A fourth database door, `withSystemCompanyDb(companyId, purpose)`, is used for this: trusted server code acting
for one already-identified company, still limited to that company's rows by RLS. Details: INTAKE.md.

## External CRM connector contract (Stage 6; no connector live yet)

```ts
interface CrmConnector {
  id: string; displayName: string;
  capabilities: { pushLeads: boolean; pushActivity: boolean; pullStatus: boolean; pullBookings: boolean; pullSales: boolean };
  authorize(company): Promise<AuthorizationStart>;                 // OAuth where offered; never passwords
  upsertContact(company, contact, idempotencyKey): Promise<ExternalRef>;
  logActivity(company, externalRef, activity, idempotencyKey): Promise<void>;
  fetchChanges(company, cursor): Promise<{ changes: ExternalChange[]; nextCursor: string }>;
  verifyWebhook?(headers, rawBody): boolean;
}
```
Loop prevention: every outbound write records `origin=bluewater` + a change ID; inbound changes carrying our
own change ID are ignored; field‑level "last writer + timestamp" decides conflicts per a documented mapping.
The external CRM is the system of record in external mode.

## Operations (Stage 7)
- **Monitoring:** `server/ops/alerts.ts` runs inside the every‑minute maintenance step (advisory lock), stores grouped
  alerts in `ops_alerts` (one open row per key — database rule) and emails administrators on open/resolve only.
  `/api/health` is public and client‑free for the external uptime monitor.
- **Recovery controls:** `server/ops/controls.ts` (retry intake / ad leads, re‑import a date range, Bluewater automation
  pause, redacted diagnostics, ops evidence records). Late follow‑up steps (> 24 h) pause instead of sending.
- **Queue priorities:** `jobs.priority` (D‑40) ordered before `run_at` in the claim query.
- **Billing/usage:** `server/billing.ts`; `company_billing` + `invoices` are readable by the client's owner, writable only
  in the admin area (separate RLS policies; invoices have no DELETE grant).
- **Support:** `support_tickets` (company policy) and `support_ticket_messages` (client sees/writes only non‑internal,
  customer‑authored rows — enforced by RLS). `incident_notices` are platform‑only.
- **Deletion:** `app.purge_company_data()` is the only path that removes company data from append‑only tables. It is
  `SECURITY DEFINER`, refuses outside platform/system scope, and refuses unless the company is archived (or a demo
  prospect). A test fails if a new company table isn't explicitly deleted or kept.
- **Backups:** because RLS is *forced*, logical dumps run with `--enable-row-security` in system scope
  (`scripts/restore-test.ts`).

## Environments

See DECISIONS.md D‑12 and DEPLOYMENT.md. The **sales demo** is a separate deployment with a separate
database and `APP_ENV=demo`, which the server refuses to combine with live sending, and whose connectors are
forced to simulated mode in code (not just hidden in the interface).

## Known limitations (current)

- Supabase Auth path is not yet verified against a live project (sandbox could not run Supabase locally).
- Messaging (Stage 3) and follow-ups/booking (Stage 4) are built, but only the simulated transport and signed test
  webhooks have been exercised; Twilio/Postmark/Cal.com paths await accounts (MESSAGING.md, BOOKING.md). External CRM sync is not
  built (Stage 6). Operations tooling (Stage 7) is built; the hosted restore drill and load test run on staging at launch. Ad connections are simulated until approvals (ADS.md).
- Rate limiting: per‑form limit on website intake (30/min), account lockout (local) and Supabase's built‑in sign‑in limits.
  Edge rate limiting for other public endpoints is a Vercel Firewall setting to add at deployment (LAUNCH_CHECKLIST.md).
- Error tracking (Sentry) is not wired; outages are covered by `/api/health` + the external monitor and in‑app alerts.
