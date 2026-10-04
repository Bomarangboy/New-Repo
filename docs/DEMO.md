# Sales Demo Environment

**Status:** foundation (Stage 1) + sample dataset v1 (Stage 2) + simulated conversations (Stage 3) + follow‑ups and simulated appointments (Stage 4) + simulated ad accounts and reports (Stage 5). The full demo — sample dataset, prospect access, presentation
controls, guided tour — is built alongside Stages 2–5. Nothing in the demo is evidence that a live
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
- Package 2+ sample companies have a "New lead follow‑up" sequence (on, automatic) and follow‑ups in every state:
  running, paused, finished, and stopped because the person replied, booked or the lead closed.
- Booked and some won leads have **simulated** appointments (badge "Simulated"); upcoming ones have reminders
  queued, which go through the simulated transport.
- **Simulate a booking** on any lead (and **Simulate cancellation** on Appointments) shows the whole booking flow —
  lead moves to Booked, follow‑up stops, confirmation text, team alert — using the same code as a real Cal.com
  webhook. Cal.com itself shows "Not connected"; the demo never claims a live connection.

## Advertising (Stage 5)
- Every sample company has a simulated Facebook Page receiving lead‑form leads; **Send a simulated lead** shows a lead
  arriving (labeled "(simulated)") and being acknowledged.
- The Package 3 sample company (Bayside Dental) has simulated Meta and Google Ads accounts with 90 days of sample
  numbers and sample leads linked to sample campaigns, so Reports is fully populated — with a "Sample numbers" banner.
- The server forces simulated ad platforms in the demo; `ADS_LIVE_ENABLED` is refused there.

## Planned design
- Hosted separately at `demo.yourdomain.com` with its **own Supabase project and Vercel project** — no
  connection strings or keys from production exist there.
- **Template dataset:** fictional "Harbor Home Services" with leads, conversations, appointments, campaigns,
  spend and sales generated so dashboard totals equal the underlying records (a test will check this).
- **Prospect access:** you create an invitation for a prospect from the admin area with an expiry date;
  the prospect gets a private copy of the template (`demo_prospect`), can edit freely, and can be revoked
  any time. Prospects are always company owners of their copy — never administrators.
- **Presentation controls (admin only, separate panel):** reset workspace, simulate new lead, simulate reply,
  simulate booking, advance a follow‑up sequence, switch the demonstrated package.
- **Simulated connectors:** messaging, Meta, Google, CRM and booking connectors have simulated
  implementations selected **in server code** whenever `APP_ENV=demo` or the company is a demo kind.
  Simulated messages appear in the demo inbox only.
- **Cleanup:** a scheduled job deletes expired prospect workspaces after a grace period.
- **Guided tour and presentation script:** added once the features they show exist.
