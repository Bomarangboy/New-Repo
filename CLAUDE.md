# Bluewater Collective — Project Instructions

Multi‑company lead response, follow‑up and reporting platform. The owner is non‑technical: explain decisions,
setup and costs in plain English. **Authoritative spec:** `docs/SPECIFICATION.md`. Read `docs/DECISIONS.md`
and `docs/IMPLEMENTATION_PLAN.md` before starting work; update them (and `docs/REQUIREMENTS_MATRIX.md`) when
you finish a piece of work.

## Non‑negotiables
- **Never** purchase services, create charges, send real messages, connect live ad/CRM/calendar accounts,
  publish publicly, or make destructive production changes without the owner's explicit approval.
- Never ask for credentials in chat; never commit secrets; never put secrets in `NEXT_PUBLIC_*` variables,
  logs, activity‑log details or error messages.
- Never present simulated data/integrations as live. Never display unknown values as zero.
- Record material decisions in `docs/DECISIONS.md`; reversible assumptions are fine but must be written down.

## Data access rules (security‑critical)
- All database access goes through `src/lib/db/context.ts`:
  - `withCompanyDb(ctx, …)` — client workspace work; `ctx` must come from `pageContext()` / `actionContext()`.
  - `withPlatformDb(ctx, …)` — admin area only (`requirePlatformAdmin` / `adminActionContext`).
  - `withSystemCompanyDb(companyId, purpose, …)` — trusted server work for ONE already‑identified company
    (website intake after the form key is verified, jobs). RLS still limits it to that company.
  - `withSystemDb(purpose, …)` — sign‑in, lookups before a company is known. **Never** in `src/app/(workspace)/**`
    (a test enforces this for both system doors).
- Every new company‑owned table: `company_id NOT NULL`, RLS enabled **and forced**, a policy using
  `app.current_company_id()` / `app.unrestricted()`, and a cross‑company test in `tests/integration`.
  Add RLS in a hand‑written migration (`npx drizzle-kit generate --custom --name <name>`).
- Never trust a company/user ID from the browser as proof of access. New actions → add to
  `src/lib/authz/permissions.ts`; new paid features → `entitlements.ts`; then run
  `npx tsx scripts/gen-permissions-doc.ts` (a test fails if `docs/PERMISSIONS.md` is stale).
- User‑facing errors: throw `UserError` for messages meant for people; everything else goes through
  `userMessage()`, which hides internals and logs a reference ID.
- Append sensitive changes to the activity log with `audit()` inside the same transaction; lead changes also go
  to `inquiry_events` (record history).
- Leads enter only through `recordInquiry()` (`src/server/crm/record-inquiry.ts`) so duplicate detection,
  history and messaging eligibility (`automation_origin`) are applied consistently. Imports/manual/sample = "none".
- Child CRM tables reference parents by `(company_id, id)` composite foreign keys.

## Conventions
- Next.js 16 App Router: `params`/`searchParams`/`cookies()` are async; middleware is `proxy.ts`.
  Local docs: `node_modules/next/dist/docs/`.
- Tailwind 4 (`@theme`/`@utility` in `src/app/globals.css`); brand tokens `navy-*`, `brand-*`.
- Server business logic lives in `src/server/*` (framework‑free, testable); pages/actions stay thin.
- Migrations: `npm run db:generate` for schema changes; never edit an applied migration.
  (`scripts/regen-migrations.sh` is only for the pre‑release period and must not be used after the first deploy.)

## Commands
```bash
npm run typecheck && npm run lint && npm test   # must pass before every commit
npm run build                                   # production build
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:e2e   # browser tests (cloud sandbox path)
npm run db:reset-local -- bluewater_dev && npm run db:seed   # local dev database (uses .env.local)
```
Tests need a local PostgreSQL with superuser `postgres:postgres@localhost:5432` (override with `LOCAL_PG_SUPERUSER_URL`).
In the cloud sandbox: `service postgresql start`. Don't kill servers with `pkill -f next…` (it matches the shell); use `fuser -k <port>/tcp`.
