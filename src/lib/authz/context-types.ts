import type { AccountPolicy, CompanyKind } from "./account-policy";
import type { PackageTier } from "./entitlements";
import type { WorkspaceRole } from "./permissions";

/** Produced only by requireCompanyContext() after server-side verification. */
export interface CompanyContext {
  readonly userId: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly companyKind: CompanyKind;
  readonly timezone: string;
  readonly role: WorkspaceRole;
  readonly package: PackageTier;
  readonly policy: AccountPolicy;
  /** Set when a Bluewater administrator is working under a support grant. */
  readonly supportGrantId: string | null;
}

export interface PlatformContext {
  readonly userId: string;
  readonly isPlatformAdmin: true;
  readonly mfaVerified: boolean;
}
