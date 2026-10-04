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

Stage 2 adds contacts, inquiries (repeat inquiries kept distinct), notes, tasks, sources/tracking, intake
events with idempotency keys. Stage 3 adds conversations, messages (queued/submitted/delivered/failed/unknown),
templates, suppressions, consent records, jobs.

## Background processing design (Stage 3, decided in D‑07)

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

## Lead intake (Stage 2)

`POST /api/intake/<company-intake-key>` for website forms: validates input, records the raw event and an
idempotency key **before** acknowledging receipt (never ack what isn't durably stored), deduplicates the
contact, keeps each inquiry as a separate record, and preserves UTM/click identifiers. Imports/backfills
never trigger messaging automatically.

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

## Environments

See DECISIONS.md D‑12 and DEPLOYMENT.md. The **sales demo** is a separate deployment with a separate
database and `APP_ENV=demo`, which the server refuses to combine with live sending, and whose connectors are
forced to simulated mode in code (not just hidden in the interface).

## Known limitations (current)

- Supabase Auth path is not yet verified against a live project (sandbox could not run Supabase locally).
- Leads, messaging, automations, booking, reporting and the demo dataset are not built yet (Stages 2–7).
- No rate limiting on sign‑in beyond account lockout (local) / Supabase's built‑in limits; Stage 7 adds
  edge rate limiting for public endpoints.
