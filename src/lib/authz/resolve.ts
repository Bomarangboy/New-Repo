import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, setContext } from "@/lib/db/client";
import { companies, memberships, supportAccessGrants, users } from "@/lib/db/schema";
import type { Identity } from "@/lib/auth/types";
import { accountPolicy } from "./account-policy";
import { hasFeature, type Feature } from "./entitlements";
import { roleCan, type Action, type WorkspaceRole } from "./permissions";
import type { CompanyContext } from "./context-types";

/**
 * Framework-free authorization core (unit/integration tested directly).
 * The Next.js wrappers in ./guard.ts add cookies, redirects and request caching.
 */

export type AppUser = typeof users.$inferSelect;

export type AuthzFailure =
  | "unauthenticated"
  | "no_company"
  | "forbidden"
  | "not_entitled"
  | "account_restricted"
  | "read_only";

export class AuthzError extends Error {
  constructor(public readonly code: AuthzFailure, message?: string) {
    super(message ?? code);
  }
}

/** Actions that remain available when an account is read-only (e.g. churned, export window). */
function allowedWhenReadOnly(action: Action): boolean {
  return action.endsWith(".view") || action === "lead.export" || action === "data.export_all" || action === "support.request";
}

/** Maps a provider identity to an active Bluewater user, applying revocation and status checks. */
export async function resolveUser(identity: Identity | null): Promise<AppUser | null> {
  if (!identity) return null;
  const user = await getDb().transaction(async (tx) => {
    await setContext(tx, { authUserId: identity.authUserId });
    const [u] = await tx.select().from(users).where(eq(users.authUserId, identity.authUserId));
    return u ?? null;
  });
  if (!user || user.status !== "active") return null;
  if (user.sessionsRevokedAt && identity.authenticatedAt < user.sessionsRevokedAt) return null;
  return user;
}

export interface CompanyChoice {
  id: string;
  name: string;
  role: "owner" | "employee";
}

export async function listUserCompanies(userId: string): Promise<CompanyChoice[]> {
  return getDb().transaction(async (tx) => {
    await setContext(tx, { userId });
    return tx
      .select({ id: companies.id, name: companies.name, role: memberships.role })
      .from(memberships)
      .innerJoin(companies, eq(companies.id, memberships.companyId))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
      .orderBy(companies.name);
  });
}

/**
 * Decides whether `user` may perform `action` (needing `feature`) in the requested company.
 * `requestedCompanyId` is only a preference from the browser — it is never trusted:
 * access requires an active membership or a live support grant found in the database.
 */
export async function resolveCompanyContext(params: {
  user: AppUser;
  identity: Identity;
  requestedCompanyId: string | null;
  action: Action;
  feature?: Feature;
  now?: Date;
}): Promise<CompanyContext> {
  const { user, identity, action, feature } = params;
  const now = params.now ?? new Date();
  if (identity.mfaEnrolled && identity.aal !== 2) throw new AuthzError("unauthenticated");

  const resolved = await getDb().transaction(async (tx) => {
    await setContext(tx, { userId: user.id });
    const memberRows = await tx
      .select({ companyId: memberships.companyId, role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, user.id), eq(memberships.status, "active")));

    const requested = params.requestedCompanyId;
    let companyId: string | null = null;
    let role: WorkspaceRole | null = null;
    let supportGrantId: string | null = null;

    const membership = requested ? memberRows.find((m) => m.companyId === requested) : memberRows[0];
    if (membership) {
      companyId = membership.companyId;
      role = membership.role;
    } else if (requested && user.isPlatformAdmin && identity.aal === 2) {
      // Administrators reach a client workspace only through an explicit, live support grant.
      await setContext(tx, { userId: user.id, scope: "platform" });
      const [grant] = await tx
        .select()
        .from(supportAccessGrants)
        .where(and(
          eq(supportAccessGrants.companyId, requested),
          eq(supportAccessGrants.adminUserId, user.id),
          isNull(supportAccessGrants.endedAt),
          gt(supportAccessGrants.expiresAt, now),
        ))
        .orderBy(sql`${supportAccessGrants.createdAt} desc`)
        .limit(1);
      if (grant) {
        companyId = requested;
        role = grant.readOnly ? "support_read" : "support_edit";
        supportGrantId = grant.id;
      }
    }
    if (!companyId || !role) return null;

    await setContext(tx, { companyId, userId: user.id });
    const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
    return company ? { company, role, supportGrantId } : null;
  });

  if (!resolved) throw new AuthzError(params.requestedCompanyId ? "forbidden" : "no_company");
  const { company, role, supportGrantId } = resolved;

  const policy = accountPolicy(company, now);
  if (policy.login === "none") throw new AuthzError("account_restricted");
  if (policy.login === "read_only" && !allowedWhenReadOnly(action)) throw new AuthzError("read_only");
  if (!roleCan(role, action)) throw new AuthzError("forbidden");
  if (feature && !hasFeature(company.package, feature)) throw new AuthzError("not_entitled");

  return {
    userId: user.id,
    companyId: company.id,
    companyName: company.name,
    companyKind: company.kind,
    timezone: company.timezone,
    role,
    package: company.package,
    policy,
    supportGrantId,
  };
}
