# Bluewater Collective

A web platform that helps client businesses respond to every advertising lead, follow up automatically and
see what their advertising produces. Each client company gets its own secure workspace; Bluewater
administrators manage all companies from a separate area.

> **Status:** Stages 1–5 and 7 complete (Stage 6, external CRM sync, waits for your choice of CRM) — accounts, security, company isolation, permissions, administrator
> company management, built-in CRM, website form capture, CSV import/export, a dashboard from real data,
> **messaging** (automatic acknowledgments, two-way inbox, opt-outs, team alerts, background jobs) and
> **Bluewater Engage**: multi-day follow-up sequences, Cal.com booking, appointments, confirmations and reminders.
> All messaging is **simulated** (clearly labeled) until real Twilio/Postmark accounts exist and you approve
> go-live; Cal.com awaits a real account. **Advertising** (Stage 5): Facebook/Instagram and Google lead forms and
> Bluewater Insight ad reporting — simulated until Meta/Google approve Bluewater's apps. **Operations** (Stage 7): health &
> alerts, backups with a tested restore drill, load test, support requests, service notices, usage & billing records,
> weekly summaries, data retention/deletion and sales‑demo workspaces. Nothing is deployed yet — see
> [`docs/LAUNCH_CHECKLIST.md`](docs/LAUNCH_CHECKLIST.md). See [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

## Documents

| Read this | For |
|---|---|
| [docs/SPECIFICATION.md](docs/SPECIFICATION.md) | What the platform must do (authoritative) |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Choices made, costs, and what needs your decision |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Stages and the live status checklist |
| [docs/REQUIREMENTS_MATRIX.md](docs/REQUIREMENTS_MATRIX.md) | Every requirement → code → test → status |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it's built and why it's secure |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md) | Who can do what, per role, package and account status |
| [docs/METRICS.md](docs/METRICS.md) | How every dashboard number is calculated |
| [docs/MESSAGING.md](docs/MESSAGING.md) | How texts/emails are sent, stopped and received |
| [docs/ADS.md](docs/ADS.md) | Meta & Google Ads: lead forms, reporting, approvals needed |
| [docs/BOOKING.md](docs/BOOKING.md) | Cal.com connection, appointments, confirmations & reminders |
| [docs/INTAKE.md](docs/INTAKE.md) | Connecting a client's website form (for web designers) |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Putting it online (Supabase + Vercel), domains, backups, rollback |
| [docs/COSTS.md](docs/COSTS.md) | Expected running costs and assumptions |
| [docs/ACCOUNT_INVENTORY.md](docs/ACCOUNT_INVENTORY.md) | Every outside account you'll own |
| [docs/OWNER_MANUAL.md](docs/OWNER_MANUAL.md) | Day‑to‑day operation in plain English |
| [docs/DEMO.md](docs/DEMO.md) | The sales demo environment and presentation script |
| [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md) | Ready / approvals / decisions, what can be sold, pilot plan |
| [docs/MONITORING.md](docs/MONITORING.md) | Health endpoint, alerts, status page |
| [docs/RECOVERY.md](docs/RECOVERY.md) | Backups, restore drill results, disaster recovery |
| [docs/CAPACITY.md](docs/CAPACITY.md) | Load‑test results vs targets |
| [docs/BILLING.md](docs/BILLING.md) | Usage, cost estimates, limits, invoices |
| [docs/SUPPORT.md](docs/SUPPORT.md) | Support requests, hours, service notices |
| [docs/RETENTION.md](docs/RETENTION.md) | What is kept, for how long, and how deletion works |
| [docs/playbooks/README.md](docs/playbooks/README.md) | Incident playbooks |
| [CLAUDE.md](CLAUDE.md) | Rules for any developer (human or AI) working on the code |

## Try it on a computer (local development)

You need **Node.js 20.9+** and **PostgreSQL 16** (on a Mac, [Postgres.app](https://postgresapp.com) is the
easiest; on Windows use the PostgreSQL installer). Then, in a terminal inside this folder:

```bash
npm install
cp .env.example .env.local            # then edit .env.local (see below)
npm run db:reset-local -- bluewater_dev
npm run db:seed
npm run dev                            # open http://localhost:3000
```

In `.env.local` set `ENCRYPTION_KEY` to the output of
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. The other defaults work for a
local PostgreSQL whose superuser is `postgres` / password `postgres` (otherwise set `LOCAL_PG_SUPERUSER_URL`).

Sample sign‑ins (password `bluewater-dev-password`; Harbor and Bayside come with ~130 fictional leads each):
- `admin@bluewater.test`, `ops@bluewater.test` — Bluewater administrators (you'll set up two‑step verification on first sign‑in)
- `jordan@harbor.test` — owner, Harbor Home Services (Bluewater Engage); `alex@harbor.test` — employee
- `taylor@summit.test` — owner, Summit Roofing (Bluewater Connect)
- `morgan@bayside.test` — owner, Bayside Dental (Bluewater Insight)

Emails (invitations, password resets, team alerts) are **not sent** locally — read them at
<http://localhost:3000/dev/mailbox>. Client texts/emails use the simulated transport and appear in
**Conversations**. Background jobs run right after each website lead; to also process retries and scheduled
work, run `npm run jobs:work` in a second terminal.

## Testing

```bash
npm run typecheck && npm run lint   # code checks
npm test                            # unit + database tests (creates a throwaway "bluewater_test" database)
npm run build && npm run test:e2e   # real-browser tests against a fresh "bluewater_e2e" database
npx tsx scripts/restore-test.ts     # backup + restore drill into a separate database (RECOVERY.md)
npx tsx scripts/load-test.ts        # load test at the pilot peak (CAPACITY.md); never against production
```

## Where the code lives

```
src/app/(auth)        sign-in, two-step code, password reset, invitations
src/app/(workspace)   client workspace (/app/...)
src/app/admin         Bluewater administrator area (/admin/...)
src/lib/auth          sign-in providers (Supabase for real; local for dev/tests)
src/lib/authz         roles, packages, account status, the server-side gatekeeper
src/lib/db            database schema, connection, the three guarded "doors"
src/server            business logic (companies, team, CRM, intake, messaging, sequences, booking, ads, jobs, metrics,
                      billing, support, retention, ops alerts/controls, weekly summaries, demo workspaces)
drizzle/              database migrations (incl. row-level security)
tests/                unit, integration (real database) and browser tests
docs/                 everything above
```

## Ownership

This repository is yours (GitHub: `Bomarangboy/New-Repo`). Keep it private. Every outside service should be
registered to a Bluewater business email you control — see the account inventory. To hand the project to
another developer, give them repository access and point them at `CLAUDE.md` and `docs/`.
