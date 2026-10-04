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
| 4 | Isolation: conversations, jobs, files, search, exports, reports, integrations, tickets, notifications | ⬜ 2–7 | Same RLS pattern per table | Each stage adds cross‑company tests | |
| 4 | Secrets out of frontend/logs/commits | ✅ | `env.ts`, `.gitignore`, `redactDetails` | unit tests | |
| 4 | Controlled support access, no unrestricted impersonation | ✅ | `support_access_grants` | integration | |
| 4 | Admin account recovery without bypass | ✅ (documented) | CLI‑only admin creation | — | OWNER_MANUAL.md |
| 5 | Website form intake, manual entry, CSV import | ⬜ 2 | | | |
| 5 | Ad lead‑form intake | ⬜ 5 | | | ⛔ Meta App Review / Google access |
| 5 | Dedupe, repeat inquiries, idempotency, no messaging on imports | ⬜ 2–3 | Design in ARCHITECTURE.md | | |
| 6 | CRM mode selection; external labeled unavailable | ✅ | Settings page, `chooseCrmMode` | integration | |
| 6 | Built‑in CRM records & pipeline | ⬜ 2 | | | |
| 6 | External connector interface | ⬜ 6 (contract documented) | ARCHITECTURE.md | | D‑11 open |
| 7–8 | Messaging, inbox, sequences, stop rules, opt‑outs, senders | ⬜ 3–4 | Design in ARCHITECTURE.md | | D‑08/09/18 |
| 9 | Booking | ⬜ 4 | | | D‑10 open |
| 10 | Meta/Google connections | ⬜ 5 | | | ⛔ approvals |
| 11 | Dashboards & reporting definitions | ⬜ 2/5/7 | Overview shows "No data yet", never fake zeros | | |
| 12 | All Customers directory + filters | ✅ | `/admin` | browser test | |
| 12 | Separate lifecycle / billing / suspension | ✅ | schema + `account-policy.ts` | unit + integration | |
| 12 | Package & lifecycle history, reactivation, churn reason | ✅ | `server/companies.ts` | integration | |
| 12 | Service‑end automation stop, retention, deletion | ⬜ 3/7 | | | |
| 13 | Routine config in database, sensitive changes logged | ✅ (Stage‑1 scope) | `audit_log` | integration | Templates/sequences later |
| 14 | Onboarding checklist with statuses | ✅ (Stage‑1 data) | `server/onboarding.ts` | screenshot | Steps fill in as features land |
| 15–16 | Health center, monitoring, playbooks, support tickets | ⬜ 7 | | | D‑14, D‑17 |
| 17 | Backups & disaster recovery | ⬜ 7 | Supabase daily backups | Restore test planned | |
| 18 | Capacity targets & load test | ⬜ 7 | Targets proposed D‑15 | | |
| 19 | Usage tracking, cost estimates | ⬜ 3/7 | | | D‑13, D‑16 |
| 20 | Environments, env example, migrations | ✅ / 🟡 | `.env.example`, `drizzle/`, DEPLOYMENT.md | migrations run in tests | Hosting not created yet |
| 21 | Sales demo | 🎭 foundation | `APP_ENV=demo` guards, demo kinds, expiry | unit tests | Dataset & controls Stage 2+ |
| 22 | Account inventory, owner manual, technical docs | ✅ (initial) | `docs/*` | — | Grows each stage |
| 23 | Verification statuses & acceptance | ✅ | this file, IMPLEMENTATION_PLAN.md | — | |
