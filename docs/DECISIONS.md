# Decision Register

Every material choice, why it matters, what was chosen, and what is still open.
**Prices are list prices found on the providers' own sites (via search, 2026‑10‑04), not quotes.**
Direct page fetches were blocked by this development environment's network policy, so every price
below must be re‑checked on the linked page before you buy anything. Nothing has been purchased.

Status key: **Decided** (owner approved) · **Assumed** (reasonable default; reversible; tell me if wrong) ·
**Open** (needs your decision) · **Blocked** (waiting on an outside party).

| ID | Decision / dependency | Status | Blocks |
|----|----------------------|--------|--------|
| D‑01 | Launch scope | **Decided** — pilot Bluewater Connect and Engage | — |
| D‑02 | Stack & hosting | **Decided** — Next.js + Supabase + Vercel | — |
| D‑03 | Authentication | **Decided** (follows D‑02) — Supabase Auth | Live sign‑in only |
| D‑04 | Database access & isolation | **Assumed** — Drizzle ORM + Postgres RLS | — |
| D‑05 | Market / jurisdiction | **Decided** — United States only | — |
| D‑06 | Sender ownership | **Decided** — Bluewater‑managed, per client | Live sending |
| D‑07 | Background jobs | **Assumed** — Postgres job table + Supabase Cron trigger | Stage 3 |
| D‑08 | Email provider | **Assumed** — Postmark | Live email |
| D‑09 | SMS provider | **Assumed** — Twilio (subaccount per client) | Live SMS |
| D‑10 | Calendar / booking connector | **Decided** — Cal.com (built Stage 4; live check pending) | — |
| D‑11 | First external CRM connector | **Open** — wait for first client | Stage 6 |
| D‑12 | Environments | **Assumed** — dev, staging, demo, production | Deployment |
| D‑13 | Budgets | **Decided** — about $100/month total | Purchases |
| D‑14 | Support hours & escalation | **Decided** — 7am–1am Eastern, owner | Launch |
| D‑15 | Capacity & recovery targets | **Assumed** (proposed below) | Launch |
| D‑16 | Billing | **Assumed** — manual invoicing first | — |
| D‑17 | Monitoring & independent alerts | **Assumed** — Sentry + external uptime monitor | Launch |
| D‑18 | Legal review | **Owner‑managed** — owner arranges; live sending stays off until owner confirms | Live sending |
| D‑19 | Pipeline unit | **Assumed** — pipeline stage lives on each inquiry | — |
| D‑20 | Messaging eligibility of stored leads | **Assumed** — only live submissions on active accounts | — |
| D‑21 | Duplicate handling | **Assumed** — match on email or phone; never overwrite | — |
| D‑22 | Intake abuse controls | **Assumed** — allowed websites, spam trap, 30/min, optional signing | — |
| D‑23 | Where real messages may be sent from | **Assumed** — production only | — |
| D‑24 | Acknowledgment channel & timing | **Assumed** — text if permitted, else email; sending window | — |
| D‑25 | Uncertain sends | **Assumed** — never auto‑retry; mark "unknown" for review | — |
| D‑26 | Editing a running follow-up | **Assumed** — edits create a new version; people already enrolled finish the old one | — |
| D‑27 | Confirmations/reminders vs Cal.com's own | **Assumed** — Bluewater texts; Cal.com emails (Bluewater emails only if owner opts in) | — |
| D‑28 | Stopped follow-ups | **Assumed** — never restart automatically (incl. after emergency stop, cancellation, upgrade) | — |
| D‑29 | Which system owns appointments | **Assumed** — Cal.com for its bookings; Bluewater for ones the team enters | — |
| D‑31 | Live ad connections | **Assumed** — off until owner sets `ADS_LIVE_ENABLED` (staging/production only); simulated elsewhere; "unavailable" for real customers until then | Live ads |
| D‑32 | Text permission from ad lead forms | **Assumed** — none assumed; acknowledgment by email | — |
| D‑33 | Crediting leads to campaigns | **Assumed** — only by campaign id delivered with the lead; no guessing from names | — |
| D‑34 | Google lead forms | **Assumed** — via Google's lead-form webhook (no API approval needed) | — |
| D‑35 | One Facebook Page → one company | **Assumed** — database rule | — |
| D‑30 | Booking from an unknown person | **Assumed** — recorded as a new lead ("Cal.com booking"), never auto‑messaged except confirmations/reminders | — |
| D‑36 | Weekly owner summaries (Bluewater Insight) | **Assumed** — email Mondays from 8am local; last Mon–Sun; owners only; can be turned off | — |
| D‑37 | Usage limits & billing | **Assumed** — manual invoices; limits alert or pause *automatic texts* only; never auto‑suspend for payment | Pricing (owner) |
| D‑38 | Retention & deletion | **Assumed** — keep while client; delete only archived companies on request; keep billing, history, audit, opt‑outs | Legal review (D‑18) |
| D‑39 | Late follow‑ups after an outage | **Assumed** — a step > 24 h late is paused for a person, never sent | — |
| D‑40 | Work priorities under load | **Assumed** — new‑lead work first, reports last | — |
| D‑41 | Alerts | **Assumed** — grouped, email on open/recover only; public `/api/health` for the external monitor | Monitor account (owner) |
| D‑42 | Sales‑demo prospect workspaces | **Assumed** — demo site only; 1–30 days; deleted 7 days after expiry | Demo deployment |
| D‑44 | Package names | **Decided** — Bluewater Connect (1), Bluewater Engage (2), Bluewater Insight (3) | — |
| D‑43 | Support requests & notices | **Assumed** — in‑app tickets with BW‑ references; notices need recipient‑count confirmation | — |

---

### D‑01 Launch scope — Decided
- **Why it matters:** Sets what can be sold first and which outside approvals are on the critical path.
- **Chosen:** Pilot Packages 1 (Instant Response) and 2 (Follow‑Up & Booking) with 1–3 pilot clients.
  Bluewater Insight follows when Meta App Review/Business Verification and Google Ads API access are approved.
- **Alternatives:** Bluewater Connect only (fastest); all three (waits on Meta/Google approvals, weeks, outside our control).
- **Blocks:** Nothing in development.

### D‑02 Stack & hosting — Decided (owner chose this over the Render recommendation)
- **Chosen:** Next.js 16 (TypeScript, one codebase for screens + server), **Supabase** (Postgres database,
  Auth, file storage, scheduled triggers), **Vercel** (web hosting, HTTPS, previews).
- **Impact of this choice (documented per the spec):** Vercel cannot run an always‑on background worker.
  See D‑07 for how durable background work is handled without adding a third vendor.
- **Vercel plan:** Hobby is *personal, non‑commercial* use only, so production must use **Pro** (listed
  $20/month per member) — [vercel.com/pricing](https://vercel.com/pricing), [plans](https://vercel.com/docs/plans).
  Pro also allows per‑minute Cron; Hobby cron is once per day ([cron pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)).
- **Supabase plan:** Pro listed from $25/month per organization, includes $10/month compute credits
  (one Micro instance); daily backups kept 7 days; Point‑in‑Time Recovery is an add‑on listed at
  $100/month per 7 days of retention ([pricing](https://supabase.com/pricing), [backups](https://supabase.com/docs/guides/platform/backups),
  [PITR](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery)).
  The Free plan has no automatic backups and pauses inactive projects — fine for development, **not** for production.
- **Portability:** Standard Postgres + standard Next.js. The database can be moved to any Postgres host;
  the app can run on any Node.js host. Supabase Auth is the main lock‑in (see D‑03).

### D‑03 Authentication — Decided (consequence of D‑02)
- **Chosen:** Supabase Auth (email + password, TOTP two‑step verification, password reset).
  Public sign‑up is disabled: every account comes from an invitation.
  Bluewater's own tables hold roles, companies and memberships, so authorization never depends on the provider.
- **Local development/testing:** a local identity provider with identical behavior (hashed passwords,
  TOTP, revocable sessions). It refuses to start on any hosted or non‑development environment (tested).
  Reason: this build environment cannot download Supabase's local containers.
- **Status:** Supabase path *implemented, awaiting live verification* (needs your Supabase project).
- **Lock‑in & exit:** Users can be exported from Supabase; passwords would need a reset on migration.

### D‑04 Database access & isolation — Assumed
- **Chosen:** Drizzle ORM with SQL migrations. All tables in a private `app` schema (not reachable through
  Supabase's browser Data API). **Row Level Security** on every table, enforced against a dedicated
  `bluewater_app` database role that cannot bypass it. The app sets the verified company per transaction.
- **Why:** Two independent barriers between companies: application checks *and* the database itself.
- **Alternative:** Supabase client + RLS keyed on Supabase JWTs (ties data access to Supabase Auth); Prisma.
- **Live check needed:** confirm Supabase's connection pooler accepts the custom `bluewater_app` role
  (`bluewater_app.<project-ref>` user name).

### D‑05 Market — Decided: United States only
- US A2P 10DLC registration applies to business texting from ordinary 10‑digit numbers (see D‑09).
- Consent and messaging rules (e.g., TCPA, CAN‑SPAM, state laws) require qualified legal review (D‑18).
  The software records consent evidence and honors opt‑outs; it does **not** guarantee legal compliance.

### D‑06 Sender ownership — Decided: Bluewater‑managed, per client
- **Texting:** Bluewater's Twilio account with one **subaccount per client**, one number per client, and a
  separate A2P 10DLC brand/campaign registration per client business. Bluewater pays usage and re‑bills.
- **Email:** Bluewater's Postmark account; each client verifies **their own sending domain** (DNS records)
  so messages come from the client's name and reputation is separated per client.
- **At cancellation:** numbers can usually be ported to the client's own carrier account on request;
  porting is carrier‑dependent and not guaranteed. Domains always remain the client's.
- **Needs from you:** contract language on ownership/porting and usage re‑billing (D‑18).

### D‑07 Background jobs — Assumed (Stage 3)
- **Problem:** Follow‑ups must run while every browser and your computer are off; Vercel has no worker.
- **Proposed:** A `jobs` table in Postgres (durable; written in the same transaction as the lead, so a
  lead can't exist without its acknowledgment job). **Supabase Cron** (pg_cron + pg_net) calls a secret
  Vercel endpoint every minute to process due jobs in small, time‑limited batches; new leads are also
  processed immediately after the request. Every send re‑checks eligibility (reply, opt‑out, booking,
  pause, account status, sending window) right before sending.
  Docs: [Supabase Cron](https://supabase.com/docs/guides/cron), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net).
- **Alternatives:** Vercel Cron (Pro allows per‑minute); a managed queue (Inngest/Trigger.dev, adds a vendor);
  a small always‑on worker (Render/Railway/Fly, adds a vendor). Revisit if volume outgrows batch processing.

### D‑08 Email provider — Assumed: Postmark
- Separate **message streams** for Bluewater service email vs. client messages. Free developer tier 100
  emails/month; paid plans listed from $15/month for 10,000 emails ([pricing](https://postmarkapp.com/pricing)).
- Alternatives: Resend, SendGrid, Amazon SES (cheapest, more setup).

### D‑09 SMS provider — Assumed: Twilio
- Per [Twilio's A2P 10DLC fees](https://support.twilio.com/hc/en-us/articles/1260803965530-Pricing-and-Fees-for-A2P-10DLC-Service)
  (search results, 2026‑10‑04): brand registration $4.50 (sole proprietor / low‑volume standard) or $46
  (standard, includes secondary vetting); **$15 campaign vetting fee** per campaign; monthly campaign fees
  ~$1.50–$10; carrier pass‑through fees per message on top of Twilio's per‑segment price.
  Registration review typically takes days to weeks.
- Per‑message US price: **not verified** (pricing page blocked here) — check [twilio.com/en-us/sms/pricing/us](https://www.twilio.com/en-us/sms/pricing/us).

### D‑10 Calendar / booking connector — Decided: Cal.com (owner, 2026‑10‑04; built in Stage 4)
- **Built:** per‑client webhook address + signing secret (Bluewater generates both; the client pastes them into
  Cal.com), signature verified as Cal.com computes it (HMAC‑SHA256 of the body, hex, header `X-Cal-Signature-256`
  — confirmed in Cal.com's open‑source code, `packages/features/webhooks/lib/sendPayload.ts`). Booking links carry
  `metadata[bw]=<reference>` so bookings attach to the right lead. **Awaiting live verification** with a real
  Cal.com account (in particular that `metadata[...]` URL parameters arrive in the webhook's `metadata`).
- **Recommendation:** **Cal.com** — documented webhooks for booking created/rescheduled/cancelled with an
  HMAC signature header (`X-Cal-Signature-256`) ([docs](https://cal.com/docs/developing/guides/automation/webhooks)).
- **Alternatives:** Calendly (webhooks require a paid Calendly plan — verify), Google Calendar directly
  (we would have to build booking pages and availability ourselves).
- **Question for you:** what scheduling tools do your first pilot clients already use?

### D‑11 First external CRM — Open
- Per the spec, no connector is built until a client needs one. Built‑in CRM is complete‑first; the
  connector contract is documented in ARCHITECTURE.md. External CRM is shown as "Not available yet".

### D‑12 Environments — Assumed
| Environment | Address (example) | Supabase project | Vercel | Data |
|---|---|---|---|---|
| Development | your computer | local Postgres or free project | — | fictional |
| Staging | staging.yourdomain.com | separate project | Preview/branch | fictional |
| Sales demo | demo.yourdomain.com | **separate project** | separate project | fictional only; sending impossible |
| Production | app.yourdomain.com | separate project (Pro) | Production | real |
Each extra Supabase project adds compute cost (one Micro is covered by the included credit).

### D‑13 Budgets — Decided: about $100/month (owner, 2026‑10‑04)
- **Owner budget: about $100/month total.** Plan that fits (list prices, to re‑check before buying):
  Vercel Pro ~$20 · Supabase Pro ~$25 (production only) · staging and the sales demo on a **separate free
  Supabase organization** (free projects pause after inactivity — wake the demo project before a presentation) ·
  Postmark free tier (100 emails/month) during the pilot, Basic ~$15 once volume needs it · Twilio ~$1–2/month per
  number + campaign fee ~$1.50–10/month per client + usage · domain ~$1–2/month. Estimated **$60–95/month** for
  1–3 pilot clients. Texting usage grows with each client and should be re‑billed to clients (D‑06).
  Point‑in‑time recovery ($100/month) does **not** fit; daily backups (24‑hour recovery point) are the plan.
- Original question (answered): monthly ceiling for development/staging/demo and production.
  Rough fixed platform floor at pilot scale, before messaging usage: Vercel Pro ~$20 + Supabase Pro ~$25
  + extra Supabase projects for staging/demo (compute) + Postmark ~$15 + Twilio per‑client fees + monitoring
  (free tiers available). See COSTS.md.

### D‑14 Support hours & escalation — Decided (owner, 2026‑10‑04)
- **Support hours: 7:00am–1:00am Eastern, every day. Support person and emergency contact: the owner.**
  No 24/7 promise. Outside hours, the system keeps capturing leads and sending approved automatic messages;
  problems are queued for the morning, and independent uptime alerts (D‑17) reach the owner directly.
  Response‑time targets inside hours are still to be set by the owner.

### D‑15 Capacity & recovery targets — Assumed (proposal; not measured yet)
- Pilot: up to 10 companies, 50 users, 500 leads/day total, peak 5 lead events/second, 5,000 messages/day.
- Recovery Point Objective 24 h on Supabase Pro daily backups (≤ minutes with PITR add‑on);
  Recovery Time Objective 4 h. These are **targets**; Stage 7 measures them with a restore test.

### D‑16 Billing — Assumed
- Manual invoicing during the pilot. Packages and usage are tracked from day one; no payment provider is
  connected and no charges can be created by the app.

### D‑17 Monitoring — Assumed
- Error tracking (e.g. Sentry free tier) and an **external** uptime monitor that alerts by a channel that
  doesn't depend on our app or messaging providers (e.g., the monitor's own SMS/app push).

### D‑18 Legal review — Owner‑managed (owner, 2026‑10‑04)
- The owner will arrange the review. **Live sending to real people stays switched off until the owner tells us
  the review is done** (the go‑live checklist will record it). Additional item found in Stage 3: the FCC's updated
  opt‑out rules (revocation of consent "by any reasonable means", not only STOP) — Bluewater treats common
  opt‑out words as opt‑outs and lets staff record an opt‑out by hand; an attorney should confirm this is enough.
- Items requiring an attorney: consent language on client web forms and lead forms; TCPA/state texting
  rules and quiet hours; CAN‑SPAM; data retention/deletion terms; sender ownership/porting terms; terms of
  service and privacy policy; Meta/Google platform terms for storing lead data.

### D‑19 Pipeline unit — Assumed (Stage 2)
- Each **inquiry** has its own stage, assignee and sale value; the **contact** holds identity. A returning customer's
  new request is a new pipeline item, so lead‑to‑sale reporting stays per request. Alternative: one stage per contact
  (simpler, but loses repeat‑business history). Reversible with a data migration.

### D‑20 Which stored leads may receive automatic messages — Assumed (Stage 2)
- Only inquiries that arrived live through a connected source while the account was **active** are "eligible".
  Leads stored during onboarding/pause/suspension are "held" and are never messaged later (avoids sending stale
  acknowledgments at activation). Manual, imported and sample leads are "none"; Stage 3 adds an explicit,
  logged enrollment action with eligibility checks if you want to message one of them.

### D‑21 Duplicate contacts — Assumed (Stage 2)
- A submission matches an existing contact by normalized email or US phone. Existing details are never overwritten
  by a new submission (blanks are filled; differences are noted in history). If the email and phone match two
  different contacts, the inquiry attaches to the email match and is flagged. A merge tool is deferred.

### D‑22 Website intake abuse controls — Assumed (Stage 2)
- Per‑form allowed‑websites list (browser submissions), hidden spam‑trap field, 30 submissions/minute/form,
  optional HMAC signing for server‑to‑server use. CAPTCHA is not added by default (hurts conversion); revisit if
  spam appears. Rate‑limit counts live in the database (no extra service).

### D‑23 Live sending only from production — Assumed (Stage 3)
- Real texts/emails to customers are possible only when ALL are true: `APP_ENV=production`, `LIVE_SENDING_ENABLED=true`
  (owner approval), the company is a real customer (not demo/test), the company's sender is marked verified by
  Bluewater, and the account status allows sending. Development, test, staging and the demo always use the
  **simulated** transport, which records messages and shows them in the inbox labeled "Simulated".
  (Stage 1 allowed staging; tightened here so a test environment can never text a real person.)

### D‑24 Acknowledgment channel & timing — Assumed (Stage 3)
- Text first when the lead gave text permission for responses and the number isn't opted out; otherwise email
  (a direct reply to the person's own inquiry). If neither is possible, no acknowledgment is sent and the team
  is told why. Messages respect the company's sending window (default 8am–9pm local, every day); an inquiry
  outside the window is acknowledged when the window opens, unless more than 24 hours have passed — then it is
  skipped as stale rather than sent late. The team is notified immediately regardless of the window.

### D‑25 Uncertain provider outcomes — Assumed (Stage 3)
- If a send attempt is interrupted after it may have reached the provider (timeout, crash), the message is marked
  **unknown** and is never retried automatically (a duplicate text is worse than a delayed one). It appears in the
  administrator's messaging health list for a person to check with the provider and resolve.

### D‑26 Editing a running follow‑up sequence — Assumed (Stage 4)
- Saving changed steps creates a new **version**. People already in the sequence finish the version they started
  (they never get a half‑old, half‑new series, and what they were sent stays explainable); new enrollments use the
  new version. Renaming or changing stop rules doesn't create a version and applies immediately. Turning a sequence
  **off** stops everyone in it.

### D‑27 Confirmations and reminders alongside Cal.com — Assumed (Stage 4)
- Cal.com already emails attendees a confirmation. To avoid duplicates, Bluewater sends **texts** (only with text
  permission) and emails Cal.com bookings only if the owner ticks "also email". Appointments the team enters by hand
  get an email when a text isn't allowed. Defaults: confirmation right away, reminders 24 h and 2 h before. A reminder
  that can't go out inside sending hours at least 30 minutes before the appointment is skipped.

### D‑28 Stopped follow‑ups never restart — Assumed (Stage 4)
- A follow‑up stops for good when the person replies, books, opts out (text STOP, unsubscribe link, recorded by
  staff, spam complaint), the lead is marked Booked/Won/Lost, a team member messages them (configurable), the
  sequence is turned off, the emergency stop is used, the package no longer includes follow‑ups, or the account
  stops being active. Nothing restarts it automatically — including turning automation back on, cancelling the
  appointment or upgrading again. A team member can start a new one from the lead page.
- Leads that didn't arrive live through a connected form (manual, import, booking) can only be enrolled by a person
  who confirms the person asked to be contacted (recorded in the lead's history).

### D‑29 Which system owns appointments — Assumed (Stage 4)
- Cal.com is the record for bookings made there: reschedules/cancellations are done in Cal.com and arrive by webhook
  (Bluewater refuses to cancel them locally, because the customer wouldn't be told). Appointments the team enters
  (phone, in person) are owned by Bluewater. "Completed" and "No‑show" are Bluewater's own outcome notes for both.

### D‑30 Booking from someone Bluewater doesn't know — Assumed (Stage 4)
- Matching order: the reference in the booking link → a contact with the same email or phone → otherwise a new lead
  is recorded with source "Cal.com booking" (it goes through the normal duplicate checks). Such leads never get
  automatic follow‑ups; they do get the appointment confirmation/reminders (they asked for the appointment).

### D‑31 Live advertising connections — Assumed (Stage 5)
- Connecting real Meta/Google accounts needs Bluewater's approved apps and the owner's go‑ahead: `ADS_LIVE_ENABLED=true`
  (refused by the app outside staging/production). Until then development, test and demo use **simulated** platforms
  (labeled everywhere), and real customers in production see "Not available yet" — never sample numbers.

### D‑32 Text permission from ad lead forms — Assumed (Stage 5)
- Submitting a lead form shares contact details, but doesn't by itself record permission to receive automated texts.
  Ad leads are acknowledged by **email**; follow‑ups use email unless permission is recorded. Mapping an explicit SMS
  consent question on a client's form is a later change that should go through the legal review (D‑18).

### D‑33 Crediting leads to campaigns — Assumed (Stage 5)
- A lead counts toward a campaign only when the platform delivered the campaign id with the lead (lead forms).
  Website leads with ad click ids or paid UTM tags are reported as "from ads, campaign unknown" rather than guessed
  (Google click ids could later be resolved through the API — not built). Platform conversion counts are shown as the
  platform's own numbers, next to — never merged with — Bluewater's leads and recorded sales.

### D‑34 Google lead forms by webhook — Assumed (Stage 5)
- Google's lead‑form webhook delivers full lead details with a shared key; it needs no Google Ads API approval, so it
  can be used at launch. Each client gets a secret address and key (shown once; only hashes stored).

### D‑35 One Facebook Page feeds one company — Assumed (Stage 5)
- Enforced by a unique database index on active Pages, so a lead can never be routed to two clients. Moving a Page
  between companies is an administrator task (turn it off in one, then on in the other).

### D‑36 Weekly owner summaries — Assumed (Stage 7)
- Bluewater Insight owners get one email per week: last Monday–Sunday in the company's timezone, sent from Monday 8:00 local.
  Same definitions as Overview/Reports (METRICS.md); simulated numbers labeled; unknowns never shown as zero. One per
  owner per week (database key), even if the job runs twice. Owners can turn it off in Settings. Employees don't get it.

### D‑37 Usage limits and billing — Assumed (Stage 7)
- Manual invoicing (D‑16) with invoice *records* in the app; nothing charges anyone. Unit prices for cost estimates are
  entered by the owner (unknown → “—”). Per‑client monthly text limit: *alert only* (default) or *pause automatic
  texts* — automatic texts fall back to email; lead capture, manual replies and emails always continue.
- Failed payment → “past due” + alert after the grace period (default 14 days). Service is **never** suspended
  automatically for payment; that's the owner's call. Invoices can't be deleted (voided instead).

### D‑38 Retention and deletion — Assumed (Stage 7; part of the legal review D‑18)
- Data kept while the company is a client and after churn (read‑only export window). Permanent deletion only for
  **archived** companies, by an administrator with two‑step verification, typing the exact name; enforced again by the
  database function. Kept after deletion: company row, invoices/billing terms, package/status history, support‑access
  records, activity log, the deletion record and the **opt‑out list** (so people who said STOP are never contacted
  again). Backups keep deleted data until they expire (7 days). Details: RETENTION.md.

### D‑39 Follow‑ups that are late after an outage — Assumed (Stage 7)
- A follow‑up step that is more than 24 hours past its time is **paused** with a reason on the lead, not sent; a person
  decides whether to resume. (Acknowledgments older than 24 h already cancel themselves, D‑24.) This prevents sending
  days of accumulated follow‑ups after an outage.

### D‑40 Priorities under load — Assumed (Stage 7)
- Job priority: recording ad leads and acknowledgments (1) → alerts (2) → booking messages (3) → follow‑ups and booking
  alerts (4) → missed‑lead checks (6) → ad imports and weekly summaries (8). Plus at most 5 jobs per company per batch.

### D‑41 Alerts and the health endpoint — Assumed (Stage 7)
- In‑app checks every minute; alerts grouped by key, one email when a problem starts and one when it resolves.
  `/api/health` (public, no client data) for an external uptime monitor that alerts through its own channel. Thresholds
  in MONITORING.md (queue delay 10 min; message failures > 20 % of ≥ 10 in an hour; database 6 GB).

### D‑42 Sales‑demo prospect workspaces — Assumed (Stage 7)
- Created only on the demo site (refused in production), fictional dataset generated per prospect, 1–30 days, extend /
  reset / end access, presentation controls for administrators only; data deleted automatically 7 days after expiry.

### D‑43 Support requests and service notices — Assumed (Stage 7)
- In‑app support requests with references (BW‑1001…), company‑scoped, internal notes hidden by the database; all
  administrators emailed. Service notices go to company owners only after the administrator reviews the exact list and
  confirms the count. The public status page is a separate free service (MONITORING.md).

### D‑44 Package names — Decided by the owner
- Package 1 is **Bluewater Connect** (instant response), Package 2 is **Bluewater Engage** (follow‑up & booking), Package 3
  is **Bluewater Insight** (performance reporting). Still cumulative: Engage includes Connect; Insight includes both.
- Only the names people see changed. Internal codes (`instant_response`, `follow_up_booking`, `performance_reporting`) stay,
  so permissions, history and billing records are unaffected. SPECIFICATION.md keeps its original "Package 1/2/3" wording.

### D‑15 measured (Stage 7)
- Load test and restore drill results are in CAPACITY.md and RECOVERY.md (local measurements; staging run pending).
