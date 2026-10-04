# Sales Demo Environment

**Status:** foundation (Stage 1) + sample dataset v1 (Stage 2) + simulated conversations (Stage 3) + follow‑ups and simulated appointments (Stage 4) + simulated ad accounts and reports (Stage 5) + **prospect workspaces, presentation controls, cleanup and presentation script (Stage 7)**. Nothing in the demo is evidence that a live
integration works.

## What exists now (and is tested)
- `APP_ENV=demo` mode: the server **refuses** to start with live sending enabled, and refuses the local
  development login (unit tests in `tests/unit/security.test.ts`).
- System emails in demo mode are captured, never sent.
- Company kinds `demo_template` (the master sample company) and `demo_prospect` (a prospect's private copy).
  Demo companies can never use real providers (`liveDeliveryAllowed=false`) and are locked automatically when
  `demo_expires_at` passes (tested).
- Every page shows the banner **"Demo — Sample Data. Messages, ad accounts, CRM and bookings are simulated."**

## Sample dataset v1 (Stage 2)
`src/server/demo/dataset.ts` generates ~130 fictional inquiries over 90 days (website form, sample
Facebook/Instagram and Google lead-form sources clearly labeled "(sample)", manual entries), realistic
stage progression, sale values, notes, tasks, consent evidence and genuine repeat customers. It uses reserved
example data (example.com addresses, 555-01xx numbers), goes through the same code as real leads, and is
deterministic (same seed → same data). A test proves the dashboard totals equal the records. Sample leads are
never eligible for automatic messages. Today it powers the development seed; the demo deployment uses it once
prospect workspaces exist.

## Simulated messaging (Stage 3)
- Sample companies include simulated acknowledgments, replies, manual answers, one STOP and a few replies
  awaiting an answer, so the inbox and dashboard have something to show. Every one is labeled "Simulated".
- On any conversation, **Simulate a reply from this person** (available only where sending is simulated — never
  for a real customer once live sending is on; the server checks this too) lets you show what happens when a lead answers, says STOP, etc. It goes through the same
  code as a real incoming text.
- The server forces the simulated transport for demo, test and development, and for demo company kinds
  everywhere (tested); it is not a setting someone can flip in the interface.

## Follow‑ups and bookings (Stage 4)
- Bluewater Engage or Insight sample companies have a "New lead follow‑up" sequence (on, automatic) and follow‑ups in every state:
  running, paused, finished, and stopped because the person replied, booked or the lead closed.
- Booked and some won leads have **simulated** appointments (badge "Simulated"); upcoming ones have reminders
  queued, which go through the simulated transport.
- **Simulate a booking** on any lead (and **Simulate cancellation** on Appointments) shows the whole booking flow —
  lead moves to Booked, follow‑up stops, confirmation text, team alert — using the same code as a real Cal.com
  webhook. Cal.com itself shows "Not connected"; the demo never claims a live connection.

## Advertising (Stage 5)
- Every sample company has a simulated Facebook Page receiving lead‑form leads; **Send a simulated lead** shows a lead
  arriving (labeled "(simulated)") and being acknowledged.
- The Bluewater Insight sample company (Bayside Dental) has simulated Meta and Google Ads accounts with 90 days of sample
  numbers and sample leads linked to sample campaigns, so Reports is fully populated — with a "Sample numbers" banner.
- The server forces simulated ad platforms in the demo; `ADS_LIVE_ENABLED` is refused there.

## Prospect workspaces (Stage 7)
Admin → **Sales demo** (on the demo site):
- **New prospect workspace**: business name, package, timezone, 1–30 days. It is created as a `demo_prospect`
  company filled with a fresh fictional dataset (about 130 leads over 90 days, conversations, follow‑ups,
  appointments, simulated ad accounts). Optionally invite the prospect: they become **owner of that copy only**.
- **Presentation controls** (administrators only; each is recorded in the activity log):
  *Simulate a new lead* (arrives through the normal lead path; the automatic reply runs, simulated) ·
  *Simulate a reply* (latest conversation answers) · *Simulate a booking* (newest open lead books; its follow‑up
  stops) · *Run next follow‑up now* · *Switch package* (shows what each package unlocks).
- **Reset sample data** (sign‑ins are kept), **Extend** (max 30 days from today), **End access now**.
- Expired or revoked workspaces can't be signed into; their data is **deleted automatically 7 days later**
  (scheduled maintenance; a deletion record is kept).

Restrictions are enforced by the server, not the screen: prospect workspaces **can't be created in production**;
demo companies can never use real messaging providers or live ad connections (`liveDeliveryAllowed=false`,
`ADS_LIVE_ENABLED` refused in demo); the controls refuse any company that isn't a demo prospect (tested).

## Presentation script (about 15 minutes)
Before: wake the demo database (free projects pause when idle — open the demo site 5 minutes early), create the
prospect's workspace with their business name and the package you're proposing, and sign in as the prospect's
owner in a second browser window (or share your screen from the admin window plus the workspace).

1. **The problem (1 min).** “How many inquiries go unanswered for more than an hour?” Open **Overview**:
   leads this month, response, booked, recorded sales. Point at the yellow **Demo — Sample Data** banner.
2. **Instant response (3 min).** Admin → *Simulate a new lead*. In the workspace, refresh **Leads**: the new lead,
   its source, and within seconds the automatic text (labeled *Simulated*). Open the lead: history, consent
   evidence, the acknowledgment.
3. **Two‑way conversation (2 min).** *Simulate a reply*. **Conversations** shows it waiting; answer it from the
   inbox. Mention STOP handling and quiet hours.
4. **Follow‑up & booking — Bluewater Engage (4 min).** On the lead, show the running follow‑up. *Run next follow‑up now*,
   refresh: the step was sent. *Simulate a booking*: the lead moves to Booked, follow‑up stops, confirmation and
   reminder are scheduled. Open **Appointments**.
5. **Reporting — Bluewater Insight (3 min).** *Switch package* to Bluewater Insight. **Reports**: ad spend (sample numbers),
   leads by campaign, cost per lead; explain “campaign unknown” honestly. Mention the Monday summary email.
6. **Close (2 min).** Settings → team, Help & Support requests, emergency pause. Agree next steps; *Extend* if
   they want to explore on their own.

Say clearly: Cal.com, Twilio, Postmark, Meta and Google are **simulated in the demo**; live connections are set
up per client after approval. Features not yet built (external CRM sync) are labeled as such in the app.

## Design (unchanged)

- Hosted separately at `demo.yourdomain.com` with its **own Supabase project and Vercel project** — no
  connection strings or keys from production exist there.
- **Template dataset:** fictional "Harbor Home Services" with leads, conversations, appointments, campaigns,
  spend and sales generated so dashboard totals equal the underlying records (a test will check this).
- **Prospect access:** you create an invitation for a prospect from the admin area with an expiry date;
  the prospect gets their own freshly generated sample workspace (`demo_prospect`; built as a new dataset rather
  than a copy of a template), can edit freely, and can be revoked any time. Prospects are always company owners of their copy — never administrators.
- **Presentation controls (admin only, separate panel):** reset workspace, simulate new lead, simulate reply,
  simulate booking, advance a follow‑up sequence, switch the demonstrated package.
- **Simulated connectors:** messaging, Meta, Google, CRM and booking connectors have simulated
  implementations selected **in server code** whenever `APP_ENV=demo` or the company is a demo kind.
  Simulated messages appear in the demo inbox only.
- **Cleanup:** built — maintenance deletes expired prospect workspaces 7 days after expiry.
- **Guided tour and presentation script:** the script above. An in‑app click‑through tour is not built (the script covers it).
