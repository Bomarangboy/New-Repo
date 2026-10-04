# Booking & appointments (Stage 4, Package 2+)

Code: `src/server/booking/*`, `src/app/api/webhooks/calcom/[key]`. Tests: `tests/integration/booking.test.ts`,
`tests/unit/booking-rules.test.ts`, `tests/e2e/stage4.spec.ts`. Decisions: D‑10, D‑27, D‑29, D‑30.

**Status:** built and tested against simulated and signed test messages. **Awaiting live verification** with a
real Cal.com account. Nothing in Bluewater shows availability; customers pick times on Cal.com's own page, so
there is no simulated availability to mistake for a real one.

## How a booking flows

1. The client's booking page (e.g. `https://cal.com/harbor/estimate`) is saved on **Connected Accounts**.
2. Messages can include `{{booking_link}}`. Each lead gets a **personal** link ending in `metadata[bw]=<reference>`;
   email links also pre‑fill name and email (texts don't, to stay short and keep personal details out of SMS).
3. Cal.com sends a webhook to the client's private Bluewater address when a booking is created, rescheduled or
   cancelled. Bluewater checks the signature with the client's secret before reading anything.
4. The booking attaches to a lead (D‑30): link reference → same email/phone → new lead "Cal.com booking".
   Lookups run under that client's row‑level security, so a reference can never reach another company's lead.
5. Effects, in one database transaction: appointment saved; lead moves New/Contacted → **Booked**; any follow‑up
   for that person **stops**; confirmation and reminders are scheduled; the team gets an email alert.

| Event | What Bluewater does |
|---|---|
| Created | Records the appointment (see above). |
| Rescheduled | Keeps the same appointment, updates the time, remembers the old Cal.com id, cancels reminders for the old time, schedules new ones, alerts the team. |
| Cancelled | Marks it cancelled, cancels reminders, moves the lead back to Contacted if nothing else is booked, alerts the team. Follow‑ups do **not** restart. |
| Ping test | Marks the connection **Connected**. |
| Anything else | Recorded and ignored. |

**Reliability rules.** Identical re‑deliveries are ignored (hash of the body). Messages older than the newest one
already applied are ignored (out‑of‑order delivery). A cancellation that arrives *before* its booking is
remembered, so the late booking isn't recorded. Late messages about a booking id that was replaced by a
reschedule are ignored. All of this is covered by tests (each safeguard was deliberately broken once to prove
its test fails).

## Confirmations & reminders (D‑27)

- Defaults: confirmation right away; reminders 24 hours and 2 hours before. Owners change this under
  **Automations → Appointment confirmations & reminders** and can edit the wording (`{{appointment_time}}` is
  formatted in the business's timezone, e.g. "Tue, Oct 6 at 2:00 PM EDT").
- Texts need recorded text permission and no opt‑out. Cal.com bookings are emailed by Cal.com itself, so
  Bluewater emails them only if "also email" is ticked. Appointments the team enters get an email if a text isn't allowed.
- Each message is re‑checked just before sending: still scheduled, same time, in the future, account active,
  package includes booking, emergency stop off, sending hours (skipped if the window opens less than 30 minutes
  before the appointment).

## Appointments the team enters

On a lead page: **Add an appointment booked another way** (date and time are in the business's timezone).
Same effects as a booking, without the team alert. These can be cancelled in Bluewater; Cal.com bookings must
be cancelled in Cal.com (D‑29). Anyone can mark an appointment **Completed** or **No‑show** once it has started.

## Simulator (development, test and demo only)

"Simulate a booking" on a lead, and "Simulate cancellation" on Appointments, run exactly the same code as a
real Cal.com webhook with source "simulated". Simulated appointments are labeled everywhere. The server refuses
simulation for real customers once live sending is on.

## Connecting a client's Cal.com (for the owner or Bluewater in a support session)

1. The client signs in to their own Cal.com account (they own it; Bluewater never needs their password).
2. Copy the event's public link into **Connected Accounts → Scheduling — Cal.com → Booking page address**.
3. Press **Set up automatic booking updates**. Copy the address and secret shown (once) into Cal.com →
   **Settings → Developer → Webhooks → New**: Subscriber URL, Secret, triggers *Booking created / rescheduled /
   cancelled*, no custom payload template. Press **Ping test**; Bluewater should show **Connected**.
4. Book a test appointment through a lead's personal link; it should appear on that lead within seconds.
5. If the secret is lost or exposed: press the button again (the old address stops working) and update Cal.com.

Common problems: "wrong signature" → the secret in Cal.com doesn't match (create a new one); nothing arrives →
check the webhook is active in Cal.com and the address is complete; bookings attach to a new lead instead of the
existing one → the person booked from the general page (no reference) with a different email.
