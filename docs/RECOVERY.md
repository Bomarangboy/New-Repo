# Backups and Disaster Recovery

**Status:** Stage 7. Backup/restore procedure implemented and **tested locally** (evidence below). The hosted
drill (restore a Supabase backup into a separate project) is an owner/developer step at launch — see
`LAUNCH_CHECKLIST.md`. Targets (D‑15) are separate from measured results.

## What is backed up
| Item | How | Notes |
|---|---|---|
| Database (all client data, settings, history) | **Supabase Pro daily backups**, kept 7 days | Point‑in‑time recovery (PITR) is a paid add‑on (~$100/mo) — not included in the $100 budget |
| Extra logical backup (optional, recommended weekly) | `scripts/restore-test.ts` produces a `pg_dump` file; store it **outside Supabase** (e.g. encrypted in your cloud drive) | Protects against losing the Supabase account/organization |
| Application code | GitHub repository (owner‑controlled) | Every deploy is a commit |
| Configuration / secrets | Vercel environment variables; a copy in the owner's password manager | Never in the repository. `ENCRYPTION_KEY` must be kept: without it, stored ad tokens and sender credentials can't be decrypted (clients would reconnect) |
| Files | None stored by the app today | |

**Important finding (Stage 7 drill):** every table *forces* row‑level security, so a plain `pg_dump` as the
table owner fails (“query would be affected by row‑level security policy”). Logical backups must dump *through* the
policies in system scope: `PGOPTIONS='-c app.scope=system' pg_dump --enable-row-security …` (what the script does).
Supabase's own daily backups are not affected.

## Targets vs measured
| | Target (D‑15) | Measured | Where |
|---|---|---|---|
| RPO (data you could lose) | 24 h (daily backups) | Not measurable locally; equals backup frequency | Supabase Pro |
| RTO (time to restore) | 4 h | **41 s** to back up, restore into a new database and verify **2.37 million rows / 1 GB** (≈ one year of pilot volume); 0.7 s for the sample database | Local PostgreSQL 16, sandbox, 2026‑10‑04 — **label: local** |
| Isolation after restore | Must hold | Verified: RLS enabled + forced on all 52 tables, 68 policies, live check as the app role (company saw only its own leads) | `scripts/restore-test.ts` |

The hosted RTO will be longer (Supabase restore queue + DNS/config): plan on **1–2 hours** for a full restore, well
inside the 4 h target, but it must be measured once on staging.

## The restore drill (`npx tsx scripts/restore-test.ts [--record] [--keep]`)
1. Backs up the source database (`DATABASE_MIGRATION_URL`).
2. Restores into a **new, separate** database (never over the original).
3. Verifies identical row counts per table, RLS enabled and forced on every table, same policies and migrations,
   and a live isolation check as the application role.
4. Drops the scratch database; `--record` stores the evidence on Admin → Health (“Backups, restore & load tests”).
A self‑test was done: with RLS removed from one table, the drill **failed** and named the table.

## Full recovery procedure (production)
1. **Declare the incident**: status page + Service notice (“lead capture may be affected”). Stop the scheduler
   (Supabase → Cron → disable `bluewater-jobs`) so nothing sends while you restore.
2. **Restore** the chosen Supabase backup **into a new project** (Supabase dashboard → Database → Backups → Restore
   to new project). Never restore over the broken one until you've looked at it.
3. Run migrations if needed (`npm run db:migrate` against the new project) and set the app role password.
4. **Verify** with the drill's checks (point `DATABASE_MIGRATION_URL` at the new project and run the drill with
   `--keep`, or run `tests/integration/isolation.test.ts` against it).
5. **Switch** Vercel's `DATABASE_URL`/`DATABASE_MIGRATION_URL` to the new project; redeploy.
6. **Reconcile newer external records** before resuming automation:
   - Leads that arrived after the backup point: website forms resend on failure only briefly — ask clients to check
     their form tool; Meta leads are recovered by the hourly missed‑lead check (Meta keeps them 90 days); use
     **Re‑import ad data** for spend; Cal.com bookings: ask Cal.com support/export, or re‑enter.
   - Messages sent after the backup point are **not** in the restored database. Before resuming, review Health; follow‑up
     steps more than a day late are **paused automatically** instead of sent (D‑39), and acknowledgments older than
     24 h cancel themselves — the system never sends a backlog of days.
7. **Resume**: re‑enable the scheduler, watch Health for 30 minutes, update the status page, send a recovery notice.

## Company‑specific recovery
There is no one‑click single‑company restore. To recover one company's records: restore a backup into a separate
database (drill with `--keep`), then copy that company's rows back with a developer, using `company_id` filters.
Deleted company data (Admin deletion) is only recoverable this way within the backup retention (7 days).

## Rollback of a deployment
Code rollback ≠ data rollback. Vercel → Deployments → previous → **Promote**. Migrations are additive by policy;
a migration that drops or rewrites data must say so in its file and in the release notes, with a tested backup first.
