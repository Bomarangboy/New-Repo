# Monitoring and Alerts

**Status:** Stage 7. The in‑app checks are implemented and tested. The **external** pieces (uptime monitor, status
page, error tracker) are accounts the owner creates at deployment — they are listed in `LAUNCH_CHECKLIST.md`.

## Two layers (D‑17, D‑41)
| Layer | Watches | Alerts by | Works when the app is down? |
|---|---|---|---|
| **External uptime monitor** (e.g. UptimeRobot / Better Stack free tier) | `GET https://<app>/api/health` every 1–5 min | The monitor's own app push / SMS / email | **Yes** — that's its purpose |
| **In‑app alerts** (every minute, inside the scheduler's maintenance step) | Queue delays, failed jobs, intake failures, message failures, unknown sends, ad connections, usage limits, overdue payments, database size | Email to every active Bluewater administrator | No (if the scheduler is down, the uptime monitor catches it: health turns *degraded*) |
| Error tracker (Sentry free tier, optional) | Unexpected server errors with reference IDs | Sentry email/app | Yes |

### `/api/health`
Public, no login, reveals nothing about clients: `{"status":"ok|degraded|down","checks":{"database":"ok","scheduler":"ok|late"}}`.
- `200` when everything is fine; `503` when the scheduler hasn't run for 5 minutes (**degraded**) or the database
  can't be reached (**down**). Configure the monitor to alert on any non‑200 for 2 checks in a row.
- Tested: `tests/e2e/stage7.spec.ts` (no client data in the response). In the sandbox with no scheduler it correctly
  reported `degraded / scheduler late`.

### In‑app alert rules (`src/server/ops/alerts.ts`)
| Alert | Opens when | Severity |
|---|---|---|
| Background work is delayed | Oldest due job has waited > 10 min | critical |
| Some background jobs gave up | Any job reached “dead” in the last 7 days | warning |
| Website submissions waiting | Any intake event failed in the last 24 h | warning |
| Messages with an unconfirmed result | Any message is “unknown” | warning |
| Many messages are failing | > 20 % of ≥ 10 real messages failed in the last hour | critical |
| *Client*: Meta/Google needs reconnecting | Ad connection status *needs reconnect* | warning |
| *Client*: ad leads couldn't be recorded | Failed ad lead events in 24 h | warning |
| *Client*: 80 % / 100 % of text limit | Text segments this month vs the client's limit | warning |
| *Client*: payment overdue | Invoice failed, or unpaid past due date + grace days | warning |
| Database is getting full | Size > 6 GB (Supabase Pro includes 8 GB; change via platform setting `db_warn_gb`) | warning |

**Grouping and recovery notices:** each alert has a key; a problem opens it once (one email listing all new problems),
it stays open silently while it lasts, and resolves itself when the measurement is healthy again (one “RECOVERED”
email). 50 failures = one alert. Tested in `operations.test.ts` (opens once, no repeat, resolves with one recovery email).

## Where to look
- **Admin → Health & Recovery**: open alerts, scheduler last run, queue depth and oldest job, failed/dead jobs, unknown
  messages, database size and connections, biggest tables, lead capture failures (retry button), ad connections,
  follow‑ups paused after a delay, re‑import ad data, backup/restore/load‑test records.
- **Admin → Activity**: who did what, with request IDs (the reference shown on error pages).

## Status page (communication outside the app)
Create a free status page with the same monitoring provider (e.g. `status.yourdomain.com`) and link it from your
service agreement. During an incident: update the status page first, then send a **Service notice** (Admin → Service
notices) to the affected owners. Notices are drafted, the exact recipient list is shown, and sending requires
confirming that count (tested).
