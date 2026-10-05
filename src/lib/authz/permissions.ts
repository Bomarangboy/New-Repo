/**
 * Role-by-action permission table. This is the single source of truth used by
 * the server; docs/PERMISSIONS.md is generated from the same lists by a test, so
 * the documentation cannot drift from the code.
 *
 * Roles inside a company workspace:
 *  - owner     – the client business's account holder (one active owner per company)
 *  - employee  – staff member handling leads and conversations
 *  - support   – a Bluewater platform administrator working under a time-limited,
 *                reason-required support grant (read-only unless the grant allows edits)
 */
export const ACTIONS = [
  "workspace.view",
  "lead.view",
  "lead.create",
  "lead.edit",
  "lead.assign",
  "lead.delete",
  "lead.import",
  "lead.export",
  "conversation.view",
  "message.send_manual",
  "template.view",
  "template.manage",
  "sequence.view",
  "sequence.manage",
  "sequence.enroll_contact",
  "sequence.pause_contact",
  "library.view",
  "library.adopt",
  "contact.opt_out",
  "automation.emergency_pause",
  "appointment.view",
  "appointment.manage",
  "integration.view",
  "integration.manage",
  "report.view",
  "report.share",
  "settings.view",
  "settings.manage",
  "team.view",
  "team.invite",
  "team.remove",
  "ownership.transfer",
  "billing.view",
  "audit.view",
  "support.request",
  "data.export_all",
] as const;

export type Action = (typeof ACTIONS)[number];
export type WorkspaceRole = "owner" | "employee" | "support_read" | "support_edit";

const EMPLOYEE: Action[] = [
  "workspace.view",
  "lead.view",
  "lead.create",
  "lead.edit",
  "lead.assign",
  "conversation.view",
  "message.send_manual",
  "template.view",
  "sequence.view",
  "sequence.enroll_contact",
  "sequence.pause_contact",
  "library.view",
  "contact.opt_out",
  "appointment.view",
  "appointment.manage",
  "report.view",
  "settings.view",
  "team.view",
  "support.request",
];

const SUPPORT_READ: Action[] = ACTIONS.filter((a) => a.endsWith(".view"));

const SUPPORT_EDIT: Action[] = [
  ...SUPPORT_READ,
  "lead.edit",
  "template.manage",
  "sequence.manage",
  "sequence.pause_contact",
  "library.adopt",
  "contact.opt_out",
  "automation.emergency_pause",
  "settings.manage",
  "integration.manage",
];

export const ROLE_PERMISSIONS: Record<WorkspaceRole, ReadonlySet<Action>> = {
  owner: new Set(ACTIONS),
  employee: new Set(EMPLOYEE),
  // Support access never includes exports, invitations, ownership transfer, messaging
  // or deletion — those stay with the client business.
  support_read: new Set(SUPPORT_READ),
  support_edit: new Set(SUPPORT_EDIT),
};

export function roleCan(role: WorkspaceRole, action: Action): boolean {
  return ROLE_PERMISSIONS[role].has(action);
}

/** Platform administrator abilities (only in the separate /admin area, MFA required). */
export const PLATFORM_ADMIN_ACTIONS = [
  "company.create",
  "company.update",
  "company.change_package",
  "company.change_lifecycle",
  "company.invite_owner",
  "company.support_access",
  "audit.view_all",
  "demo.manage",
  "studio.edit",
  "studio.publish",
  "library.manage",
  "library.emergency_pause",
] as const;
