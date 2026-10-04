# Messaging rules (Stages 3–4)

How Bluewater sends and receives texts and emails for client businesses. Code: `src/server/messaging/*`,
`src/server/jobs/*`. Tests: `tests/unit/messaging-rules.test.ts`, `tests/integration/{messaging,webhooks}.test.ts`,
`tests/e2e/stage3.spec.ts`; follow‑ups: `src/server/sequences/*`, `tests/integration/sequences.test.ts`,
`tests/e2e/stage4.spec.ts`. Booking confirmations/reminders: see BOOKING.md.

## Real vs simulated (D‑23)

A message is handed to a real provider **only if all four are true**:
1. the environment is `production`;
2. `LIVE_SENDING_ENABLED=true` (refused by the app in development, test, staging and demo);
3. the company is a real customer (not demo/test/internal);
4. the company's sender is marked **verified** by an administrator.

Otherwise the **simulated transport** is used: the message is stored, labeled "Simulated" everywhere it
appears, and marked delivered (addresses beginning with `fail` are rejected, to demonstrate failures).
In production a real customer whose sender isn't verified gets **no** fake send: the message is cancelled
and the team is told why.

## Automatic acknowledgment (D‑24)

When an eligible lead arrives (live website form on an active account), a job is written in the **same
database transaction** as the lead. Just before sending, the job re‑checks:

| Check | If it fails |
|---|---|
| Account active for automatic messages; emergency stop off; acknowledgment turned on | cancelled |
| Inquiry still exists, is "eligible", still at stage **New** | cancelled |
| Less than 24 hours since the inquiry | cancelled |
| Person hasn't replied and nobody has already messaged them | cancelled |
| Channel: text if a phone number, text permission recorded and not opted out; otherwise email if not unsubscribed | cancelled, team notified ("no acknowledgment was sent: …") |
| Inside the company's sending window (company timezone, DST‑correct) | waits for the window, if it opens within 24 h of the inquiry |

Each inquiry can produce **at most one** acknowledgment (unique key in the database, proven with a
concurrent‑worker test). Templates are versioned; each message records which version it used.

## Follow‑up sequences (Bluewater Engage or Insight, D‑26, D‑28)

A sequence is up to 8 steps, each with a wait (from the start, then from the previous step; at least 1 hour),
a channel (*text if permitted, otherwise email* · *text only* · *email only*) and wording checked by the same
rules as other templates (fields, STOP wording, length). One sequence can start automatically for every new
eligible website lead; a team member can also start one from a lead page (leads that didn't arrive live through
a form need them to confirm the person asked to be contacted).

- Each step is a background job. **Immediately before sending**, every rule is checked again: account active,
  package includes follow‑ups, emergency stop off, sequence on, lead not Booked/Won/Lost, no appointment, no reply
  since the follow‑up started, no team message (if that rule is on), no opt‑out, permission for the channel,
  sending hours (waits for the window).
- **Stops for good** (D‑28) on: reply · booking · opt‑out (STOP, unsubscribe link, recorded by staff, spam
  complaint) · Booked/Won/Lost · team message (configurable) · sequence turned off · emergency stop · package
  without follow‑ups · account paused/suspended/ended. The stop is recorded the moment it happens *and* re‑checked
  before every step, so a missed signal still can't cause a send.
- A step that can't be sent on its channel (e.g. no text permission) is **skipped** and recorded — never sent
  another way. After the last step, if no one replied, a call‑back task is created for the assigned person (optional).
- At most one message per step (unique key `seq:<enrollment>:<step>`); the move to the next step happens in the
  same transaction that creates the message, and a crashed send is finished on retry. Proven by tests, including
  three workers running the same step at once.
- Pause holds the next step; resume continues with it (at its original time, or a minute later if that passed).
- Editing creates a new version; people already enrolled finish the version they started (D‑26).

## Message states (D‑25)

`queued → sending → submitted → delivered`, or `failed`, or **`unknown`**.
- `sending` is committed before the provider is called. If the worker dies mid‑call, maintenance marks it
  **unknown** — it may or may not have reached the person. Unknown messages are **never retried
  automatically** (that could double‑text someone); an administrator resolves them on the Health page.
- Provider status updates can arrive late or out of order; a message never moves backwards
  (e.g. a late "sent" can't overwrite "delivered"). Every update is kept in `message_status_events`.

## Incoming messages and opt‑outs

- Every incoming message is stored once (provider message id is unique).
- **STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPT OUT** — or a short message with a clear phrase
  like "stop texting me" / "remove me" — suppresses that number/address for this company immediately.
  **START / UNSTOP / YES** lifts a keyword opt‑out. HELP/INFO is treated as a reply that needs a person.
- Any other reply marks the conversation **Needs reply**, stops automation for that person and notifies the
  assigned person (or the owners). A human takes over.
- Emails carry a signed one‑click unsubscribe link (`/u/<token>`, confirmation button so link scanners
  can't unsubscribe people by accident). Bounces/spam complaints from Postmark also suppress the address.
- Team members can record an opt‑out by hand (e.g. said on the phone) and lift one with a stated reason.

## Notifications to the business

New lead, new reply and "acknowledgment problem" emails go to the people chosen on the Automations page
(if nobody is chosen: the lead's assigned person, otherwise every owner). Each event notifies once (unique key).

## Jobs (D‑07)

Postgres `jobs` table; workers claim with `FOR UPDATE SKIP LOCKED`, at most 5 per company per batch
(one busy client can't starve others), retries with growing delays, then "dead" (visible on Health).
Housekeeping each minute: re‑queue jobs whose worker vanished, mark interrupted sends unknown, apply due
cancellations. Triggered by: Supabase Cron every minute → `POST /api/jobs/run` (bearer secret), right after
each website lead, and `npm run jobs:work` locally.

## Provider webhooks — awaiting live verification

| Provider | URL | Protection |
|---|---|---|
| Twilio incoming texts | `/api/webhooks/twilio/inbound` | `X-Twilio-Signature` checked with Twilio's official library and the client's subaccount token |
| Twilio delivery status | `/api/webhooks/twilio/status` | same |
| Postmark (inbound, delivery, bounce, spam) | `/api/webhooks/postmark/<secret key>` | secret path per company (only its hash is stored), shown once when the sender is saved |

References: [Twilio webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security),
[Twilio status callbacks](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status),
[Twilio Advanced Opt‑Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out),
[Postmark webhooks](https://postmarkapp.com/developer/webhooks/webhooks-overview).
