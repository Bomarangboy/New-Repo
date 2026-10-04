# Usage, Costs and Billing

**Status:** Stage 7. Manual billing (D‑16, D‑37). **The app never charges anyone** — no payment provider is connected.
Prices you charge clients are your decision; nothing here sets them for you.

## What is tracked
- **Entitlements** (what a package allows) are separate from **usage** (what was used). Package changes are in the
  package history; usage is counted from the actual records.
- Per company per month: leads, text **segments** (real and simulated shown separately), emails, ad imports.
  Admin → **Usage & Billing** (any of the last 6 months).
- **Estimated provider cost** = real usage × the unit prices you enter (per text segment incl. carrier fees, per email,
  per texting number per month). Until you enter prices, estimates show **“—”**, never $0. Simulated messages cost
  nothing. Estimates are not bills.
- **Customers by month**: new, activated, churned, reactivated and active at month end — demo and test workspaces excluded.

## Per‑client billing terms (company page → Billing & usage limits)
- Monthly price, billing email, notes.
- **Monthly text limit** (segments) and what happens at the limit:
  - *Alert Bluewater only* (default): you get an alert at 80 % and 100 %.
  - *Pause automatic texts*: automatic texts (acknowledgments, follow‑ups, reminders) switch to **email** when
    possible; nothing else stops. **Lead capture, manual replies and emails always continue** — no lead is lost at a
    limit (tested: at the limit the acknowledgment went by email).
- Monthly email limit: alert only.
- **Grace period** after a failed payment (default 14 days).

## Invoices (records of what you sent)
Record each invoice you send (period, amount, due date) → reference `INV‑YYYYMM‑NNN`. Mark it **paid**, **failed** or
**void**. A failed payment marks the client’s billing “past due”; when unpaid past the due date + grace days, an
alert opens. **Service is never paused automatically for payment** — suspending is your decision (Account status →
Suspend). Invoices can't be deleted (database rule); mistakes are voided. Owners see their price, usage and invoices
read‑only under Settings → Billing; employees can't see billing.

## Upgrades, downgrades, cancellation, refunds, reactivation
- **Upgrade**: takes effect immediately; nothing is back‑dated.
- **Downgrade** below Package 2: running follow‑ups stop for good (not resumed on a later upgrade); appointments and
  history are kept. Below Package 3: reports and weekly summaries stop; ad lead forms keep working.
- **Cancellation**: scheduled end date → read‑only after it (export window), new leads refused. Record the final invoice.
- **Refunds**: outside the app (your payment method); void or annotate the invoice.
- **Reactivation**: returns to Onboarding; old queued messages are never resumed.

## Automated billing later (not built)
If you later use Stripe or similar: verified webhooks, idempotent event handling, monthly reconciliation against these
records, and test mode first — and your approval before any live charge.
