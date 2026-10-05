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
| 3 | Messaging (templates, acknowledgment, notifications), two‑way inbox, durable jobs, stop rules, opt‑outs, suppression | **Done** (simulated; live Twilio/Postmark pending accounts & approval) |
| 4 | Follow‑up sequences, booking connector (Cal.com, D‑10), appointments, confirmations & reminders | **Done** (simulated; live Cal.com check pending) |
| 5 | Meta & Google connectors (lead forms + reporting), reporting definitions | **Done** (simulated; live use **blocked** by platform approvals) |
| 6 | First external CRM connector (D‑11) | **Needs your input**: which CRM do pilot clients use? |
| 8 | Platform Studio (appearance/content/layout editor) and Sequence Library | **Done** (tested; not deployed) |
| 7 | Billing/usage tooling, Health & Recovery Center, playbooks, backups & restore test, load test, scheduled summaries, support, retention/deletion, demo workspaces, deployment readiness | **Done** (local measurements; staging drills at launch) |

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
- [x] Package entitlement matrix enforced on server (Bluewater Connect blocked from sequences/booking/reports even by direct URL — browser test).
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
- [x] D‑13 budget (~$100/month), D‑14 support hours (7am–1am ET, owner), D‑10 Cal.com — answered 2026‑10‑04.
- [ ] D‑18 legal review — owner‑managed; live sending stays off until the owner confirms.

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
      notes, tasks (Bluewater Engage), consent evidence, other inquiries from the same person, full history.
- [x] Pipeline board (Bluewater Engage or Insight; Bluewater Connect refused on the server — browser test).
- [x] CSV import: preview with row‑numbered problems, duplicates within the file, date formats, 2 MB/5,000‑row
      limits; one‑time commit; re‑import skips rows already imported; never enrolls in messaging; owner only.
- [x] CSV export: owner only, logged, spreadsheet‑formula injection blocked, no caching.
- [x] Overview from real data: inquiries vs previous period (null when no base), daily chart with table view,
      sources, connected forms, recent leads, unassigned open leads, pipeline cohort (Engage), recorded sales with
      "incomplete" warning (Insight). Definitions in METRICS.md and the Help page. **Tests:** totals reconcile
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

## Stage 3 checklist

### Implemented and verified
- [x] Durable job queue (`jobs` table, RLS): written in the same transaction as the lead; `SKIP LOCKED` claiming,
      5‑per‑company fairness, retries with backoff → "dead", lease recovery, idempotency keys, maintenance under an
      advisory lock (stale jobs, interrupted sends → unknown, due cancellations). `POST /api/jobs/run` (bearer secret),
      run‑after‑intake, `npm run jobs:work` locally.
- [x] Transport choice: live only in production + master switch + real customer + verified sender (D‑23); otherwise
      simulated and labeled. Production customers without a verified sender are cancelled + team notified, never faked.
- [x] Templates: validated fields with fallbacks, required STOP wording, segment counting (GSM‑7/UCS‑2), live preview,
      versioned saves; default templates until edited.
- [x] Automatic acknowledgment with a pre‑send check (account, emergency stop, stage, 24 h age, reply/contacted,
      consent, suppression, sending window in company timezone, DST‑correct); one per inquiry (DB unique key; concurrent
      worker test); problems notified to the team.
- [x] Message states with "unknown" never auto‑retried (D‑25); out‑of‑order status updates never go backwards;
      status history append‑only.
- [x] Inbox: conversation list with Needs‑reply badge, conversation page, manual text/email replies (permission,
      suppression and consent checks), mark handled, lead page Messages card + acknowledgment status.
- [x] Incoming handling: keyword + phrase opt‑outs, START to resume, replies stop automation and notify; manual opt‑out
      and lift with reason; signed email unsubscribe page with confirmation; bounces/complaints suppress.
- [x] Team notifications (new lead, reply, acknowledgment problem) — once per event; dev mailbox in dev/test.
- [x] Automations page: templates, sending window/days, recipients, on/off; **emergency stop** (owners/support).
- [x] Admin: per‑company senders (Twilio subaccount, Postmark stream; tokens encrypted, never shown again),
      Health page (simulated/live mode, maintenance heartbeat, failed/dead jobs with retry/cancel, unknown messages to
      resolve).
- [x] Dashboard: acknowledgment counts (sent/failed/uncertain/simulated), median time to acknowledgment and to first
      human reply, needs‑reply count, team alerts — blanks shown as "—", never 0.
- [x] Onboarding checklist steps for senders, templates and notifications from real data.
- [x] Sample data: simulated conversations, a STOP, replies awaiting an answer.
- [x] Cross‑company tests for jobs, conversations, messages, senders, suppressions, notifications.

### Implemented, awaiting live verification
- [ ] Twilio sending, status callbacks and incoming texts (signature checked with Twilio's library) — needs accounts,
      A2P 10DLC registration per client, and go‑live approval.
- [ ] Postmark client email + webhooks — needs account, verified domains.
- [ ] Supabase Cron → `/api/jobs/run` every minute — needs the Supabase project.

### Blocked / owner
- [ ] Legal review of message wording/consent (D‑18) before live sending.

## Verification (Stage 3 run, 2026‑10‑04)
170 unit + integration tests (Vitest, real PostgreSQL) and 23 browser tests passed;
typecheck, lint and production build clean. Mutation checks: idempotency, status ordering, reply check.

## Stage 4 checklist

### Implemented and verified
- [x] Schema + forced RLS for sequences, step versions (append‑only), enrollments (one open per person), booking
      settings, appointments, booking webhook log (append‑only) — `drizzle/0006`, `0007`; cross‑company tests.
- [x] Follow‑up engine: auto‑enroll on eligible website leads, manual enrollment (with confirmation for non‑form
      leads), steps as jobs with the full pre‑send check, skip‑not‑reroute, window waits, handoff task, one message
      per step (concurrency + crash‑recovery tests).
- [x] Stop rules wired at the source (reply, STOP/unsubscribe/manual opt‑out, team message, stage change, sale,
      booking, emergency stop, sequence off, package downgrade, pause/suspend/churn/scheduled end) **and** re‑checked
      before each step (test writes a reply bypassing the hook — still no send). Stopped follow‑ups never restart (D‑28).
- [x] Sequence editor: up to 8 steps, wait/channel/wording per step, live checks and preview, versioning (D‑26),
      on/off, automatic start (only one), stop/handoff options.
- [x] Lead page: follow‑up status with pause/resume/stop/start; appointments with personal booking link, add
      appointment, simulator; history entries for every follow‑up/appointment event.
- [x] Cal.com connector: booking page, per‑client webhook address + secret shown once, HMAC verification as Cal.com
      computes it, Ping → Connected, wrong‑signature problem shown to the owner; created / rescheduled / cancelled with
      duplicate, out‑of‑order and replaced‑booking protection; lead matching by reference → email/phone → new lead.
- [x] Appointments page (upcoming, past, cancelled; outcome marking; source labels incl. "Simulated").
- [x] Confirmations & reminders: settings, editable versioned wording, Cal.com duplicate avoidance (D‑27),
      re‑check before sending; reminders moved with reschedules.
- [x] Overview (Bluewater Engage or Insight): active follow‑ups, follow‑up results and why they stopped, upcoming appointments.
      Onboarding steps for follow‑up and booking from real data. Team alerts for booking changes.
- [x] Sample data: a sequence, follow‑ups at every stage, simulated appointments (labeled).

### Implemented, awaiting live verification
- [ ] Cal.com webhooks from a real account (format confirmed from Cal.com's source; `metadata[bw]` URL parameter
      pass‑through to be confirmed with a real booking).

## Verification (Stage 4 run, 2026‑10‑04)
212 unit + integration tests (Vitest, real PostgreSQL) and 29 browser tests (Stages 1–4) passed; typecheck, lint and
production build clean. Mutation checks (each safeguard broken on purpose → a test failed): signature check,
out‑of‑order guard, replaced‑booking guard, cancel‑before‑create guard, reminder time check, Cal.com email
duplicate rule, reply re‑check, step crash recovery, step double‑handling guard, manual‑enroll confirmation.

## Stage 5 checklist

### Implemented and verified
- [x] Schema + forced RLS: ad connections (encrypted tokens), ad accounts, lead sources (one active Facebook Page per
      company — DB rule), lead events (once per platform lead id), campaigns, daily metrics (unique per account/campaign/day),
      sync history (no deletes) — `drizzle/0008`, `0009`; cross‑company tests.
- [x] Connector interface with Meta (Graph v26.0), Google Ads (REST v25) and simulated implementations; paging, rate‑limit
      and expired‑token handling; appsecret_proof; exact money (micros). Unit‑tested against faked HTTP responses.
- [x] Connecting: live OAuth with signed, expiring state bound to company + user + browser (re‑verified on return);
      simulated connect in dev/test/demo; "unavailable" for real customers until approved (D‑31); reconnect, disconnect
      (revokes at the platform, keeps history), token‑expiry warning, needs‑reconnect status.
- [x] Lead forms (all packages): Meta webhook (signature, verification handshake) → job fetches lead with Page token;
      hourly missed‑lead check; Google lead‑form webhook (secret address + key, test data verifies without creating a
      lead). Recorded once through `recordInquiry()` with campaign/ad ids; acknowledgment by email (D‑32); account‑status rules.
- [x] Reporting (Bluewater Insight): 90‑day backfill, 7‑day replace every 6 h (no double counting), per‑currency totals,
      campaign table with platform numbers next to Bluewater leads/booked/won/sales, crediting only by campaign id (D‑33),
      leads & results by source, freshness/stale warnings, daily spend chart with table view; Overview card.
- [x] Connected Accounts UI (Pages, ad accounts, Google webhook setup shown once, simulated test leads), admin Health
      section for ad connection problems, onboarding counts ad lead sources.
- [x] Sample data: simulated Meta Page for sample companies; Bluewater Insight sample company with simulated Meta + Google
      accounts, 90 days of numbers and sample leads linked to sample campaigns. All labeled simulated/sample.

### Implemented, awaiting live verification (blocked on approvals — owner action, DEPLOYMENT.md §3e / ADS.md)
- [ ] Meta: Business verification + App Review (leads_retrieval, pages_*, ads_read, business_management), webhook registration.
- [ ] Google: developer token (Basic access), OAuth consent verification for the adwords scope.
- [ ] Google lead‑form webhook from a real form (no approval needed — just a deployed address).

### Deferred
- Sending conversions back to platforms → not planned (needs review). (Weekly owner summaries were built in Stage 7.)

## Verification (Stage 5 run, 2026‑10‑04)
237 unit + integration tests (Vitest, real PostgreSQL) and 34 browser tests (Stages 1–5) passed; typecheck, lint and
build clean. Mutation checks (each broken on purpose → a test failed): Meta signature, Google key, OAuth nonce, OAuth
company/user/platform match, closed‑account rejection, Google test‑data handling, Bluewater Insight check inside the import job,
campaign‑id‑only crediting.

## Stage 7 checklist

### Implemented and verified
- [x] Schema + RLS (`drizzle/0010`–`0013`): job priority, alerts, platform settings, billing terms, invoices (no deletes),
      support tickets/messages (internal notes hidden by RLS), service notices, deletion records, ops evidence,
      `pause_reason` on follow‑ups, restricted `app.purge_company_data()`; cross‑company tests.
- [x] Monitoring: `/api/health` (public, no client data); grouped alerts with one email on open and one on recovery
      (queue delay, dead jobs, intake failures, unknown sends, failure rate, ad reconnects/lead failures, usage 80/100 %,
      overdue payments, database size). Health & Recovery page additions; redacted diagnostics download.
- [x] Safe recovery: retry failed website submissions and ad leads (recorded once), re‑import ad date range (replace),
      Bluewater automation pause per client, follow‑up steps > 24 h late paused for a person (never a backlog), job
      priorities for lead‑critical work.
- [x] Usage & billing: monthly usage per client, cost estimates from owner‑entered unit prices (“—” until set),
      customers by month, billing terms, text limits (alert or pause automatic texts → email fallback), invoice records
      with paid/failed/void and past‑due alerting after grace; owner read‑only Billing page.
- [x] Support requests with BW‑ references, admin inbox, replies by email, internal notes; service notices with
      recipient‑count confirmation; Help page with emergency‑pause guidance.
- [x] Weekly owner summaries (Bluewater Insight), one per owner per week, opt‑out in Settings.
- [x] Retention policy (RETENTION.md) and restricted deletion (archived only, exact name, MFA, DB‑enforced).
- [x] Sales demo: prospect workspaces (create, invite, reset, extend, end access), presentation controls, automatic
      cleanup 7 days after expiry, presentation script (DEMO.md). Refused in production.
- [x] Backup/restore drill script — run locally on the sample DB and on ~1 year of pilot volume (2.37 M rows: 41 s),
      isolation verified after restore; recorded as evidence. Found and fixed: owner `pg_dump` fails under forced RLS.
- [x] Load test script — HTTP against the production build: 5 leads/s, p95 30 ms; burst 50; rate limit; 380 leads →
      380 acknowledgments, no duplicates or losses. In‑process at 1‑year volume: 760 jobs drained in 11 s with 2 workers.
- [x] Playbooks for every scenario in spec §16; MONITORING, RECOVERY, CAPACITY, BILLING, SUPPORT, RETENTION,
      LAUNCH_CHECKLIST docs.

### Implemented, awaiting live verification
- [ ] Restore drill from a real Supabase backup into a separate project; load test against staging.
- [ ] Uptime monitor + status page accounts; Vercel Firewall rules; Sentry (optional).
- [ ] Walk‑through of the provider‑dashboard playbooks on staging.

## Verification (Stage 7 run, 2026‑10‑04)
253 unit + integration tests (Vitest, real PostgreSQL) and 39 browser tests (Stages 1–5 and 7) passed; typecheck, lint and
build clean.
Mutation checks (each safeguard broken on purpose → a test failed): exact‑name confirmation for deletion, database
refusal to purge non‑archived companies, RLS hiding internal notes, RLS blocking client‑written notes, notice
recipient‑count check, text‑limit fallback, late‑step pause, demo controls limited to demo workspaces; the restore drill
failed as expected on a copy with RLS removed from one table. (Removing the alert “refresh” branch did not fail a test
because the database's one‑open‑alert‑per‑key rule still prevents duplicates — the safeguard is the index.)

## Stage 8 checklist — Platform Studio and Sequence Library

### Implemented and verified
- [x] Schema + RLS (`drizzle/0014`, `0015`): Studio drafts/published/versions/images; library templates, versions,
      drafts, categories, evidence, company copies; restricted deletion now covers copies and company Studio overrides.
- [x] Studio: settings registry with validation (plain text, contrast, essential menu items, package-aware landing),
      platform → package → company inheritance with sources and Reset, drafts with conflict protection, preview by role,
      package, company, desktop/phone (sample data only), publish with change list and scope, versions, restore into
      draft, audit, safe mode + reset script, validated image uploads, Overview tiles/cards layout, menu order/labels,
      landing page by package. Applied to the workspace, admin area, sign-in pages and favicon.
- [x] Library: import format + validation + example, starter templates, admin create/edit/preview/version/publish/
      recommend/retire/emergency pause, adoption, evidence with thresholds; client search/filters, preview of every
      message/rule/requirement, private copies, setup checklist, activation vs automatic enrollment, update diffs with
      merge/replace/keep, archive; package rules on the server; demo-safe.
- [x] Tests: 22 new integration tests (studio 10, library 12), browser tests (Stage 8: 4), phone-width layout check.

### Implemented, awaiting live verification
- [ ] Deploy (migrations 0014/0015 run on staging first), then publish the starter library on production.
- [ ] Evidence: needs real customer use before anything can be shown to clients.

## Verification (Stage 8 run, 2026‑10‑05)
275 unit + integration tests and 43 browser tests (Stages 1–5, 7, 8) passed; typecheck, lint and build clean.
Mutation checks (each safeguard broken on purpose → a test failed): essential menu items, plain-text-only wording,
color contrast, draft conflict protection, role filtering of the menu, company overrides private (RLS), library drafts
hidden from clients (RLS), checklist enforced by the normal on/off switch, emergency-pause scope confirmation, no phone
numbers in shared templates. Two mutations survived because a second independent check still blocked the same thing
(SVG uploads are also refused by the script/markup check; sequences for Connect are also refused by the template's
required package).
Found and fixed during browser testing: a form field named `reset` broke React's form handling after saving
(renamed), and two success messages vanished on refresh (now persistent).

## What's next
- **Launch path:** LAUNCH_CHECKLIST.md — deployment accounts (your approval for each purchase), staging drills, provider
  approvals (Twilio A2P per client, Postmark, Meta, Google), legal review, prices.
- **Stage 6 (external CRM)** still needs one answer: which CRM (if any) pilot clients use.
