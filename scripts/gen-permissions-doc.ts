/**
 * Writes docs/PERMISSIONS.md from the permission, entitlement and account-status code,
 * so the documentation always matches what the server enforces.
 *   npx tsx scripts/gen-permissions-doc.ts
 * A test fails if the committed file is out of date.
 */
import { writeFileSync } from "node:fs";
import { ACTIONS, ROLE_PERMISSIONS, type WorkspaceRole } from "../src/lib/authz/permissions";
import { FEATURES, PACKAGES, PACKAGE_NAMES, hasFeature, type Feature } from "../src/lib/authz/entitlements";
import { accountPolicy, type LifecycleStatus } from "../src/lib/authz/account-policy";

export function renderPermissionsDoc(): string {
  const roles: WorkspaceRole[] = ["owner", "employee", "support_read", "support_edit"];
  const y = (b: boolean) => (b ? "✅" : "—");
  const lines: string[] = [];
  lines.push("# Permissions, Packages and Account Status", "");
  lines.push("_Generated from `src/lib/authz/*` by `scripts/gen-permissions-doc.ts`. Do not edit by hand._", "");
  lines.push("Every rule below is enforced on the server (and company isolation also by the database).",
    "Hiding a menu item is only a convenience.", "");
  lines.push("## 1. Role × action (inside a company workspace)", "");
  lines.push("Roles: **Owner** (client account holder, one per company) · **Employee** · **Support (view)** / **Support (edit)** =",
    "a Bluewater administrator under a time‑limited, reason‑required support grant that the client can see in its activity log.", "");
  lines.push("| Action | Owner | Employee | Support (view) | Support (edit) |", "|---|:-:|:-:|:-:|:-:|");
  for (const a of ACTIONS) lines.push(`| \`${a}\` | ${roles.map((r) => y(ROLE_PERMISSIONS[r].has(a))).join(" | ")} |`);
  lines.push("", "Platform administrators have **no** access to client workspaces except through a support grant.",
    "Administrator actions (company creation, packages, status, owner invitations, support grants) live in the separate",
    "`/admin` area and require two‑step verification.", "");
  lines.push("## 2. Package entitlements (cumulative)", "");
  lines.push(`| Feature | ${PACKAGES.map((p) => PACKAGE_NAMES[p]).join(" | ")} |`, `|---|${PACKAGES.map(() => ":-:").join("|")}|`);
  for (const f of Object.keys(FEATURES) as Feature[]) lines.push(`| \`${f}\` | ${PACKAGES.map((p) => y(hasFeature(p, f))).join(" | ")} |`);
  lines.push("", "Receiving leads from advertising lead forms (`ad_lead_forms`) is separate from advertising *performance reporting* (`ad_reporting`).", "");
  lines.push("## 3. Account‑status behavior", "");
  lines.push("Lifecycle, technical suspension and billing are tracked separately. Billing status has no automatic effect during the manual‑billing pilot.", "");
  lines.push("| Situation | Client sign‑in | New leads | Automatic messages | Manual messages | Integration sync | Real providers (else simulated) |", "|---|---|---|:-:|:-:|:-:|:-:|");
  const rows: [string, Parameters<typeof accountPolicy>[0]][] = [
    ...(["onboarding", "active", "paused", "churned", "archived"] as LifecycleStatus[]).map((s) => [s, { lifecycleStatus: s, suspended: false, kind: "customer" as const }] as [string, Parameters<typeof accountPolicy>[0]]),
    ["active + suspended", { lifecycleStatus: "active", suspended: true, kind: "customer" }],
    ["demo workspace (active)", { lifecycleStatus: "active", suspended: false, kind: "demo_prospect" }],
    ["demo workspace (expired)", { lifecycleStatus: "active", suspended: false, kind: "demo_prospect", demoExpiresAt: new Date(0) }],
  ];
  const intake = { process: "processed", store_only: "stored, no automation", reject: "refused with an error (never silently dropped)" };
  for (const [label, c] of rows) {
    const p = accountPolicy(c, new Date(1));
    lines.push(`| ${label} | ${p.login.replace("_", "‑")} | ${intake[p.intake]} | ${y(p.automatedSending)} | ${y(p.manualSending)} | ${y(p.sync)} | ${y(p.liveDeliveryAllowed)} |`);
  }
  lines.push("", "Read‑only accounts can still view and export their data (export window after churn).",
    "Reactivating a churned company returns it to onboarding and never resumes previously queued messages.", "");
  return lines.join("\n");
}

if (process.argv[1]?.endsWith("gen-permissions-doc.ts")) {
  writeFileSync("docs/PERMISSIONS.md", renderPermissionsDoc());
  console.log("docs/PERMISSIONS.md updated");
}
