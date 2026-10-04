# Permissions, Packages and Account Status

_Generated from `src/lib/authz/*` by `scripts/gen-permissions-doc.ts`. Do not edit by hand._

Every rule below is enforced on the server (and company isolation also by the database).
Hiding a menu item is only a convenience.

## 1. Role × action (inside a company workspace)

Roles: **Owner** (client account holder, one per company) · **Employee** · **Support (view)** / **Support (edit)** =
a Bluewater administrator under a time‑limited, reason‑required support grant that the client can see in its activity log.

| Action | Owner | Employee | Support (view) | Support (edit) |
|---|:-:|:-:|:-:|:-:|
| `workspace.view` | ✅ | ✅ | ✅ | ✅ |
| `lead.view` | ✅ | ✅ | ✅ | ✅ |
| `lead.create` | ✅ | ✅ | — | — |
| `lead.edit` | ✅ | ✅ | — | ✅ |
| `lead.assign` | ✅ | ✅ | — | — |
| `lead.delete` | ✅ | — | — | — |
| `lead.import` | ✅ | — | — | — |
| `lead.export` | ✅ | — | — | — |
| `conversation.view` | ✅ | ✅ | ✅ | ✅ |
| `message.send_manual` | ✅ | ✅ | — | — |
| `template.view` | ✅ | ✅ | ✅ | ✅ |
| `template.manage` | ✅ | — | — | ✅ |
| `sequence.view` | ✅ | ✅ | ✅ | ✅ |
| `sequence.manage` | ✅ | — | — | ✅ |
| `sequence.pause_contact` | ✅ | ✅ | — | ✅ |
| `contact.opt_out` | ✅ | ✅ | — | ✅ |
| `automation.emergency_pause` | ✅ | — | — | ✅ |
| `appointment.view` | ✅ | ✅ | ✅ | ✅ |
| `appointment.manage` | ✅ | ✅ | — | — |
| `integration.view` | ✅ | — | ✅ | ✅ |
| `integration.manage` | ✅ | — | — | ✅ |
| `report.view` | ✅ | ✅ | ✅ | ✅ |
| `report.share` | ✅ | — | — | — |
| `settings.view` | ✅ | ✅ | ✅ | ✅ |
| `settings.manage` | ✅ | — | — | ✅ |
| `team.view` | ✅ | ✅ | ✅ | ✅ |
| `team.invite` | ✅ | — | — | — |
| `team.remove` | ✅ | — | — | — |
| `ownership.transfer` | ✅ | — | — | — |
| `billing.view` | ✅ | — | ✅ | ✅ |
| `audit.view` | ✅ | — | ✅ | ✅ |
| `support.request` | ✅ | ✅ | — | — |
| `data.export_all` | ✅ | — | — | — |

Platform administrators have **no** access to client workspaces except through a support grant.
Administrator actions (company creation, packages, status, owner invitations, support grants) live in the separate
`/admin` area and require two‑step verification.

## 2. Package entitlements (cumulative)

| Feature | Package 1 | Package 2 | Package 3 |
|---|:-:|:-:|:-:|
| `leads` | ✅ | ✅ | ✅ |
| `lead_sources` | ✅ | ✅ | ✅ |
| `ad_lead_forms` | ✅ | ✅ | ✅ |
| `acknowledgment` | ✅ | ✅ | ✅ |
| `notifications` | ✅ | ✅ | ✅ |
| `inbox` | ✅ | ✅ | ✅ |
| `crm_builtin` | ✅ | ✅ | ✅ |
| `crm_external` | ✅ | ✅ | ✅ |
| `pipeline_board` | — | ✅ | ✅ |
| `tasks` | — | ✅ | ✅ |
| `sequences` | — | ✅ | ✅ |
| `booking` | — | ✅ | ✅ |
| `appointments` | — | ✅ | ✅ |
| `ad_reporting` | — | — | ✅ |
| `campaign_reporting` | — | — | ✅ |
| `outcome_reporting` | — | — | ✅ |
| `scheduled_summaries` | — | — | ✅ |

Receiving leads from advertising lead forms (`ad_lead_forms`) is separate from advertising *performance reporting* (`ad_reporting`).

## 3. Account‑status behavior

Lifecycle, technical suspension and billing are tracked separately. Billing status has no automatic effect during the manual‑billing pilot.

| Situation | Client sign‑in | New leads | Automatic messages | Manual messages | Integration sync | Real providers (else simulated) |
|---|---|---|:-:|:-:|:-:|:-:|
| onboarding | full | stored, no automation | — | — | ✅ | ✅ |
| active | full | processed | ✅ | ✅ | ✅ | ✅ |
| paused | full | stored, no automation | — | ✅ | ✅ | ✅ |
| churned | read‑only | refused with an error (never silently dropped) | — | — | — | ✅ |
| archived | none | refused with an error (never silently dropped) | — | — | — | ✅ |
| active + suspended | read‑only | stored, no automation | — | — | — | ✅ |
| demo workspace (active) | full | processed | ✅ | ✅ | ✅ | — |
| demo workspace (expired) | none | refused with an error (never silently dropped) | — | — | — | — |

Read‑only accounts can still view and export their data (export window after churn).
Reactivating a churned company returns it to onboarding and never resumes previously queued messages.
