# Requirements & Verification Matrix

Traceability from the specification (SPECIFICATION.md section numbers) to code, tests, docs and blockers.
Status: ✅ Implemented & verified · 🟡 Implemented, awaiting live verification · 🎭 Simulated for demo ·
⛔ Blocked · ⏸ Deferred · ⬜ Planned (stage).

| Spec § | Requirement | Status | Implementation | Verification | Notes / blockers |
|---|---|---|---|---|---|
| 1 | Brand: wordmark, navy/blue/white, responsive | ✅ | `components/brand.tsx`, `globals.css` | Screenshots (desktop/phone) | Logo recreated as type, not image |
| 1 | Runs independently of Claude and owner's computer | 🟡 | Vercel + Supabase design | — | Needs deployment (Stage 7) |
| 2 | Three cumulative packages, backend entitlements | ✅ | `authz/entitlements.ts`, `resolve.ts` | unit + integration + browser | |
| 2 | Lead capture separate from ad reporting | ✅ | `ad_lead_forms` vs `ad_reporting` | unit test | |
| 3 | Spec, architecture, plan, instructions, decisions, matrix | ✅ | `docs/*`, `CLAUDE.md` | — | |
| 3 | Stack/hosting decision with owner | ✅ | DECISIONS D‑02 | — | Owner chose Supabase+Vercel |
| 4 | Login, logout, reset, invitations | ✅ / 🟡 | `auth/*`, `server/invitations.ts` | integration + browser (local provider) | Supabase live check pending |
| 4 | Admin / owner / employee roles; role‑by‑action table | ✅ | `authz/permissions.ts`, PERMISSIONS.md | unit + integration | Doc generated from code |
| 4 | Admin MFA | ✅ | `guard.ts`, TOTP | browser test | |
| 4 | Session revocation, offboarding, ownership transfer | ✅ | `team.ts`, `resolveUser` | integration + browser | |
| 4 | Server‑side company authorization; browser ID not trusted | ✅ | `resolveCompanyContext` | forged‑cookie browser test | |
| 4 | Isolation: DB records | ✅ | RLS `0001_security.sql` | `isolation.test.ts` | |
| 4 | Isolation: CRM records, search, exports, intake | ✅ | RLS + composite keys `0003_crm_security.sql` | crm.test.ts | |
| 4 | Isolation: conversations, jobs, senders, suppressions, notifications | ✅ | RLS `0005_messaging_security.sql` | messaging.test.ts | |
| 4 | Isolation: sequences, enrollments, appointments, booking connection | ✅ | RLS `0007_sequences_booking_security.sql` | sequences/booking isolation tests | |
| 4 | Isolation: ad connections, tokens, lead sources, metrics | ✅ | RLS `0009_ads_security.sql`, one‑Page‑one‑company index | ads.test.ts isolation | |
| 4 | Isolation: files, tickets | ⬜ 7 | Same pattern | Each stage adds cross‑company tests | |
| 4 | Secrets out of frontend/logs/commits | ✅ | `env.ts`, `.gitignore`, `redactDetails` | unit tests | |
| 4 | Controlled support access, no unrestricted impersonation | ✅ | `support_access_grants` | integration | |
| 4 | Admin account recovery without bypass | ✅ (documented) | CLI‑only admin creation | — | OWNER_MANUAL.md |
| 5 | Website form intake, manual entry, CSV import | ✅ | `server/intake/website.ts`, `server/crm/*`, `/api/intake/[key]` | intake.test.ts, crm.test.ts, stage2 browser tests | Live HTTP behind Vercel 🟡 |
| 5 | Ad lead‑form intake (Meta webhook + fetch + hourly reconciliation; Google webhook) | ✅ 🎭 / 🟡 | `server/ads/leads.ts`, `/api/webhooks/meta`, `/api/webhooks/google-leads/[key]` | ads.test.ts, ads-rules unit, stage5 browser | ⛔ Meta App Review for live; Google webhook needs only deployment |
| 5 | Dedupe, repeat inquiries, idempotency, no messaging on imports | ✅ | `record-inquiry.ts`, intake events, `automation_origin` | crm/intake tests incl. deterministic race | Send-side idempotency in Stage 3 |
| 5 | Required lead fields, tracking, consent evidence, history | ✅ | schema `inquiries`, `consent_records`, `inquiry_events` | crm/intake tests | |
| 5 | Search, filters, pagination, safe export | ✅ | `/app/leads`, `/app/leads/export` | crm.test.ts, browser | |
| 6 | CRM mode selection; external labeled unavailable | ✅ | Settings page, `chooseCrmMode` | integration | |
| 6 | Built‑in CRM records & pipeline (New→Contacted→Booked→Won/Lost), notes, tasks, sales | ✅ | `server/crm/leads.ts`, lead pages, pipeline board | crm.test.ts, browser | Appointments added in Stage 4 |
| 6 | External connector interface | ⬜ 6 (contract documented) | ARCHITECTURE.md | | D‑11 open |
| 7 | Acknowledgment, templates, sending window, pre‑send check | ✅ 🎭 | `server/messaging/*`, MESSAGING.md | messaging.test.ts, messaging-rules unit, stage3 browser | Simulated; live 🟡 |
| 7 | Two‑way inbox, manual replies, needs‑reply | ✅ 🎭 | `/app/conversations`, `inbox.ts` | messaging.test.ts, browser | |
| 7 | Durable jobs, retries, idempotency, unknown sends | ✅ | `server/jobs/*`, `send.ts` | concurrent worker + crash tests | Cron trigger 🟡 |
| 7 | Opt‑outs, suppression, unsubscribe, emergency stop | ✅ | `inbound.ts`, `unsubscribe.ts`, `settings.ts` | messaging/webhooks tests, browser | D‑18 legal review |
| 7 | Twilio/Postmark senders & webhooks | 🟡 | `transport.ts`, `webhooks.ts`, admin Senders | signature tests with Twilio's library | ⛔ accounts, A2P, go‑live approval |
| 7–8 | Multi‑day follow‑up sequences, versioning, pause/resume/stop | ✅ 🎭 | `server/sequences/*`, sequence editor, lead page | sequences.test.ts (18), stage4 browser | Simulated delivery |
| 7 | Stop after reply, booking, opt‑out, closed, manual message, suspension/service end, package | ✅ | `sequences/stop.ts` + pre‑send `decideStep` | sequences.test.ts incl. bypassed‑hook test | D‑28 |
| 13 | Sequence/template changes validated, previewed, versioned; effect on active enrollments defined | ✅ | `saveSequence`, D‑26 | sequences.test.ts | |
| 9 | Booking links, booking‑to‑lead association, create/reschedule/cancel, sequence cancellation | ✅ / 🟡 | `server/booking/*`, `/api/webhooks/calcom/[key]` | booking.test.ts (14), booking-rules unit, stage4 browser | Live Cal.com check pending |
| 9 | Confirmations & reminders without duplicating Cal.com's | ✅ 🎭 | `booking/messages.ts`, D‑27 | booking.test.ts | |
| 9 | Timezones/DST, authoritative system, sync failures recorded | ✅ | `formatAppointmentTime`, `localToInstant`, `booking_events`, D‑29 | unit + integration | |
| 10 | Connected Accounts: OAuth (no passwords), account/Page selection, encrypted tokens, renewal, disconnect, last sync, errors & reconnect | ✅ 🎭 / 🟡 | `server/ads/connections.ts`, `config.ts`, ads-card | ads.test.ts (state forgery, disconnect, isolation) | ⛔ Meta/Google approvals (ADS.md) |
| 10 | Pagination, rate limits, historical + incremental import | ✅ | `clients/*`, `sync.ts` | ads-rules unit (faked HTTP), ads.test.ts | |
| 10 | Support matrix; connected ≠ every function; blocked shown as blocked | ✅ | ADS.md, Connected Accounts copy | stage5 browser | |
| 11 | Dashboards & reporting definitions (P1/P2) | ✅ | `server/metrics.ts`, METRICS.md, Help page | reconciliation tests, DST unit tests | |
| 11 | Package 3: spend/performance, campaigns, conversion rates, recorded vs attributed sales, freshness, currencies | ✅ 🎭 | `server/ads/reports.ts`, Reports page, Overview card | ads.test.ts (totals reconcile, crediting rules) | Scheduled summaries → Stage 7 |
| 12 | All Customers directory + filters | ✅ | `/admin` | browser test | |
| 12 | Separate lifecycle / billing / suspension | ✅ | schema + `account-policy.ts` | unit + integration | |
| 12 | Package & lifecycle history, reactivation, churn reason | ✅ | `server/companies.ts` | integration | |
| 12 | Scheduled cancellation, service end | ✅ | `scheduleCancellation`, `applyDueCancellations` in maintenance | crm.test.ts, unit | |
| 12 | Retention, deletion | ⬜ 7 | | | |
| 13 | Routine config in database, sensitive changes logged | ✅ (Stage‑1 scope) | `audit_log` | integration | Templates/sequences later |
| 14 | Onboarding checklist with statuses | ✅ (incl. follow‑up & booking steps) | `server/onboarding.ts` | screenshot | Steps fill in as features land |
| 15–16 | Health center (jobs, unknown messages, senders) | ✅ (Stage‑3 scope) | `/admin/health`, `server/health.ts` | browser | Monitoring/tickets Stage 7 |
| 15–16 | Monitoring, full playbooks, support tickets | ⬜ 7 | | | D‑17 |
| 17 | Backups & disaster recovery | ⬜ 7 | Supabase daily backups | Restore test planned | |
| 18 | Capacity targets & load test | ⬜ 7 | Targets proposed D‑15 | | |
| 19 | Usage tracking, cost estimates | ⬜ 3/7 | | | D‑13, D‑16 |
| 20 | Environments, env example, migrations | ✅ / 🟡 | `.env.example`, `drizzle/`, DEPLOYMENT.md | migrations run in tests | Hosting not created yet |
| 21 | Sales demo | 🎭 foundation + dataset (leads, conversations, follow‑ups, appointments) + simulate reply/booking | demo guards, `server/demo/dataset.ts` | totals-reconcile test | Prospect access & presentation controls Stage 3+ |
| 22 | Account inventory, owner manual, technical docs | ✅ (initial) | `docs/*` | — | Grows each stage |
| 23 | Verification statuses & acceptance | ✅ | this file, IMPLEMENTATION_PLAN.md | — | |
