# Incident Playbooks

Each playbook will contain: symptoms · detection · impact · containment · owner steps · developer steps ·
safe diagnostics · escalation · customer communication · verification · prevention — using real screens and
tested commands. Playbooks are written as the features they cover are built, and tested in Stage 7.
Keep a copy of this folder **outside** the application (e.g. in your password manager's secure notes or a
printed binder), since you may need it when the site is down.

| Playbook | Stage | Status |
|---|---|---|
| Login or invitation failure | 1 | Draft below |
| Exposed credentials | 1 | Draft below |
| Suspected company data exposure | 1 | Draft below |
| Site outage · broken deployment · domain/DNS/certificate | 7 | Planned |
| Missing/incorrect records · stopped lead capture | 2 | Planned |
| Failed or uncertain messages · stopped background jobs | 3 | Draft below |
| Missing replies · follow‑ups after stop · credit exhaustion/provider suspension | 3–4 | Planned (needs live providers) |
| Booking & timezone errors | 4 | Planned |
| Expired integration access · API changes · reporting discrepancies | 5 | Planned |
| Database/storage exhaustion · accidental deletion · provider outages | 7 | Planned |

## Draft: Login or invitation failure
- **Symptoms:** "That email and password don't match", "Too many attempts", invitation link "can't be used".
- **Owner steps:** confirm the person uses the invited email; for "too many attempts" wait 15 minutes or send a
  password reset; for expired/used invitations, cancel and re‑send from Settings → Team (clients) or the
  company page (owners, from `/admin`). Check the company's status — Archived companies can't sign in.
- **Developer steps:** check Supabase → Authentication → Logs for the user; confirm the email template link
  format; confirm the user row is `active` and the membership exists.

## Draft: Failed or uncertain messages
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

## Draft: Stopped background jobs
- **Symptoms:** Health page "Scheduler last ran" flagged (older than 5 minutes); leads arrive but no
  acknowledgments; jobs piling up as *queued*.
- **Owner steps:** Supabase → Integrations → Cron → check the `bluewater-jobs` job's recent runs. A 401 means
  `JOB_TRIGGER_SECRET` in Vercel and in the cron job don't match. Failures/time‑outs → check Vercel → Logs for
  `/api/jobs/run`.
- **Safe recovery:** once the trigger runs again, waiting jobs are processed automatically; acknowledgments older
  than 24 hours cancel themselves rather than reach someone a day late. Jobs a crashed worker held are re‑queued
  by the housekeeping step; messages it was sending become *Unknown* (see above).

## Draft: Exposed credentials (a key or password was shared or committed)
- **Contain immediately:** rotate the secret at its source (Supabase API keys, Postmark token, database
  password via `ALTER ROLE`, `ENCRYPTION_KEY` only with a re‑encryption plan); update Vercel variables;
  redeploy; for a user password, use "Sign out everywhere" and reset.
- **Check:** provider access logs for use of the old secret; GitHub secret scanning; remove from git history
  only after rotation (rotation is what actually protects you).

## Draft: Suspected company data exposure
- **Contain:** suspend affected companies' sending if needed; capture request IDs and times; do not delete logs.
- **Investigate:** activity log for support sessions; database role used (must be `bluewater_app`); confirm
  RLS is still enabled and forced (`tests/integration/isolation.test.ts` checks this — run it against staging).
- **Communicate:** legal counsel before notifying affected clients (notification duties vary by state).
