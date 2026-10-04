# Customer Support

**Status:** Stage 7. Support hours (owner decision, D‑03 answers): **7:00 am – 1:00 am Eastern, every day**, handled by
the owner. Escalation: the developer, for anything in the playbooks marked “developer steps”.

## How clients reach you
- In the app: **Help & Support → New support request** — subject, type (Question · Something isn't working · Billing ·
  **Urgent — leads or messages affected**), details. Every request gets a reference like **BW‑1042**.
- Every administrator gets an email for each new request and each client reply (subject starts with **URGENT** for
  urgent ones). Clients get an email for each reply from Bluewater.
- For “messages are going out that shouldn't”, the Help page points owners to **Automations → Emergency pause** first.

## Working requests (Admin → Support)
- Active list shows urgent open requests first, then most recent activity.
- On a request: **Reply to client** (emailed; choose the status after replying) or **Internal note / status change**.
- Internal notes are hidden from clients **by the database itself**, not just the screen (tested: the client can't
  read or write them even by bypassing the app).
- Statuses: *Needs Bluewater* (open) → *Waiting on client* → *Resolved* → *Closed*. A client reply re‑opens it.
- Requests belong to one company; other companies can never see them (tested).

## Suggested response targets (owner to confirm)
| Type | First response within support hours |
|---|---|
| Urgent — leads or messages affected | 30 minutes |
| Something isn't working | 4 hours |
| Question / Billing | 1 business day |

## Service notices and status page
For incidents affecting several clients: update the external status page, then **Admin → Service notices**: draft,
choose all current customers or specific companies, review the exact list of owners, and send (the count must match
what you reviewed). See `MONITORING.md` and the playbooks.

## What not to do
Never ask a client for passwords or card numbers (the form says so). Use time‑limited **support access** (company page)
to look inside a client workspace; it's logged and visible to the client.
