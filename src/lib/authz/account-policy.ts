/**
 * Account-status behavior matrix. Lifecycle, billing and technical suspension are
 * tracked separately on the company; this function combines them into what the
 * platform is allowed to do right now. Documented in docs/PERMISSIONS.md.
 *
 * Principle: never silently lose a lead. When automation is not allowed we still
 * store incoming inquiries ("store_only") unless the service has ended ("reject",
 * which returns an explicit error to the sender rather than pretending success).
 */
export type LifecycleStatus = "onboarding" | "active" | "paused" | "churned" | "archived";
export type CompanyKind = "customer" | "internal_test" | "demo_template" | "demo_prospect";

export interface AccountPolicy {
  login: "full" | "read_only" | "none";
  intake: "process" | "store_only" | "reject";
  automatedSending: boolean;
  manualSending: boolean;
  sync: boolean;
  /** Real external delivery allowed at all (false for demos/tests — they simulate). */
  liveDeliveryAllowed: boolean;
}

export function accountPolicy(c: {
  lifecycleStatus: LifecycleStatus;
  suspended: boolean;
  kind: CompanyKind;
  demoExpiresAt?: Date | null;
}, now = new Date()): AccountPolicy {
  const isDemo = c.kind === "demo_prospect" || c.kind === "demo_template";
  const liveDeliveryAllowed = c.kind === "customer";

  if (isDemo && c.demoExpiresAt && c.demoExpiresAt <= now) {
    return { login: "none", intake: "reject", automatedSending: false, manualSending: false, sync: false, liveDeliveryAllowed: false };
  }

  let p: AccountPolicy;
  switch (c.lifecycleStatus) {
    case "onboarding":
      // Leads are stored so setup can be tested; automation waits for activation.
      p = { login: "full", intake: "store_only", automatedSending: false, manualSending: false, sync: true, liveDeliveryAllowed };
      break;
    case "active":
      p = { login: "full", intake: "process", automatedSending: true, manualSending: true, sync: true, liveDeliveryAllowed };
      break;
    case "paused":
      p = { login: "full", intake: "store_only", automatedSending: false, manualSending: true, sync: true, liveDeliveryAllowed };
      break;
    case "churned":
      // Read-only access for data export during the agreed export window.
      p = { login: "read_only", intake: "reject", automatedSending: false, manualSending: false, sync: false, liveDeliveryAllowed };
      break;
    case "archived":
      p = { login: "none", intake: "reject", automatedSending: false, manualSending: false, sync: false, liveDeliveryAllowed };
      break;
  }

  if (c.suspended) {
    p = {
      ...p,
      login: p.login === "none" ? "none" : "read_only",
      intake: p.intake === "reject" ? "reject" : "store_only",
      automatedSending: false,
      manualSending: false,
      sync: false,
    };
  }
  return p;
}
