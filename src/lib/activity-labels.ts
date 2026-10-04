/** Plain-language descriptions for activity-log entries shown to clients and administrators. */
export function describeActivity(action: string, details: Record<string, unknown> = {}): string {
  const d = details as Record<string, string | undefined>;
  switch (action) {
    case "company.created": return `Workspace created (${d.package?.replaceAll("_", " ") ?? ""})`;
    case "company.settings_updated": return "Company details updated";
    case "company.crm_mode_selected": return `CRM choice: ${d.mode === "built_in" ? "built-in CRM" : "external CRM"}`;
    case "company.package_changed": return `Package changed from ${d.from?.replaceAll("_", " ")} to ${d.to?.replaceAll("_", " ")}`;
    case "company.lifecycle_changed": return `Account status changed from ${d.from} to ${d.to}`;
    case "company.reactivated": return "Account reactivated";
    case "company.suspended": return "Account temporarily suspended";
    case "company.unsuspended": return "Suspension lifted";
    case "company.ownership_transferred": return "Ownership transferred";
    case "team.invited": return `Invitation sent to ${d.email}`;
    case "team.owner_invited": return `Owner invitation sent to ${d.email}`;
    case "team.invitation_revoked": return "Invitation cancelled";
    case "team.invitation_accepted": return `${d.email} joined as ${d.role}`;
    case "team.member_removed": return "Team member removed";
    case "support.access_started": return `Bluewater support access started (${d.readOnly ? "view only" : "can edit"}): ${d.reason ?? ""}`;
    case "support.access_ended": return "Bluewater support access ended";
    case "account.password_changed": return "Password changed";
    case "account.mfa_enabled": return "Two-step verification turned on";
    case "account.sessions_revoked": return "Signed out of all devices";
    default: return action.replaceAll("_", " ").replaceAll(".", " · ");
  }
}
