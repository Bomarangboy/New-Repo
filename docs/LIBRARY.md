# Sequence Library

**Status:** Stage 8. Implemented and tested (unit, integration and browser tests). Uses the existing automation
engine — no separate scheduler or sender. Sending stays simulated until live sending is approved. Not deployed yet.

A searchable library of reusable **instant replies** (acknowledgments) and **follow-up sequences** curated by
Bluewater. Clients copy a template into their own workspace, customize it, pass a setup checklist and turn it on.

## Package access (enforced on the server)
| Package | Can copy |
|---|---|
| Bluewater Connect | Instant replies only (sequences are shown as “part of Bluewater Engage”) |
| Bluewater Engage / Insight | Instant replies and multi-step follow-up sequences |
A template can also require a higher package (e.g. Insight); that's checked too.

## For clients: Search → Preview → Copy → Customize → Validate → Activate
1. **Sequence Library** in the menu. Search and filter by type, industry, goal, channel, length, package and required
   connection.
2. **Preview** shows every message and wait, who can start it, every stop rule, sending hours, requirements and
   results evidence (or “Unverified”).
3. **Copy to my workspace** makes a private draft. Nothing is sent, nobody is enrolled, and the original isn't changed.
4. **Customize**: sequences are edited in the normal sequence editor (versioned); instant replies on the copy page.
   Replace every `[[highlighted placeholder]]`.
5. **Setup checklist** (all required items must be done before turning on): placeholders replaced; wording passes
   the usual checks; business name and service confirmed; sender identity (verified by Bluewater for real customers —
   shown as simulated elsewhere); booking page / website form / ad lead forms when required; timezone and sending
   hours confirmed; contact-permission rules confirmed; stop rules and hand-off confirmed.
6. **Turn on** (owner, or Bluewater support with edit access):
   - *Activation* lets the sequence run. **Nobody already in Bluewater is added.**
   - *Automatic enrollment* is a separate box: “Also start it automatically for **new** eligible leads from my live
     forms, from now on.” Only one sequence per business can start automatically.
   - Existing, imported or older leads: open the lead → Start follow-up, confirming they asked to be contacted. The
     usual checks apply (opt-outs, one follow-up at a time, permissions).
   - For an instant reply, activation makes it the business's acknowledgment (new template version; old wording kept
     in Automations → Wording history).
All existing safeguards apply because the copy *is* a normal sequence/template: duplicate prevention, opt-outs,
stopping on reply/booking/closed/manual message, emergency pause, cancellation, late-step pause, delivery checks.

## Updates, retirement and emergency pause
- **New version published** → existing copies are not changed. The copy shows “Update available” with a step-by-step
  comparison: *Bluewater updated this*, *only you changed this*, or *both changed* (conflict). Choices: take
  Bluewater's changes but keep your edits (when the number of steps is the same), replace with the new version, or keep
  yours. Applying saves a new sequence version; people already in the follow-up finish the version they started.
- **Retire** → no new copies; existing copies keep working unchanged.
- **Emergency pause** (harmful or wrong content; administrators only, with a scope preview and a confirmed count):
  no new copies or activations; automatic enrollment into affected sequences turned off; everyone currently in them
  **paused** (not stopped) with a reason on the lead; instant replies put back to the business's previous wording.
  Recorded in each affected business's activity log. Owners resume when it's safe; “Lift the pause” re-allows new copies.

## For administrators (Admin → Sequence Library)
- **Add starter templates** (5 Bluewater-written templates, added as drafts), **Import a template file**, or
  **Create a new template**. Drafts are never visible to clients.
- Edit with the form (metadata, package, connections, steps/messages) or as a file (JSON). Every save is validated;
  saving over someone else's newer draft is refused.
- **Publish** creates a permanent version with a change note. **Recommended** puts it at the top of the list.
- **Adoption**: which companies have copies, on which version, on/off (visible to administrators only).
- **Evidence**: “Compute last 90 days” counts people enrolled in copies at real customers — demo/test companies and
  simulated messages are excluded — and their replies, bookings, opt-outs and delivery. Denominators: *people
  enrolled* for replies/bookings/opt-outs; *messages sent* for delivery. Clients see it only if you publish it **and**
  it has ≥ 50 people across ≥ 3 businesses. It's labeled as observed outcomes, not proof the template caused them.
  No company or person is identifiable. Until then templates show “Unverified”.

## Import format (`bluewater.library/v1`)
Example: `docs/examples/library-sequence-example.json`. JSON only, ≤ 100 KB. Fields:
`format`, `kind` (`sequence` | `acknowledgment`), `name`, `description`, `industry`, `objective`, `category` (optional),
`requiredPackage` (`instant_response` | `follow_up_booking` | `performance_reporting`), `requiredIntegrations`
(`website_form`, `booking`, `meta_lead_forms`, `google_lead_forms`), and either
- sequences: `entry` (`new_website_leads` | `manual_only`), `stopOnManualMessage`, `handoffTask`, `steps[]` (1–8) with
  `delayMinutes` (60 – 43,200), `channel` (`sms` | `email` | `sms_or_email`), `smsBody`, `emailSubject`, `emailBody`; or
- acknowledgments: `acknowledgment` with `smsBody`, `emailSubject`, `emailBody`.

Messages may use `{{first_name}}`, `{{full_name}}`, `{{company_name}}`, `{{service}}`, `{{booking_link}}` (with
`|fallback`), and `[[placeholders]]` the business must replace. Texts must include “Reply STOP to opt out.”
**Refused:** unknown fields, HTML or code, web links (use `{{booking_link}}`), email addresses, phone numbers,
anything that looks like a password/key/token, too-long texts. Nothing in a file is ever executed. Files from other
tools (CRMs, email platforms) are **not** compatible as-is — they must be rewritten in this format. All problems are
listed before anything is saved.

## Demo
Prospect workspaces see the same library and can copy and turn on templates in their isolated demo workspace; sending
is simulated. Prospects are company owners only — they can't publish templates or change platform settings.

## Technical notes
Tables: `library_templates`, `library_template_versions` (permanent), `library_template_drafts` (platform-only),
`library_categories`, `library_evidence` (aggregate, de-identified), `library_copies` (company-owned, RLS). A
sequence copy is a normal `sequences` row linked from `library_copies.sequence_id`. Code: `src/server/library/*`.
