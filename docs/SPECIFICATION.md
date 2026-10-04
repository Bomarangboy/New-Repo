# Bluewater Collective — Authoritative Specification

This is the single source of truth for what the platform must do. It consolidates the owner's master
specification (received 2026‑10‑04), which supersedes the earlier instructions. Decisions that refine it are in
DECISIONS.md; progress against it is in REQUIREMENTS_MATRIX.md. **Conflicts:** if code or an earlier decision
conflicts with this document, record the conflict and its impact in DECISIONS.md before changing behavior.

Guiding rule: generated code or a polished dashboard does not mean the system is ready for paying customers.

## 1. Product and brand
- Name: **Bluewater Collective**. Typography‑based wordmark; deep navy, vivid blue, white; professional and readable.
- Responsive for computer, tablet and phone browsers. No downloadable app at first (installable web app may come later).
- Runs independently of Claude and of the owner's computer. Clients log in through a browser to their company
  workspace. Background automation continues when browsers are closed.
- The owner manages all companies through a separate administrator area.
- Use established services for hosting, authentication, databases, messaging and scheduling; own the
  application, branding and workflows. Keep architecture maintainable; avoid unnecessary infrastructure.

## 2. Business model and packages (cumulative)
All packages: secure company accounts and strict data separation.
- **Package 1 — Instant Response:** capture eligible inquiries; create/update contacts; automatic acknowledgment
  by configured eligible text or email channel; notify the right owner/employee; basic lead management and
  conversation history; two‑way inbox and manual replies where supported; acknowledgment status, replies,
  failures, connected lead sources; built‑in CRM or an implemented supported external CRM; humans handle the
  conversation after acknowledgment.
- **Package 2 — Follow‑Up & Booking:** Package 1 plus scheduled multi‑day text/email follow‑up; configurable
  stop, pause, timing and handoff rules; booking integration and links; confirmations and reminders; upcoming
  appointments and active sequence visibility; pipeline, assignments and follow‑up tasks.
- **Package 3 — Performance Reporting:** Package 2 plus Meta and Google ad performance imports; spend,
  impressions, clicks and available metrics; lead‑source and campaign reporting; booking and sales outcome
  reporting; cost per attributable lead and conversion rates; attributed revenue only where reliable data
  exists; scheduled owner summaries; reporting freshness and attribution limitations.
- Feature entitlement matrix enforced on the backend. Ad lead capture and ad performance reporting are separate
  capabilities. Never promise unlimited usage, universal CRM compatibility, guaranteed delivery, universal
  attribution or real‑time data everywhere.

## 3. Build approach and decision register
- Inspect the workspace first. Maintain: this specification, architecture proposal, staged plan, persistent
  project instructions (CLAUDE.md), decision register, requirements & verification matrix.
- Decision register records: decision/dependency, why it matters, recommendation & alternatives, setup and
  operating costs with assumptions, whether it blocks development or only live activation, who must complete
  it, status and open questions. Must cover: initial scope/launch package, stack and hosting, auth and
  database, background processing, email and SMS providers, first calendar and CRM connectors, budgets,
  account and sender ownership, support responsibilities, capacity and recovery targets.
- Verify current official documentation; never invent features, pricing or approvals.
- Ask only material questions; record reasonable reversible assumptions; continue independent work.
- Owner decides material architecture commitments. **Explicit approval required** before purchasing services,
  incurring charges, sending live communications, publishing publicly, or destructive production changes.
- Never ask for credentials in chat; explain secure configuration. Build in stages; no untested code dumps.

## 4. Accounts, roles and company isolation
- Secure login, logout, password recovery, invitations. Roles: platform administrator, company owner, company employee.
- Company workspaces, settings, timezones, users. Administrator MFA. Session revocation and employee
  offboarding. Secure company ownership transfer.
- Role‑by‑action permission table covering records, messages, templates, sequences, integrations, exports,
  reporting, billing and support.
- Server‑side company authorization for every operation; a browser‑supplied company ID is never proof of access.
- Verify isolation across database records, conversations/messages, background jobs, files/downloads,
  search/caches, exports/shared reports, integrations/credentials, support tickets, notifications.
- Secrets never in frontend code, logs or commits; protect integration tokens.
- Record sensitive actions and controlled support access; avoid unrestricted impersonation.
- Administrator account recovery without an unauthenticated bypass.

## 5. Lead capture and records
- Sources: documented website‑form integration, manual entry, validated CSV import, verified supported ad lead forms.
- Store: name, phone, email, inquiry; service requested; source and external IDs; campaign/tracking data where
  available; submission and processing times; contact‑permission evidence; assignment, notes, tasks, status;
  conversation and activity history.
- Deduplicate contacts while keeping repeated inquiries as distinct events. Idempotent processing for retries,
  replayed webhooks and reconnects (no duplicate records or sends).
- Historical imports, CSV imports, backfills and CRM sync never trigger new‑lead messaging automatically; an
  explicit authorized enrollment with eligibility checks is required.
- Validate input; actionable import error reports. Search, filters, pagination, safe exports.
- Never claim every inquiry is attributable to an ad. Phone‑call attribution needs a separate tracking method.

## 6. Built‑in and external CRM modes
- Onboarding choice: Bluewater built‑in CRM or a supported external CRM.
- Built‑in: contacts and inquiries, notes, assignments, tasks, conversations, appointments, recorded sales
  value, pipeline **New → Contacted → Booked → Won / Lost**.
- External: CRM is the main customer record; field, stage and identity mappings; send supported leads and
  activity; receive supported status, booking and sales updates; prevent sync loops and duplicates; conflict
  and deletion handling; show what syncs, direction, frequency and limits; behavior during disconnection or
  partial failure.
- Reusable connector interface; individual connectors built for actual first clients. Don't advertise
  unsupported systems; explain effect and approved fallback when a capability is missing. Without a selected
  external CRM, complete built‑in mode and connector architecture without pretending integration is live.

## 7. Messaging and automation
- Company‑specific sender identities; personalized templates with validated fields; automatic acknowledgment;
  owner/employee notifications; two‑way inbox and human replies; multi‑day sequences (Package 2+); business
  hours, timezone and sending windows; manual pause/resume/cancel; suppression and opt‑out; delivery and reply history.
- Pause/stop after: reply, booking, opt‑out, lead closed, manual intervention, company suspension or service end.
- Define human ownership after a reply; coordinate with external CRM automations to avoid overlap.
- Durable background jobs; recheck eligibility immediately before sending. Prevent duplicates from retries,
  double‑clicks, replays and restarts; reconcile uncertain provider acceptance before retrying.
- Track queued, submitted, delivered, failed, unknown. Provider acceptance ≠ delivery.
- Verify webhooks; handle duplicate/out‑of‑order events; bounces, complaints, inbound opt‑outs; separate
  company suppression and sender reputation where feasible.
- Permission categories by purpose and channel; flag legal decisions for qualified review; no automatic‑compliance claims.
- Live sending disabled during development and demo.

## 8. Senders and communication workflows
- Decide client‑supplied vs Bluewater‑provisioned sending accounts; document ownership of accounts, numbers
  and domains, who pays usage, registration/verification, transfer at cancellation, portability limits.
- Workflows (each with who can perform it, where they click, sender identity, recipient selection and
  verification, preview and confirmation, attachments, delivery status and failure handling): Bluewater
  inviting an owner; owner inviting employees; manual message to a lead; automated acknowledgments and
  follow‑ups; booking links and reminders; prospect demo invitations; authorized report sharing; Bluewater
  service notices; customer support requests.
- Separate Bluewater's communications from client‑business messages. Manual bulk actions show company,
  recipients and content before approval; marketing broadcasts out of initial scope. Permissions and
  suppression apply to manual sends too. Report links authenticated or scoped, expiring and revocable
  (download links are credentials). Attachments: size/type limits, private storage, access control,
  malicious‑file handling.

## 9. Booking and appointments
- Selected verified calendar/scheduling connector: booking links and availability; create/cancel/reschedule;
  timezones and DST; booking‑to‑lead association; sequence cancellation after booking; reminders without
  duplicating another tool's; conflicts and stale availability. Never present simulated availability as
  live. Define which system is authoritative; record sync failures.

## 10. Advertising and other integrations
- Meta (Facebook, Instagram) and Google Ads. Connected Accounts page per company; documented authorization
  (no passwords); account selection; scopes; secure token storage and renewal; revocation/disconnect; last
  successful sync; errors and reconnect instructions; pagination and rate limits; historical and incremental
  import; missed‑event reconciliation where supported.
- Support matrix separating ad reporting, native lead forms, website capture, CRM records, messages/replies,
  bookings, sales outcomes. A connected account doesn't imply every function. Document developer accounts,
  verification, reviews, permissions, eligibility. Blocked integrations shown as blocked; simulations only
  for demos and never as evidence of completion.

## 11. Dashboards and reporting
- Client navigation by package: Overview, Leads, Conversations, Automations, Appointments, Reports, Connected
  Accounts, Settings, Help/Support.
- Package 1 overview: new inquiries, acknowledgments sent, failed acknowledgments, unread replies, recent leads,
  connected lead sources, team notification status. Package 2 adds pipeline, active follow‑ups, upcoming
  appointments, booking link and reminders, sequence pause/stop activity. Package 3 adds ad spend and
  performance, results by source and campaign, conversion rates, recorded sales, attributed and unattributed
  revenue, scheduled summaries.
- Define calculations, currencies, timezones, periods, attribution windows. Separate: auto‑acknowledgment time
  vs employee response time; platform conversions vs CRM outcomes; recorded sales vs attributed revenue;
  acquisition cohorts vs period events. Show missing and stale data honestly — never unknown as zero; never
  mix currencies without an explicit conversion. Reconcile totals; explain discrepancies.
- Mockups are design references only; charts use real data.

## 12. Administration and customer lifecycle
- All Customers directory with filters: Onboarding, Active, Paused, Churned, Archived. Track billing status,
  scheduled cancellation, technical suspension and lifecycle separately.
- Show company and owner, package, start date, status, cancellation request and end dates, churn reason and
  notes, package history, reactivation history, integration and health status.
- Cancellation marks Churned at service end (no automatic deletion). At service end: stop pending automation
  safely, apply access/export policy, stop sync, end recurring charges, preserve billing records.
- Account‑status behavior matrix (login, data access, intake, sending, sync, billing, retention).
  Verified reactivation without resuming stale queued messages. Active/new/churned/reactivated reporting,
  excluding demos and tests. Archival, suspension, cancellation and deletion are different actions. Retention
  by data type (company history, leads, conversations, files, tokens, billing, audit, suppression, backups).
  Restricted deletion with confirmation and explanation of what is deleted, retained, or expires from backups.

## 13. Administrator configuration
- Routine changes in the app (stored in the database): companies and users, packages and usage settings,
  timezones and notification recipients, templates and sequence settings, integrations, demo access, support
  routing, reporting schedules, approved retention settings. Validate, preview and version changes; define
  effect on active enrollments; record sensitive changes; undo where feasible. Identify tasks needing a
  developer, provider support or deployment.

## 14. Onboarding and service setup
- Guided checklist per company: details and users, package, CRM mode, lead sources, sender identities,
  provider verification, permissions and suppression, templates and timing, booking (if included),
  notifications, controlled end‑to‑end test, activation. Statuses: Ready, Pending, Needs attention, Not applicable.
- Concrete current setup instructions per external service (prerequisites, ownership/billing, permissions,
  configuration, secure credential entry, verification, common errors, support route, disconnection/migration).
  Sending stays disabled until prerequisites are verified.

## 15. Health, monitoring and safe recovery
- Admin Health & Recovery Center: site/API availability, database health/connections/storage, workers, queue
  depth and oldest job, intake and sync delays, message failures, backups, capacity and cost thresholds,
  incidents — plain language with incident/request IDs.
- External monitoring with an independent alert route; grouped alerts and recovery notices.
- Safe controls: reconnect, retry failed import, reconcile a date range, inspect failed jobs, cancel pending
  work, pause/resume automation, correct contact data, export redacted diagnostics. Explain effects first;
  recheck permissions/status/replies/bookings/timing/prior delivery; expire stale actions; never send
  accumulated days of follow‑ups after an outage.

## 16. Incident playbooks and support
- Tested playbooks for: site outage; login/invitation failure; missing/incorrect records; suspected data
  exposure; stopped lead capture; expired integration access; failed/duplicate messages; missing replies;
  follow‑ups after stop conditions; booking/timezone errors; reporting discrepancies; stopped workers;
  database/storage exhaustion; credit exhaustion/provider suspension; broken deployment; accidental deletion;
  exposed credentials; domain/DNS/certificate; API changes; provider outages. Each: symptoms, detection,
  impact, containment, owner steps, developer steps, safe diagnostics, escalation, customer communication,
  verification, prevention.
- Customer support tickets (references, ownership, status, updates, company‑scoped). Incident notice drafts
  with recipient approval; status communication outside the app. Support hours and escalation approved by owner.

## 17. Backups and disaster recovery
- Back up database, files, configuration; recover secrets securely. Propose RPO/RTO with costs; distinguish
  targets from measured results. Test restores in isolation and record evidence. Recovery restores service,
  verifies isolation, reconnects dependencies, reconciles newer external records, avoids re‑sending, verifies
  workflows before automation resumes. Company‑specific recovery where feasible. Protect copies from the same
  failure. Document limits, expiry, and deleted‑data behavior.

## 18. Capacity and scaling
- Define expected companies, users, daily leads, peak requests, messages, reports, retention; load‑test launch
  targets and record results. Bounded concurrency, queues, indexes, pagination, rate limits, fair processing.
  Warnings before limits; document upgrades. Prioritize intake and essential messages under load. Never
  acknowledge external lead events before durable storage; define per‑provider retry behavior; never silently
  discard leads.

## 19. Costs and billing
- Entitlements tracked separately from usage (segments, email, storage, processing, integrations, AI).
  Estimates, alerts, configurable limits (estimates ≠ enforcement); define what pauses at a limit without
  losing leads. Upgrades, downgrades (safe handling of jobs/sequences), grace periods, payment failure,
  cancellation, refunds, reactivation. Manual billing acceptable initially; automated billing needs verified
  events, idempotency, reconciliation, test mode. Owner approves pricing and contracts.

## 20. Environments, deployment and maintenance
- Isolated development, staging, sales demo, production. Repository under the owner's control; env examples
  without secrets; migrations; hosting and background processing; domain and HTTPS; build and verification
  procedures; monitoring and backups; deployment and recovery docs. Release review, deploy, verify, rollback
  (code rollback ≠ data rollback; identify irreversible migrations). Maintenance schedule (errors, backups,
  updates, vulnerabilities, API changes, renewals, costs, capacity). Scoped developer access and handoff.

## 21. Sales demo
- Same core interface; realistic fictional, internally consistent data; all packages and both CRM modes with
  simulated external connections clearly labeled. Isolated, expiring, revocable prospect workspaces. Admin
  controls: reset, simulate lead, simulate reply, simulate booking, advance sequence, switch package.
  Restrictions enforced on backend and workers: no production data, credentials, live sending, live account
  connections or payments. Separate address and data/config; cleanup of expired workspaces; guided tour and
  presentation script; label unfinished features honestly. Label: **"Demo — Sample Data."**

## 22. Ownership and documentation
- Account inventory (purpose, ownership, billing, renewal, recovery, support; no secrets); runtime
  dependencies and portability limits; AI features (if any) with provider, cost, failure behavior, review.
- Plain‑English owner manual: onboarding, invitations and users, messages/reports/booking links/demos,
  configuration, delivery verification, failure recovery, emergency pause, outages, restoration, capacity,
  billing and lifecycle, getting technical help, moving to another developer.
- Technical docs: architecture, schema, connectors, settings, tests, deployment, recovery, known issues.
  Recovery instructions accessible outside the application.

## 23. Verification and launch
- Traceability (requirements → implementation, tests, docs, blockers) with statuses: Implemented and verified;
  Implemented but awaiting live verification; Simulated for demo; Blocked; Deferred.
- Acceptance criteria per workflow; screens/mocks are not operational proof. Verify isolation, roles and
  packages, onboarding, intake, duplicates/retries, delivery and replies, stop conditions and opt‑outs, CRM
  sync and reconnects, booking, reporting, downgrades and churn, backup restore, deployment recovery,
  independent alerts, capacity, support procedures — with controlled failure simulations.
- Separate technical readiness from provider approvals and business/legal decisions. Recommend a limited
  pilot based on measured capacity; state blockers and which packages can actually be sold.

## 24. Implementation order
1. Architecture, setup, authentication, isolation, permissions.
2. Company management, lifecycle, built‑in CRM, website intake.
3. Messaging, inbox, alerts, durable jobs, stop rules.
4. Follow‑up and booking.
5. Advertising connectors and reporting.
6. Selected external CRM connector.
7. Billing enhancements, operational tools, documentation, deployment readiness.

Demo foundation grows alongside. Each stage reports: what works, how tested, what is simulated or blocked,
owner setup steps, costs/decisions needing approval, what's next.
