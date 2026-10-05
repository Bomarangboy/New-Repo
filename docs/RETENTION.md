# Data Retention and Deletion

**Status:** Stage 7. Policy written by the developer as a **reasonable default**; it is not legal advice and is
part of the owner's legal review (D‑18). Changing a period is a decision to record in `DECISIONS.md` (D‑38).

## Principles
- Archiving, suspending, cancelling and deleting are **different actions** (Account status on each company).
  Nothing is deleted automatically for real customers; deletion is a deliberate administrator action.
- Data belongs to the client company. Each company's data is separated by the database (row‑level security).
- Unknown values are never shown as zero, and deleted data is never “estimated back”.

## Retention by type of data
| Data | While the client is active | After cancellation (Churned) | After deletion |
|---|---|---|---|
| Company record (name, package, status history) | Kept | Kept | **Kept** (needed for billing and history) |
| Leads, contacts, notes, tasks, lead history | Kept | Kept, read‑only for the export window | **Deleted** |
| Conversations and messages (text and email) | Kept | Kept, read‑only | **Deleted** |
| Consent evidence (permission to text) | Kept | Kept | **Deleted** (no one is contacted any more) |
| Opt‑out list (people who said STOP / unsubscribed) | Kept | Kept | **Kept** — so they are never contacted again if the company were ever reactivated |
| Appointments, follow‑up sequences, templates, settings | Kept | Kept | **Deleted** |
| Ad connections and access tokens | Kept (encrypted) | Sync stops; tokens kept until disconnect | **Deleted** |
| Ad numbers and ad lead records | Kept | Kept | **Deleted** |
| Website‑form submissions (raw) | Kept | Kept | **Deleted** |
| Background jobs and notifications | Kept | Kept | **Deleted** |
| Support requests (tickets) | Kept | Kept | **Deleted** |
| Sequence Library copies and the company's own Studio look | Kept | Kept | **Deleted** (library originals are Bluewater's and stay) |
| Team access (memberships, invitations) | Kept | Read‑only during export window | **Deleted**; sign‑in accounts that belong to no other company are **disabled** |
| Invoices and billing terms | Kept | Kept | **Kept** (business and tax records) |
| Activity log (who changed what) | Kept, can't be edited | Kept | **Kept** (security record; details never contain secrets) |
| Support‑access records (Bluewater staff access) | Kept | Kept | **Kept** |
| Deletion record (what was removed, by whom, why) | — | — | **Created and kept** |
| Backups (Supabase daily) | Rolling | Rolling | Data remains **in backups until they expire** (7 days on Supabase Pro; longer for any manual backup you keep) |
| Files | The app stores no uploaded files today. | | |

Development mailbox entries (system emails captured in development/test/demo) are not customer data and are
removed with the database of that environment.

## How deletion works (administrators only)
1. The client asks in writing (or the agreed export window has ended) — note the date.
2. Make sure any export the client wanted has been given to them (CSV export from the client's Leads page).
3. Set the company to **Archived** (Admin → Companies → company → Account status). Archived companies can't sign
   in, receive leads, send or sync.
4. On the same page, **Delete this company's data**: the page shows how many leads, contacts, messages and
   appointments will be removed, what is kept, and the backup caveat. Type the reason and the company's exact
   name, then confirm. You must have signed in with two‑step verification.
5. The result is recorded (Admin → Activity; and the deletion record on the company page).

Safeguards (tested in `tests/integration/operations.test.ts`):
- The database function `app.purge_company_data` itself refuses unless the company is archived (or a demo
  prospect) and the caller is in the administrator/system area — the button is not the only protection.
- A client workspace can't run it, even by calling the database directly.
- A test fails if a new table holding company data is added without deciding whether deletion removes or keeps it.

## Demo prospect workspaces
Fictional data only. Access ends at the expiry date (or immediately when revoked). The workspace's data, its
opt‑out list and its access are deleted automatically **7 days** after expiry by the scheduled maintenance, and
a deletion record is kept. See `DEMO.md`.

## Not automated (yet)
- Automatic deletion of churned customers after N days — deliberately **not** automatic; you decide each case.
- Age‑based trimming of old background jobs and delivery events (planned if the database grows; the Health page
  shows the size and alerts at 6 GB).
