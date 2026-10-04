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
5. Connect the website form: the owner (or you in a support session with edit access) opens **Connected
   Accounts → Connect a website form**, then sends the setup instructions to their web designer. Ask them to
   submit a test inquiry; the form shows "Receiving leads" once one arrives.
6. Optional: import past leads (**Leads → Import**, CSV from Excel/Google Sheets). Imported leads never get
   automatic messages.
7. **Senders** (you, on the company's admin page): enter the client's Twilio subaccount and/or Postmark
   stream. Tokens are stored encrypted and never shown again. Set status to *Verified* only once the number's
   A2P registration is approved and the email domain is verified. Copy the Postmark webhook address shown
   once into Postmark. Until live sending is approved, everything stays simulated.
8. The owner reviews **Automations**: acknowledgment wording, sending hours and who gets alerts.
9. _(coming)_ Booking; the controlled test.
10. Change status to **Active** when the test passes. Leads that arrived before activation are kept but will
   never be messaged automatically.

## Leads (what clients see)
- **Leads** lists every inquiry; search by name, email, phone or service; filter by stage, source or person.
- Each lead has its stage (New → Contacted → Booked → Won/Lost), who it's assigned to, notes, tasks (Package 2),
  the sale amount once won, permission evidence, and a full history of changes.
- If the same person asks again, it's a new inquiry linked to the same contact ("repeat inquiry").
- Owners can **export** all leads to a spreadsheet (recorded in the activity log).
- How every number on the Overview is calculated is explained on the **Help** page (and `docs/METRICS.md`).

## Messages and the inbox (Stage 3)
- **Automatic acknowledgment:** when a website lead arrives on an Active account, Bluewater thanks them within
  about a minute — by text if they gave text permission, otherwise by email. It is skipped (and the team is
  told why) if there's no permission, they opted out, someone already contacted them, or it's outside the
  sending hours for more than a day.
- **Conversations** shows every thread. A red count means people replied and are waiting. When someone
  replies, automatic messages to that person stop and the assigned person (or the owners) gets an email.
- Replying: type in the box on the conversation and press Send. Texts only go to people who gave permission
  and haven't opted out.
- **Opt‑outs:** "STOP" (or "stop texting me", "unsubscribe"…) blocks texts to that number immediately;
  "START" re‑allows. Email unsubscribe links work the same way. If someone asks by phone, use **Record
  opt‑out** on the conversation.
- **Emergency stop:** Automations → *Stop all automatic messages* (owners). Anything waiting is cancelled,
  not delayed. Manual replies still work. Turn it back on from the same page.
- Every message says **Simulated** until real sending is switched on — they were not actually delivered.

## Health page (administrators)
`/admin/health` shows whether sending is simulated or live, when the scheduler last ran (it should run every
minute once deployed; older than 5 minutes is flagged), jobs that failed (retry or cancel them) and messages with an **unknown** result.
An unknown message *may* have reached the person: check the provider's log (Twilio/Postmark) and then mark it
delivered or failed. Bluewater never re-sends these automatically, to avoid double-texting someone.

## Cancellations
On the company's admin page, **Record a cancellation request** with the end date and reason. The client keeps
full service until that date; from then on the account is read-only (they can still export), new website
submissions are refused with a clear error, and nothing is deleted.

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

_(coming)_ Delivery verification · outages · restoring backups · capacity · billing.
