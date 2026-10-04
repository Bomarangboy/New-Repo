# Owner Manual (plain English)

This manual grows with every stage. Sections marked _(coming)_ describe features not built yet.

## Your two areas
- **Administrator area** (`/admin`) — for you (Bluewater). Create client companies, choose their package,
  invite their owner, change status, open a support session, read the activity log.
- **Client workspace** (`/app`) — what your clients see: overview, leads, conversations, settings.

As an administrator you **cannot** see inside a client's workspace casually. To help a client, open a
**support session** from the company's page: you must give a reason, it lasts at most 60 minutes, it's
view‑only unless you choose otherwise, and the client sees it in their own activity log.

## Onboarding a new client
1. `/admin` → **New company** → name, timezone, package. The company starts as **Onboarding**: leads would be
   stored, but nothing is sent automatically.
2. On the company page, **Invite the owner** with their email. They receive a link (valid 7 days, works once).
3. The owner creates their password, then invites their own employees under **Settings → Team**.
4. The owner chooses **built‑in CRM** under Settings. (External CRMs show as "Not available yet".)
5. _(coming)_ Connect lead sources, senders, templates, booking; run the controlled test.
6. Change status to **Active** when the test passes.

## Users and security
- Owners can invite and remove employees. Removing someone ends their access immediately.
- **Ownership transfer:** the owner does it under Settings → Team (must type the company name and have signed in
  within 15 minutes). You can't do it for them, by design.
- Anyone can turn on **two‑step verification** under the account menu → *Password & security*.
  Administrators must.
- **Sign out everywhere** (same page) if a phone is lost or a password may be known by someone else.

## Account statuses (what each one does)
See the table in `docs/PERMISSIONS.md`. In short: **Onboarding** (setup, no automation), **Active** (everything
on), **Paused** (automation off, manual messages allowed), **Churned** (read‑only for exports, new leads
refused), **Archived** (no access). **Suspend** is a separate emergency switch: read‑only, nothing sent, but
new leads are still stored. Reactivating a churned client returns them to Onboarding — old queued messages
are never resumed.

## If you lose your administrator two‑step device
There is deliberately no "skip" link. Recovery: sign in to the **Supabase dashboard** (protected by its own
2FA) → Authentication → Users → your user → remove the MFA factor; then sign in and enroll again. Record it
in your own notes. If you also lost Supabase access, use Supabase's account recovery. Keep a second
administrator account for a trusted person to avoid this.

## Getting technical help / changing developers
Give the new developer access to the GitHub repository and (as members, not owners) to Supabase and Vercel.
Point them to `README.md`, `CLAUDE.md` and `docs/`. Remove their access when the work ends.

_(coming)_ Delivery verification · emergency pause · outages · restoring backups · capacity · billing.
