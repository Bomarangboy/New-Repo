# Implementation Plan & Status

Statuses (from the specification): **Implemented and verified** · **Implemented, awaiting live verification** ·
**Simulated for demo** · **Blocked** · **Deferred** · **Planned**.
"Verified" means automated tests and/or a real browser run against a real database in this repository —
not a provider's live service unless stated.

## Stage overview

| Stage | Scope | Status |
|---|---|---|
| 1 | Architecture, project setup, authentication, company isolation, permissions, admin company management | **Done** (live Supabase check pending) |
| 2 | Company lifecycle details, built‑in CRM (contacts, inquiries, notes, tasks, pipeline), website intake, CSV import, basic dashboard, demo dataset v1 | **Done** |
| 3 | Messaging (templates, acknowledgment, notifications), two‑way inbox, durable jobs, stop rules, opt‑outs, suppression | Next |
| 4 | Follow‑up sequences, sending windows, booking connector (D‑10), reminders | Planned |
| 5 | Meta & Google connectors (lead forms + reporting), reporting definitions | Planned; live use **blocked** by platform approvals |
| 6 | First external CRM connector (D‑11) | Planned; waits for first client |
| 7 | Billing/usage tooling, Health & Recovery Center, playbooks, backups & restore test, load test, deployment readiness | Planned |

The sales demo grows with each stage (foundation is in Stage 1–2).

---

## Stage 1 checklist

### Implemented and verified
- [x] Project setup: Next.js 16, TypeScript strict, Tailwind 4, ESLint, Vitest, Playwright; production build passes.
- [x] Database schema + migrations (`drizzle/0000_init.sql`, `0001_security.sql`).
- [x] Row Level Security on every table; app role cannot bypass it — **tests:** `tests/integration/isolation.test.ts`
      (no‑context sees nothing; company A cannot read/insert/update/move rows into B; restricted columns; append‑only log; no context leakage between transactions). Mutation‑checked: disabling isolation makes 6 tests fail.
- [x] Server authorization: membership, role, package, account status, MFA — **tests:** `authorization.test.ts` (20+ cases incl. forged company IDs, support grants, expired grants, revoked sessions).
- [x] Roles: platform administrator / owner / employee + time‑limited support access; role×action table in PERMISSIONS.md (generated from code; test fails if out of date).
- [x] Package entitlement matrix enforced on server (Package 1 blocked from sequences/booking/reports even by direct URL — browser test).
- [x] Account‑status behavior matrix (onboarding/active/paused/churned/archived + suspension + demo expiry).
- [x] Sign‑in, sign‑out, account lockout after 5 failures (local), password reset (single‑use, ends other sessions), change password.
- [x] Two‑step verification (TOTP): enrollment with QR, replay protection, mandatory for administrators, enforced before any workspace access.
- [x] "Sign out everywhere" (provider‑independent revocation timestamp).
- [x] Invitations: admin → owner, owner → employee; hashed single‑use 7‑day links; re‑invite replaces; revoke; wrong‑account protection.
- [x] Employee offboarding (access ends on next request — browser test), ownership transfer (confirmation + recent sign‑in).
- [x] Company settings (name, timezone), CRM mode choice (external CRM labeled unavailable).
- [x] Activity log (client view + admin view), support sessions visible to the client.
- [x] Admin area: All Customers directory with lifecycle filters & search, create company, package change with history, lifecycle changes with history/reactivation/churn reason, technical suspension, owner invitation, support access.
- [x] Onboarding checklist computed from real data (Ready / Pending / Needs attention / Not applicable).
- [x] Responsive interface matching the approved mockup & wordmark (desktop and phone screenshots reviewed).
- [x] Configuration safety: local login refused on hosted/non‑dev environments; demo can never enable live sending; production requires real email transport.
- [x] Open‑redirect protection, safe error messages with reference IDs, security headers.

### Implemented, awaiting live verification
- [ ] Supabase Auth provider (`src/lib/auth/supabase.ts`) + session refresh (`proxy.ts`) — needs a Supabase project.
- [ ] Postmark system email transport — needs a Postmark account and verified domain.
- [ ] Migrations on Supabase incl. custom `bluewater_app` role through the pooler.

### Blocked / needs your input
- [ ] D‑13 budgets, D‑14 support hours, D‑10 booking tool, D‑18 legal review (see DECISIONS.md).

### Simulated
- System emails in development/test/demo go to the on‑screen development mailbox (`/dev/mailbox`, dev/test only).

## Verification commands

```bash
npm run typecheck && npm run lint      # static checks
npm test                               # unit + integration (needs local PostgreSQL)
npm run build                          # production build
PW_CHROMIUM_PATH=... npm run test:e2e   # browser tests against a fresh database
```
Last run: see the Stage 2 verification below.

## Stage 2 checklist

### Implemented and verified
- [x] CRM schema: contacts, inquiries (each submission kept), consent evidence, notes, tasks, record history,
      website form connections, submission log, import batches — RLS forced on all; child records reference
      parents by (company, id) so they cannot point at another company's records; leads/tasks can only be
      assigned to active members (database rule); history and consent are append‑only.
      **Tests:** `tests/integration/crm.test.ts` (cross‑company read/attach/assign attempts, append‑only).
- [x] Duplicate detection: email (case‑insensitive) or phone (any US format → one standard form); repeat
      inquiries kept separate and flagged; safe updates (fill blanks, never overwrite; differences noted in history);
      email/phone belonging to two contacts is flagged for review.
- [x] Website form intake `POST /api/intake/<key>` (JSON or HTML form): stored before acknowledging; Idempotency‑Key
      and 10‑minute identical‑content duplicate protection; per‑form serialization (race reproduced deterministically
      in a test and mutation‑checked); allowed‑websites list; optional HMAC signatures with 5‑minute replay window;
      spam trap; 30/minute rate limit with Retry‑After; closed accounts answer 410; validation problems 422;
      failed processing stored and re‑processable without duplicates. **Tests:** `intake.test.ts` (17) + browser test over real HTTP.
- [x] Automation eligibility recorded per inquiry: only live form submissions on active accounts are "eligible";
      onboarding/paused/suspended → "held" (never auto‑messaged later); manual/import/sample → "none".
- [x] Manual lead entry; lead list with search (name/email/phone digits/service), stage/source/assignee filters,
      pagination; phone‑friendly card layout.
- [x] Lead detail: inquiry, campaign/tracking details (with an honest "can't be linked to an ad" message), contact
      edit, stage (New → Contacted → Booked → Won/Lost, lost reason), assignment, sale value (blank = not recorded),
      notes, tasks (Package 2), consent evidence, other inquiries from the same person, full history.
- [x] Pipeline board (Package 2+; Package 1 refused on the server — browser test).
- [x] CSV import: preview with row‑numbered problems, duplicates within the file, date formats, 2 MB/5,000‑row
      limits; one‑time commit; re‑import skips rows already imported; never enrolls in messaging; owner only.
- [x] CSV export: owner only, logged, spreadsheet‑formula injection blocked, no caching.
- [x] Overview from real data: inquiries vs previous period (null when no base), daily chart with table view,
      sources, connected forms, recent leads, unassigned open leads, pipeline cohort (P2), recorded sales with
      "incomplete" warning (P3). Definitions in METRICS.md and the Help page. **Tests:** totals reconcile
      (integration + browser), timezone/DST period unit tests.
- [x] Offboarding: removing an employee unassigns their open leads/tasks with a history entry.
- [x] Scheduled cancellation: admin records request + end date; access rules treat the account as churned at
      that date immediately; `applyDueCancellations()` records the status change (run by the Stage 3 scheduler).
- [x] Sample dataset v1 (fictional, deterministic, generated through the real code path; dashboard totals equal
      records — tested). Used by the development seed; demo deployment uses it from Stage 3 onward.

### Implemented, awaiting live verification
- [ ] Intake endpoint behind Vercel (real client IPs via `x-forwarded-for`, body limits) — needs deployment.

### Not yet / next
- Automatic acknowledgment, notifications, inbox (Stage 3). `applyDueCancellations` scheduling (Stage 3).
- Ad lead‑form intake (Stage 5, blocked on Meta/Google approvals).
- Contact merge tool for flagged possible duplicates (deferred; history flags them today).

## Verification (Stage 2 run, 2026‑10‑04)
115 unit + integration tests and 17 browser tests passed; typecheck, lint and production build clean.

## Stage 3 plan (next)
1. Jobs table + worker endpoint (`/api/jobs/run`, secret), Supabase Cron trigger; leases, retries with backoff,
   per‑company fairness, idempotency keys; `applyDueCancellations` as a scheduled job.
2. Transport interface: simulated (dev/demo/test, always) + Twilio SMS + Postmark email (disabled until approved).
3. Templates with validated fields; acknowledgment on eligible inquiries; owner/employee notifications.
4. Conversations & messages (queued/submitted/delivered/failed/unknown), provider webhooks (signature‑verified,
   out‑of‑order safe), inbound replies → inbox, STOP/HELP handling, suppression list per company.
5. Pre‑send eligibility check (reply, opt‑out, closed, paused, account status, window, already sent).
6. Tests: duplicate events, retries, worker crash mid‑send, stop after reply/opt‑out, cross‑company jobs.
