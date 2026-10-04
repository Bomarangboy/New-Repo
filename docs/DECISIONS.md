# Decision Register

Every material choice, why it matters, what was chosen, and what is still open.
**Prices are list prices found on the providers' own sites (via search, 2026‑10‑04), not quotes.**
Direct page fetches were blocked by this development environment's network policy, so every price
below must be re‑checked on the linked page before you buy anything. Nothing has been purchased.

Status key: **Decided** (owner approved) · **Assumed** (reasonable default; reversible; tell me if wrong) ·
**Open** (needs your decision) · **Blocked** (waiting on an outside party).

| ID | Decision / dependency | Status | Blocks |
|----|----------------------|--------|--------|
| D‑01 | Launch scope | **Decided** — pilot Packages 1+2 | — |
| D‑02 | Stack & hosting | **Decided** — Next.js + Supabase + Vercel | — |
| D‑03 | Authentication | **Decided** (follows D‑02) — Supabase Auth | Live sign‑in only |
| D‑04 | Database access & isolation | **Assumed** — Drizzle ORM + Postgres RLS | — |
| D‑05 | Market / jurisdiction | **Decided** — United States only | — |
| D‑06 | Sender ownership | **Decided** — Bluewater‑managed, per client | Live sending |
| D‑07 | Background jobs | **Assumed** — Postgres job table + Supabase Cron trigger | Stage 3 |
| D‑08 | Email provider | **Assumed** — Postmark | Live email |
| D‑09 | SMS provider | **Assumed** — Twilio (subaccount per client) | Live SMS |
| D‑10 | Calendar / booking connector | **Open** — Cal.com recommended | Stage 4 |
| D‑11 | First external CRM connector | **Open** — wait for first client | Stage 6 |
| D‑12 | Environments | **Assumed** — dev, staging, demo, production | Deployment |
| D‑13 | Budgets | **Open** | Purchases |
| D‑14 | Support hours & escalation | **Open** | Launch |
| D‑15 | Capacity & recovery targets | **Assumed** (proposed below) | Launch |
| D‑16 | Billing | **Assumed** — manual invoicing first | — |
| D‑17 | Monitoring & independent alerts | **Assumed** — Sentry + external uptime monitor | Launch |
| D‑18 | Legal review | **Open** — attorney review of consent/messaging | Live sending |
| D‑19 | Pipeline unit | **Assumed** — pipeline stage lives on each inquiry | — |
| D‑20 | Messaging eligibility of stored leads | **Assumed** — only live submissions on active accounts | — |
| D‑21 | Duplicate handling | **Assumed** — match on email or phone; never overwrite | — |
| D‑22 | Intake abuse controls | **Assumed** — allowed websites, spam trap, 30/min, optional signing | — |

---

### D‑01 Launch scope — Decided
- **Why it matters:** Sets what can be sold first and which outside approvals are on the critical path.
- **Chosen:** Pilot Packages 1 (Instant Response) and 2 (Follow‑Up & Booking) with 1–3 pilot clients.
  Package 3 follows when Meta App Review/Business Verification and Google Ads API access are approved.
- **Alternatives:** Package 1 only (fastest); all three (waits on Meta/Google approvals, weeks, outside our control).
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

### D‑10 Calendar / booking connector — Open (needed for Stage 4)
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

### D‑13 Budgets — Open
- Please give a monthly ceiling for (a) development/staging/demo and (b) production at pilot scale.
  Rough fixed platform floor at pilot scale, before messaging usage: Vercel Pro ~$20 + Supabase Pro ~$25
  + extra Supabase projects for staging/demo (compute) + Postmark ~$15 + Twilio per‑client fees + monitoring
  (free tiers available). See COSTS.md.

### D‑14 Support hours & escalation — Open
- I have not invented a support team or 24/7 promise. Please decide hours, response targets and who is
  contacted for emergencies (you, a contractor, etc.).

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

### D‑18 Legal review — Open
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
