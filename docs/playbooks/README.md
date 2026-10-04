# Incident Playbooks

Each playbook covers: **symptoms · detection · impact · containment · owner steps · developer steps · safe
diagnostics · escalation · customer communication · verification · prevention**. Short ones fold several of these into
one line. Keep a copy of this folder **outside** the application (password manager secure note or a printed binder),
since you may need it when the site is down.

**How they were tested (Stage 7):** the recovery tools each playbook relies on have automated tests with a controlled
failure (marked ✔ below): restore drill (`scripts/restore-test.ts`, incl. a deliberately broken copy), stopped
scheduler (health turns *degraded*), failed website submissions + Retry, alerts opening once and recovering once,
follow‑ups more than a day late pausing instead of sending, Bluewater's automation pause, redacted diagnostics,
restricted deletion. Steps that need live provider dashboards (Vercel, Supabase, Twilio, DNS) are written from the
providers' documented screens and must be walked through once on staging (LAUNCH_CHECKLIST.md).

**Escalation ladder:** you (owner, 7am–1am ET) → the developer → the provider's support (Vercel, Supabase, Twilio,
Postmark, Meta, Google, Cal.com — links in ACCOUNT_INVENTORY.md). **Customer communication:** status page first,
then Admin → Service notices to affected owners; reply on their support requests with the BW‑ reference.

| Playbook | Status |
|---|---|
| Site outage | Written · health/alert path tested ✔ |
| Broken deployment | Written |
| Domain / DNS / certificate | Written |
| Login or invitation failure | Written |
| Missing or incorrect records | Written |
| Stopped lead capture | Written · retry tested ✔ |
| Suspected company data exposure | Written · isolation checks tested ✔ |
| Expired integration access · API changes | Written |
| Failed, duplicate or uncertain messages | Written · unknown‑send handling tested ✔ |
| Missing replies | Written (needs live provider) |
| Follow‑ups after a stop condition | Written · stop rules tested ✔ |
| Booking & timezone errors | Written |
| Reporting discrepancies | Written |
| Stopped background jobs | Written · stale/late handling tested ✔ |
| Database or storage exhaustion | Written · size alert ✔ |
| Credit exhaustion / provider suspension | Written (needs live provider) |
| Provider outages | Written · automation pause tested ✔ |
| Accidental deletion | Written · restore drill ✔ |
| Exposed credentials | Written |

## Site outage
- **Symptoms / detection:** the uptime monitor alerts (non‑200 from `/api/health`); clients can't open the app.
- **Impact:** while the web app is down, website forms posting to Bluewater fail (most form tools show an error to the
  visitor or retry); webhooks from Meta/Cal.com are retried by those providers for hours; nothing is sent.
- **Containment / owner steps:** 1) open `https://<app>/api/health` yourself: *down* = database unreachable → check
  status.supabase.com and Supabase dashboard; *degraded* = scheduler (see *Stopped background jobs*); no answer at all →
  check vercel-status.com and Vercel → Deployments (was something just deployed? → *Broken deployment*). 2) Post on the
  status page. 3) If it lasts > 30 min, send a Service notice once the admin works again (or email owners directly).
- **Developer steps:** Vercel → Logs for 5xx; Supabase → Reports (CPU, connections); recent migrations.
- **Verification:** health back to `ok`; submit a test lead to a test company's form; Health shows no open alerts.
- **Recovery:** Meta leads missed are fetched by the hourly missed‑lead check; ask clients whose website forms showed
  errors to check their form tool's submissions list; acknowledgments older than 24 h cancel themselves (no late
  “thanks for reaching out” a day later); follow‑ups > 24 h late pause for review.
- **Prevention:** keep staging; load test before big changes; alerts at 6 GB database size.

## Broken deployment
- **Symptoms:** errors right after a deploy; a page fails for everyone; uptime alert minutes after a release.
- **Containment:** Vercel → Deployments → previous good deployment → **Promote to Production** (instant). This rolls
  back code only. If the release included a migration, check its notes: additive migrations are safe to leave;
  anything destructive must have had a backup first (DEPLOYMENT.md).
- **Verification:** health `ok`, sign in as a test owner, submit a test lead.
- **Prevention:** checks on every pull request (`typecheck`, `lint`, `test`, `build`), deploy to staging first.

## Domain / DNS / certificate
- **Symptoms:** “site can't be reached” or certificate warnings; the Vercel URL (`*.vercel.app`) still works.
- **Owner steps:** registrar → is the domain renewed? DNS → does the CNAME match what Vercel → Domains shows? Vercel
  issues certificates automatically once DNS is right (can take up to an hour after a fix).
- **Containment:** clients can use the `*.vercel.app` address temporarily (sign‑in still works if `APP_BASE_URL` is
  unchanged; invitation/reset links will point to the main domain).
- **Prevention:** auto‑renew the domain; registrar login + 2FA in your password manager; calendar reminder 30 days before.

## Missing or incorrect records
- **Symptoms:** a client says a lead is missing, duplicated or shows the wrong details.
- **Safe diagnostics:** search the lead by email/phone (Leads); open its **History** (every change, who, when); check
  Health → Lead capture for failed submissions; check the form's source on Connected Accounts (last received).
- **Owner steps:** duplicates are by design for repeat inquiries (same person, new request); different details on a
  match are noted in History, never overwritten. Missing: see *Stopped lead capture*. Wrong data: correct it on the
  contact (logged).
- **Developer steps:** look up the intake event by time (`app.intake_events`), and the request ID from the client's
  error page in Admin → Activity.
- **Escalation:** if data appears in the wrong company → *Suspected company data exposure* immediately.

## Stopped lead capture
- **Symptoms:** a client's leads stop arriving; Health alert “Website submissions waiting to be processed”;
  Connected Accounts shows an old “last received”.
- **Owner steps:** 1) Health → **Lead capture → Retry** (✔ tested: failed submissions become leads, once). 2) Is the
  company Active (churned/archived refuse new leads)? 3) Has the client changed their website/form (key, allowed
  website)? Send a test submission from the form page instructions. 4) Ad leads: *Expired integration access*.
- **Never** re‑enter leads by hand without checking first — Retry and the missed‑lead check record each lead once.
- **Communication:** tell the client how many leads were recovered and whether any acknowledgments were skipped
  because they were too old (they should call those people).

## Database or storage exhaustion
- **Detection:** alert “Database is getting full” (at 6 GB; Supabase Pro includes 8 GB); Health → Database shows size,
  connections and the biggest tables.
- **Containment:** Supabase → Settings → Compute/Disk: increase disk (pay‑as‑you‑go, small cost — your approval).
  Too many connections: check for a runaway job on Health; restart via redeploy.
- **Prevention / developer:** apply the retention policy (RETENTION.md — old job rows and delivery events can be
  trimmed), archive and delete data of companies that left (with their agreement).

## Credit exhaustion / provider suspension (Twilio, Postmark)
- **Symptoms:** alert “Many messages are failing”; messages *Failed* with reasons like “insufficient funds”, “account
  suspended”, “campaign rejected”.
- **Containment:** pause automatic messages for affected clients (company page → **Stop automatic messages**, ✔ tested)
  so leads are still captured but nothing piles up; top up / resolve with the provider; then turn automatic messages
  back on. Follow‑ups that were stopped by the pause don't restart (by design) — re‑enroll important leads by hand.
- **Communication:** tell affected clients to call new leads personally until fixed.
- **Prevention:** auto‑recharge on Twilio with a low‑balance email; text limits per client (BILLING.md).

## Provider outages (Twilio, Postmark, Meta, Google, Cal.com, Supabase, Vercel)
- Check the provider's status page. Messaging outage: sends become *failed* or *unknown*; for long outages pause
  automatic messages for affected clients (as above). Meta/Google outage: leads are recovered by the hourly missed‑lead
  check / platform retries; use **Re‑import ad data** for spend once it's back. Cal.com: bookings arrive when its
  webhooks resume (they retry). Supabase/Vercel: *Site outage*.
- After any outage: Health → unknown messages (resolve each after checking the provider log), dead jobs, follow‑ups
  paused after a delay (decide per lead).

## Accidental deletion
- **Lead/contact “deleted” by a client?** The app has no delete for leads (they're closed as Lost) — check the list filters first.
- **Company data deleted by an administrator:** it's recorded (Admin → Activity, company page). Recovery only from a
  backup within 7 days: restore into a **separate** database (RECOVERY.md, restore drill with `--keep`, ✔ tested) and have
  the developer copy that company's rows back. Never restore the whole production database over newer data.
- **Prevention:** deletion only for archived companies, with the exact name typed and two‑step verification; the
  database itself refuses otherwise (✔ tested).

## Missing replies (people say they replied, nothing in the inbox)
- **Check:** the client's sender status (company page → Senders); Twilio → Messaging logs for incoming messages to that
  number; Postmark → Inbound. If the provider shows it but Bluewater doesn't: the webhook address or signature is wrong
  (Health shows webhook problems; developer checks `TWILIO`/`POSTMARK` webhook settings in DEPLOYMENT.md §3c).
- **Communication:** ask the client to check the person's details; reply to them directly in the meantime.

## Login or invitation failure
- **Symptoms:** "That email and password don't match", "Too many attempts", invitation link "can't be used".
- **Owner steps:** confirm the person uses the invited email; for "too many attempts" wait 15 minutes or send a
  password reset; for expired/used invitations, cancel and re‑send from Settings → Team (clients) or the
  company page (owners, from `/admin`). Check the company's status — Archived companies can't sign in.
- **Developer steps:** check Supabase → Authentication → Logs for the user; confirm the email template link
  format; confirm the user row is `active` and the membership exists.

## Failed, duplicate or uncertain messages
- **Symptoms:** "acknowledgment problem" alert emails; dashboard *failed* or *uncertain* counts; messages marked
  Failed/Unknown in a conversation.
- **Owner steps:** open `/admin/health`. *Failed* = the provider refused (bad number, opted out at carrier,
  sender not set up) — the client team was alerted to reach out personally. *Unknown* = Bluewater lost track
  mid‑send; check Twilio → Monitor → Messaging logs (or Postmark → Activity) for that time and address, then
  mark it delivered or failed. Never re‑send without checking — the person may already have it.
- **If many fail at once:** press the client's **Emergency stop** (Automations) or suspend the company, then check
  the sender status and provider dashboard (suspended number, unpaid balance, A2P campaign rejected).
- **Duplicates:** the database allows one acknowledgment per inquiry and one send per job key; if a person
  reports two texts, capture both times and the conversation link for the developer.

## Stopped background jobs
- **Symptoms:** Health page "Scheduler last ran" flagged (older than 5 minutes); leads arrive but no
  acknowledgments; jobs piling up as *queued*.
- **Owner steps:** Supabase → Integrations → Cron → check the `bluewater-jobs` job's recent runs. A 401 means
  `JOB_TRIGGER_SECRET` in Vercel and in the cron job don't match. Failures/time‑outs → check Vercel → Logs for
  `/api/jobs/run`.
- **Safe recovery:** once the trigger runs again, waiting jobs are processed automatically; acknowledgments older
  than 24 hours cancel themselves rather than reach someone a day late. Jobs a crashed worker held are re‑queued
  by the housekeeping step; messages it was sending become *Unknown* (see above).

## A follow‑up went out after the person asked to stop
- **Contain:** open the lead → **Stop** the follow‑up; on the conversation **Record opt‑out** for that channel. If
  several people are affected, use the client's **Emergency stop** (Automations) — it stops every follow‑up for good.
- **Check:** the lead's History shows when the follow‑up started and when (and why) it stopped. If the reply/booking
  came in another way Bluewater can't see (phone call, a different email), that's expected — mark the lead
  Contacted/Booked or stop the follow‑up as soon as a person takes over. If History shows a reply *before* the
  message, capture the lead link and time for the developer (every step re‑checks replies; this would be a bug).
- **Customer communication:** apologize once, confirm they won't hear from the automation again.

## Booking problems (missing, wrong lead, wrong time)
- **Missing booking:** Connected Accounts → Scheduling shows the last message from Cal.com and the last problem. "Wrong
  signature" → create a new webhook address and paste the new secret into Cal.com. No messages at all → check the
  webhook in Cal.com is active and has the three booking triggers; press Ping test.
- **Attached to a new lead:** the person booked from the general page with a different email/phone (no personal link).
  Add a note on both leads; nothing is lost.
- **Wrong time:** times are stored as exact instants and shown in the business's timezone (Settings). Check the
  business timezone first, then the time zone in the Cal.com event. Reminders follow reschedules automatically.

## Ad connection expired or ad leads stopped arriving
- **Symptoms:** Connected Accounts shows "Needs reconnecting" or a problem; Health lists the client under Advertising
  connections; leads from Facebook/Google stop appearing.
- **Owner steps:** the client (or you in a support session with edit access) presses **Reconnect** and signs in again;
  check the Page still shows **Receiving leads**. Leads Meta sent while access was broken are picked up by the hourly
  missed‑lead check once reconnected (Meta keeps them 90 days). Google lead forms: check the webhook in Google Ads and
  press **Send test data**.
- **Developer steps:** check `ad_lead_events` for `failed` rows and the job errors on Health; check the platform's API
  version hasn't been retired (`META_GRAPH_VERSION`, `GOOGLE_ADS_API_VERSION`).

## "The numbers don't match the ad platform"
- Spend is shown for the ad account's own days and currency, for the **selected** ad accounts only; platforms revise the
  last few days (Bluewater re‑imports the last 7 days every 6 hours). Check the Reports freshness note first.
- "Leads" in Bluewater are real records; the platform's lead/conversion counts use their own definitions (shown
  separately). Leads without a campaign id are listed as not credited — this is expected (METRICS.md, D‑33).

## Exposed credentials (a key or password was shared or committed)
- **Contain immediately:** rotate the secret at its source (Supabase API keys, Postmark token, database
  password via `ALTER ROLE`, `ENCRYPTION_KEY` only with a re‑encryption plan); update Vercel variables;
  redeploy; for a user password, use "Sign out everywhere" and reset.
- **Check:** provider access logs for use of the old secret; GitHub secret scanning; remove from git history
  only after rotation (rotation is what actually protects you).

## Suspected company data exposure
- **Contain:** suspend affected companies' sending if needed; capture request IDs and times; do not delete logs.
- **Investigate:** activity log for support sessions; database role used (must be `bluewater_app`); confirm
  RLS is still enabled and forced (`tests/integration/isolation.test.ts` checks this — run it against staging).
- **Communicate:** legal counsel before notifying affected clients (notification duties vary by state).
