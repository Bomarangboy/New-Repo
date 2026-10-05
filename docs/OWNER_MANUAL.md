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
9. Bluewater Engage: the owner turns on a **follow‑up sequence** (Automations; a suggested one is provided — review the
   wording first) and connects **Cal.com** (Connected Accounts → Scheduling; steps in `docs/BOOKING.md`).
   Then the controlled test: a test lead through the form, a test booking through its personal link.
10. Change status to **Active** when the test passes. Leads that arrived before activation are kept but will
   never be messaged automatically.

## Leads (what clients see)
- **Leads** lists every inquiry; search by name, email, phone or service; filter by stage, source or person.
- Each lead has its stage (New → Contacted → Booked → Won/Lost), who it's assigned to, notes, tasks (Bluewater Engage),
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

## Health & Recovery (administrators)
`/admin/health` lists **open alerts** first (you also get one email when a problem starts and one when it's over),
database size and connections, website submissions that failed (**Retry**), ad lead problems (**Retry**),
**Re‑import ad data** for a date range (replaces, never double counts), follow‑ups that were **paused because they were
more than a day late** (resume them from the lead if still appropriate), and your records of backup/restore/load tests.
On a company page: **Stop automatic messages** for that client (provider incident), and **Download diagnostics** (a
redacted file for a developer — no names, numbers or message text). It also shows whether sending is simulated or live, when the scheduler last ran (it should run every
minute once deployed; older than 5 minutes is flagged), jobs that failed (retry or cancel them) and messages with an **unknown** result.
An unknown message *may* have reached the person: check the provider's log (Twilio/Postmark) and then mark it
delivered or failed. Bluewater never re-sends these automatically, to avoid double-texting someone.

## Follow‑ups and appointments (Bluewater Engage, Stage 4)
- **Follow‑up sequence:** after the first acknowledgment, Bluewater keeps in touch over the following days
  (default: day 1, day 3, day 7) until the person replies, books, opts out or the lead is closed — then it stops
  for good. Each message is checked again just before it goes out. If someone asked by phone to stop, use
  **Record opt‑out** on their conversation, or **Stop** on the lead's follow‑up card.
- On a lead page, **Automatic follow‑up** shows where they are (step 2 of 3, next message Tuesday 10:00) with
  **Pause / Resume / Stop**, and lets a team member start a follow‑up by hand.
- Editing a sequence saves a new version; people already in it finish the version they started.
- When the last step goes out without a reply, a **call‑back task** is created for the assigned person.
- **Appointments:** online bookings through Cal.com appear automatically, move the lead to Booked, stop
  follow‑ups and get a text confirmation and reminders (24 h and 2 h before, adjustable). Change or cancel Cal.com
  bookings in Cal.com — Bluewater follows. Bookings made by phone: **Add an appointment** on the lead page.
  After the visit, mark **Completed** or **No‑show** on the Appointments page.
- If a booking shows up on a *new* lead instead of the existing one, the person booked from the general page with a
  different email. It's still recorded; you can note the link in the lead's notes.

## Facebook, Instagram and Google ads (Stage 5)
- **Lead forms (every package):** on Connected Accounts, connect Meta and turn on **Receive leads** for the client's
  Facebook Page; for Google, press **Set up Google lead‑form webhook** and paste the address and key into the lead form
  (then **Send test data**). New ad leads appear under Leads like any other, labeled with the form's name, and get the
  automatic acknowledgment by email (lead forms don't give permission to text).
- **Reports (Bluewater Insight):** choose which ad accounts to include. Reports shows spend, clicks, the platform's own lead
  counts, the leads Bluewater received from each campaign, what they cost, and what they turned into (booked, won, sales).
  A lead is only credited to a campaign when the platform sent the campaign with it — Bluewater never guesses.
- **If a connection says "Needs reconnecting"** (Meta access lasts about 60 days), press **Reconnect** and sign in again.
- Until Meta and Google approve Bluewater's apps, real accounts can't be connected; demo and test environments show
  **simulated** accounts, clearly labeled.

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

## Support requests, notices and summaries (Stage 7)
- **Admin → Support**: client requests with BW‑ references. Reply (emailed to the client) or add an internal note
  (never visible to the client). Details in `SUPPORT.md`.
- **Admin → Service notices**: email owners about an outage or maintenance. You review the exact recipients before
  sending. Update your external status page too.
- **Weekly summary** (Bluewater Insight): owners get last week's numbers every Monday morning (their timezone). They can turn it
  off in Settings.

## Usage & billing (Stage 7)
**Admin → Usage & Billing** shows each client's texts, emails and leads per month, an estimated provider cost (enter
your Twilio/Postmark unit prices first — until then it shows “—”), and customers gained/lost by month. On each company:
price, text limit, grace days and your invoice records. The app never charges anyone. Details in `BILLING.md`.

## Sales demo (Stage 7)
On the demo site, **Admin → Sales demo** creates a private, expiring workspace for a prospect with fictional data, and
gives you presentation buttons (new lead, reply, booking, next follow‑up, switch package). Script in `DEMO.md`.

## Deleting a client's data (Stage 7)
Only after the client is **Archived**: company page → **Delete this company's data** (type the reason and the exact
company name). What is deleted and kept is shown first and listed in `RETENTION.md`. Backups keep it up to 7 more days.

## Platform Studio — changing the look and wording (Stage 8)
Full guide: `STUDIO.md`. Short version:

**Change wording, colors, menu or Overview layout**
1. Admin → **Platform Studio**.
2. Choose what to edit: **Platform default** (everyone), a **Package default** (e.g. only Bluewater Engage clients) or
   **Customize one company** (pick it and press Open).
3. Pick a tab: **Brand**, **Wording**, **Packages** (platform only), **Menu**, **Overview layout**.
4. Change the fields and press **Save … draft**. Use the arrow buttons to move menu items or cards up/down.
   **Reset to inherited** makes a field follow the level above again.
5. Open **Preview & publish**: check the preview (switch Desktop/Phone, owner/employee, package; “sign-in page” link),
   the list of changes and “reaches N workspaces”. Companies that set their own value are listed — they keep it.
6. Type a short summary and press **Publish**. It's live on everyone's next page load.

**Upload a logo or favicon**: Brand tab → *Upload an image* → choose the file → **Upload and use in draft** → preview →
publish. Use PNG (transparent background for the dark-background logo), up to 512 KB; favicon: square PNG.
SVG files are refused for security — export the logo as PNG.

**Undo a change**: **History** tab → **Copy into draft** on the version you want → Preview & publish → Publish.

**Troubleshooting**
- “Someone else saved changes to this draft…” — another administrator saved first. Reload and redo your change.
- “…too hard to read…” — pick a darker color (white text must stay readable).
- “…plain text only” — remove `<`/`>` tags or code; links aren't allowed in Studio text.
- A client says a menu item disappeared — it may be hidden in their company or package scope (Menu tab), or their
  package/role doesn't include it. Hiding never blocks access; the page still works by its address if allowed.
- The admin area looks broken after a publish — set `STUDIO_SAFE_MODE=true` in Vercel and redeploy (see `STUDIO.md`).

## Sequence Library (Stage 8)
Full guide: `LIBRARY.md`.

**Publish templates (you)**
1. Admin → **Sequence Library** → **Add starter templates** (first time), or **Import a template file**, or
   **Create a new template**.
2. Open a template, edit the draft (form, or “Advanced: edit as a file”), press **Check and save draft**.
3. Read the preview, add a change note, **Publish**. Clients can now find it. **Mark as recommended** to put it first.
4. To change a published template: **Start a draft from version N**, edit, publish. Clients with copies see
   “Update available” and decide; nothing changes for them automatically.
5. **Retire** stops new copies (existing ones keep working). **Emergency pause** is for harmful or wrong content: read
   the list of affected businesses, give a reason, confirm. It pauses (doesn't stop) affected follow-ups.

**Use a template (clients)**
1. Menu → **Sequence Library** → search/filter → open a template → read every message and the rules.
2. **Copy to my workspace** (owner). Nothing is sent and nobody is added.
3. Customize: for a sequence press **Edit in the sequence editor** and replace every `[[highlighted]]` part; for an
   instant reply edit the wording on the copy page.
4. Tick the confirmations in **Check the setup** and press **Save confirmations**. Required items must show a check.
5. **Turn on**. Tick “Also start it automatically for new eligible leads” only if new leads should start it by
   themselves. To add an existing lead: open the lead → Start follow-up.

**Troubleshooting**
- “Finish the setup checklist first: …” — the list says exactly what's missing (often a `[[placeholder]]`, a
  confirmation, a booking page, or a sender Bluewater still has to verify).
- “… already starts automatically for new leads” — only one sequence can start automatically; turn the other one's
  automatic start off first (Automations).
- “Follow-up sequences are part of Bluewater Engage.” — the client's package doesn't include sequences.
- Import refused — the message lists each problem (unknown field, phone number, link, missing “Reply STOP to opt out”…).
  Nothing was saved; fix the file and import again.
- A client's follow-ups are paused “by Bluewater” — an emergency pause was used. After review, lift the pause; the
  client resumes each follow-up from the lead page.

## When something goes wrong
Use the playbooks in `docs/playbooks/README.md` (keep a copy outside the app). Backups and restoring: `RECOVERY.md`.
Capacity measurements: `CAPACITY.md`. Launch readiness: `LAUNCH_CHECKLIST.md`. Appearance editor: `STUDIO.md`. Template library: `LIBRARY.md`.
