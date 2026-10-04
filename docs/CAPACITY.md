# Capacity

**Status:** Stage 7. Load test implemented (`scripts/load-test.ts`) and run on 2026‑10‑04 in the sandbox
(local PostgreSQL 16 + `next start` production build). Results are **local measurements**, not Vercel/Supabase.

## Pilot targets (D‑15)
Up to 10 companies, 50 users, 500 leads/day, **peak 5 lead events/second**, 5,000 messages/day.

## Measured
| Test | Target | Result (HTTP, production build) | Result (in‑process, on a database with 1 year of volume) |
|---|---|---|---|
| Sustained intake, 60 s | 5 leads/s, none lost | **5.0/s, 300/300 accepted, p50 21 ms, p95 30 ms, max 127 ms** | 5.0/s, 300/300, p95 26 ms |
| Burst: 50 simultaneous submissions | none lost | **50/50 accepted, max 506 ms** | 50/50, max 336 ms |
| Per‑form rate limit (30/min, D‑22) | refuses with 429, stores nothing | **30 accepted, 10 refused (429)** | same |
| Every accepted lead stored and acknowledged exactly once | 100 % | **380 leads → 380 acknowledgments, 0 duplicates, 0 lost, 0 dead jobs** | same |
| Queue drain (2 workers in parallel) | 5,000 messages/day | Server processed the work immediately after each request | **760 jobs in 11.4 s (≈ 67 jobs/s)** — with the once‑a‑minute scheduler (40 s budget) that is ≈ 3.8 million jobs/day, far above the ~10,000/day the pilot needs |
| Restore at 1‑year volume | RTO 4 h | 41 s locally (RECOVERY.md) | |

The in‑process run used a database pre‑filled with 182,739 leads and 1.8 million messages (≈ one year at target
volume) so indexes were exercised at realistic size.

## How the system protects itself under load (spec §18)
- Leads are **stored before** anything else happens; a lead is never acknowledged to the sender until it's saved.
- Rate limit per form (30/min) refuses with 429 (the sender can retry) — nothing half‑stored.
- Background queue: `FOR UPDATE SKIP LOCKED` (workers never take the same job), at most 5 jobs per company per batch
  (one busy client can't starve others), and **priorities**: new‑lead work (record ad lead, acknowledgment) first,
  alerts next, booking messages, then follow‑ups, then reports/imports (D‑40).
- Sends are idempotent (one acknowledgment per lead, one send per job key); uncertain sends are never retried.
- Lists are paginated; indexes on every company‑scoped lookup.

## Limits and upgrade path
| Limit | Pilot setting | Warning | Upgrade |
|---|---|---|---|
| Database size | Supabase Pro 8 GB | Alert at 6 GB | More disk (pay‑as‑you‑go ~$0.125/GB) or apply retention |
| Database connections | Supabase pooler | Health shows connections / max | Larger compute add‑on |
| Scheduler | 1 run/minute, 40 s budget | Alert when a job waits > 10 min | More frequent runs or a dedicated worker |
| Vercel function time | 60 s | — | Vercel Pro already assumed |
| Text sending (Twilio) | Per‑client A2P campaign throughput | Twilio errors raise “Many messages are failing” | Twilio campaign type upgrade |

## Running it again
```bash
# against a running staging/test server (never production — the script refuses APP_ENV=production)
npx tsx scripts/load-test.ts --url https://staging.yourdomain.com --seconds 60 --record
```
The script creates throwaway “Load test” companies (internal test kind, simulated sending), and deletes their data
afterwards with the same restricted deletion used for real companies.
