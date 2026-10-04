# Implementation Plan & Status

Statuses (from the specification): **Implemented and verified** · **Implemented, awaiting live verification** ·
**Simulated for demo** · **Blocked** · **Deferred** · **Planned**.
"Verified" means automated tests and/or a real browser run against a real database in this repository —
not a provider's live service unless stated.

## Stage overview

| Stage | Scope | Status |
|---|---|---|
| 1 | Architecture, project setup, authentication, company isolation, permissions, admin company management | **Done** (live Supabase check pending) |
| 2 | Company lifecycle details, built‑in CRM (contacts, inquiries, notes, tasks, pipeline), website intake, CSV import, basic dashboard, demo dataset v1 | Next |
| 3 | Messaging (templates, acknowledgment, notifications), two‑way inbox, durable jobs, stop rules, opt‑outs, suppression | Planned |
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
Last run (2026‑10‑04): 70 unit + integration tests passed (21 unit, 49 database); 9/9 browser tests passed.

## Stage 2 plan (next)

1. Schema: contacts (dedupe on normalized phone/email per company), inquiries (each submission kept),
   sources & tracking (UTM, gclid/fbclid, form/campaign IDs), consent evidence, notes, tasks, assignments,
   pipeline stage history, recorded sale value. RLS + composite company keys.
2. Website intake endpoint with per‑company intake keys, schema validation, idempotency keys, durable
   receipt before 2xx, rate limiting, honeypot; documented embed snippet.
3. Manual lead entry, CSV import with row‑level error report (no automatic messaging), search/filter/pagination, safe CSV export (owner only, logged).
4. Leads list/detail screens, pipeline (Package 2), overview metrics from real data with "no data" states.
5. Demo dataset v1: fictional "Harbor Home Services" with internally consistent records; demo deployment guard.
6. Tests: cross‑company access to every new table/route, duplicate events, idempotent retries, import validation, metric calculations.
