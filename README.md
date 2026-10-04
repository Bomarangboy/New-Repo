# Bluewater Collective

A web platform that helps client businesses respond to every advertising lead, follow up automatically and
see what their advertising produces. Each client company gets its own secure workspace; Bluewater
administrators manage all companies from a separate area.

> **Status:** Stage 1 of 7 complete — accounts, security, company isolation, permissions, administrator
> company management. Lead capture, messaging, booking and reporting are next. Nothing is deployed yet and no
> real messages can be sent. See [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

## Documents

| Read this | For |
|---|---|
| [docs/SPECIFICATION.md](docs/SPECIFICATION.md) | What the platform must do (authoritative) |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Choices made, costs, and what needs your decision |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Stages and the live status checklist |
| [docs/REQUIREMENTS_MATRIX.md](docs/REQUIREMENTS_MATRIX.md) | Every requirement → code → test → status |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it's built and why it's secure |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md) | Who can do what, per role, package and account status |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Putting it online (Supabase + Vercel), domains, backups, rollback |
| [docs/COSTS.md](docs/COSTS.md) | Expected running costs and assumptions |
| [docs/ACCOUNT_INVENTORY.md](docs/ACCOUNT_INVENTORY.md) | Every outside account you'll own |
| [docs/OWNER_MANUAL.md](docs/OWNER_MANUAL.md) | Day‑to‑day operation in plain English |
| [docs/DEMO.md](docs/DEMO.md) | The sales demo environment |
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

Sample sign‑ins (password `bluewater-dev-password`, fictional data only):
- `admin@bluewater.test` — Bluewater administrator (you'll set up two‑step verification on first sign‑in)
- `jordan@harbor.test` — owner, Harbor Home Services (Package 2); `alex@harbor.test` — employee
- `taylor@summit.test` — owner, Summit Roofing (Package 1)
- `morgan@bayside.test` — owner, Bayside Dental (Package 3)

Emails (invitations, password resets) are **not sent** locally — read them at
<http://localhost:3000/dev/mailbox>.

## Testing

```bash
npm run typecheck && npm run lint   # code checks
npm test                            # unit + database tests (creates a throwaway "bluewater_test" database)
npm run build && npm run test:e2e   # real-browser tests against a fresh "bluewater_e2e" database
```

## Where the code lives

```
src/app/(auth)        sign-in, two-step code, password reset, invitations
src/app/(workspace)   client workspace (/app/...)
src/app/admin         Bluewater administrator area (/admin/...)
src/lib/auth          sign-in providers (Supabase for real; local for dev/tests)
src/lib/authz         roles, packages, account status, the server-side gatekeeper
src/lib/db            database schema, connection, the three guarded "doors"
src/server            business logic (companies, invitations, team, onboarding)
drizzle/              database migrations (incl. row-level security)
tests/                unit, integration (real database) and browser tests
docs/                 everything above
```

## Ownership

This repository is yours (GitHub: `Bomarangboy/New-Repo`). Keep it private. Every outside service should be
registered to a Bluewater business email you control — see the account inventory. To hand the project to
another developer, give them repository access and point them at `CLAUDE.md` and `docs/`.
