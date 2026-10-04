import type { Action, WorkspaceRole } from "@/lib/authz/permissions";
import { roleCan } from "@/lib/authz/permissions";
import { hasFeature, type Feature, type PackageTier } from "@/lib/authz/entitlements";

export interface NavItem {
  href: string;
  label: string;
  icon: "home" | "users" | "message" | "zap" | "calendar" | "chart" | "link" | "settings" | "help";
  action: Action;
  feature?: Feature;
}

/**
 * Client workspace navigation. Each page ALSO checks the same action/feature on the
 * server (pageContext), so hiding a link is a convenience, never the protection.
 */
export const WORKSPACE_NAV: NavItem[] = [
  { href: "/app", label: "Overview", icon: "home", action: "workspace.view" },
  { href: "/app/leads", label: "Leads", icon: "users", action: "lead.view", feature: "leads" },
  { href: "/app/conversations", label: "Conversations", icon: "message", action: "conversation.view", feature: "inbox" },
  { href: "/app/automations", label: "Automations", icon: "zap", action: "template.view", feature: "acknowledgment" },
  { href: "/app/appointments", label: "Appointments", icon: "calendar", action: "appointment.view", feature: "appointments" },
  { href: "/app/reports", label: "Reports", icon: "chart", action: "report.view", feature: "outcome_reporting" },
  { href: "/app/connected-accounts", label: "Connected Accounts", icon: "link", action: "integration.view", feature: "lead_sources" },
  { href: "/app/settings", label: "Settings", icon: "settings", action: "settings.view" },
  { href: "/app/help", label: "Help & Support", icon: "help", action: "support.request" },
];

export function visibleNav(role: WorkspaceRole, pkg: PackageTier): NavItem[] {
  return WORKSPACE_NAV.filter((n) => roleCan(role, n.action) && (!n.feature || hasFeature(pkg, n.feature)));
}
