import { UserError } from "@/lib/errors";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withPlatformDb } from "@/lib/db/context";
import { companies, lifecycleHistory, memberships, packageHistory, supportAccessGrants, users } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { PACKAGES, type PackageTier } from "@/lib/authz/entitlements";
import type { LifecycleStatus } from "@/lib/authz/account-policy";
import type { PlatformContext } from "@/lib/authz/context-types";
import { isValidTimezone } from "@/lib/timezones";

/* Platform-administrator operations on client companies. */

export const LIFECYCLE: LifecycleStatus[] = ["onboarding", "active", "paused", "churned", "archived"];

/** Allowed lifecycle moves. Reactivation (churned → onboarding) is explicit and never resumes old queued work. */
const TRANSITIONS: Record<LifecycleStatus, LifecycleStatus[]> = {
  onboarding: ["active", "churned", "archived"],
  active: ["paused", "churned"],
  paused: ["active", "churned"],
  churned: ["onboarding", "archived"],
  archived: ["onboarding"],
};

export function canTransition(from: LifecycleStatus, to: LifecycleStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const createCompanySchema = z.object({
  name: z.string().trim().min(2, "Enter the business name").max(120),
  timezone: z.string().refine(isValidTimezone, "Choose a valid timezone"),
  package: z.enum(PACKAGES),
  kind: z.enum(["customer", "internal_test"]).default("customer"),
});

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "company";
}

export async function createCompany(ctx: PlatformContext, input: z.input<typeof createCompanySchema>, requestId?: string) {
  const data = createCompanySchema.parse(input);
  return withPlatformDb(ctx, async (tx) => {
    let slug = slugify(data.name);
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(companies).where(sql`${companies.slug} like ${slug + "%"}`)) as [{ n: number }];
    if (n > 0) slug = `${slug}-${n + 1}`;
    const [company] = await tx.insert(companies).values({
      name: data.name, slug, timezone: data.timezone, package: data.package, kind: data.kind,
    }).returning();
    await tx.insert(packageHistory).values({ companyId: company!.id, toPackage: data.package, changedByUserId: ctx.userId, note: "Company created" });
    await tx.insert(lifecycleHistory).values({ companyId: company!.id, toStatus: "onboarding", changedByUserId: ctx.userId, reason: "Company created" });
    await audit(tx, {
      companyId: company!.id, actorUserId: ctx.userId, actorType: "platform_admin", action: "company.created",
      targetType: "company", targetId: company!.id, details: { name: data.name, package: data.package, kind: data.kind }, requestId,
    });
    return company!;
  });
}

export async function listCompanies(ctx: PlatformContext, filter: { status?: LifecycleStatus; q?: string } = {}) {
  return withPlatformDb(ctx, async (tx) => {
    const owner = tx.$with("owner").as(
      tx.select({ companyId: memberships.companyId, ownerEmail: users.email, ownerName: users.fullName })
        .from(memberships).innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.role, "owner"), eq(memberships.status, "active"))),
    );
    const conds = [sql`${companies.kind} in ('customer','internal_test')`];
    if (filter.status) conds.push(eq(companies.lifecycleStatus, filter.status));
    if (filter.q) conds.push(or(ilike(companies.name, `%${filter.q}%`), ilike(owner.ownerEmail, `%${filter.q}%`))!);
    return tx.with(owner).select({
      id: companies.id, name: companies.name, kind: companies.kind, package: companies.package,
      lifecycleStatus: companies.lifecycleStatus, billingStatus: companies.billingStatus, suspended: companies.suspended,
      serviceStartDate: companies.serviceStartDate, serviceEndsAt: companies.serviceEndsAt, createdAt: companies.createdAt,
      ownerEmail: owner.ownerEmail, ownerName: owner.ownerName,
    }).from(companies).leftJoin(owner, eq(owner.companyId, companies.id)).where(and(...conds)).orderBy(companies.name);
  });
}

export async function getCompanyForAdmin(ctx: PlatformContext, companyId: string) {
  return withPlatformDb(ctx, async (tx) => {
    const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
    if (!company) return null;
    const team = await tx.select({ userId: users.id, email: users.email, fullName: users.fullName, role: memberships.role, status: memberships.status })
      .from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.companyId, companyId)).orderBy(memberships.role);
    const packages = await tx.select().from(packageHistory).where(eq(packageHistory.companyId, companyId)).orderBy(desc(packageHistory.createdAt));
    const lifecycle = await tx.select().from(lifecycleHistory).where(eq(lifecycleHistory.companyId, companyId)).orderBy(desc(lifecycleHistory.createdAt));
    const grants = await tx.select().from(supportAccessGrants)
      .where(and(eq(supportAccessGrants.companyId, companyId), eq(supportAccessGrants.adminUserId, ctx.userId), isNull(supportAccessGrants.endedAt), sql`${supportAccessGrants.expiresAt} > now()`));
    return { company, team, packages, lifecycle, activeGrant: grants[0] ?? null };
  });
}

export async function changePackage(ctx: PlatformContext, companyId: string, to: PackageTier, note: string, requestId?: string) {
  if (!PACKAGES.includes(to)) throw new UserError("Unknown package");
  return withPlatformDb(ctx, async (tx) => {
    const [c] = await tx.select().from(companies).where(eq(companies.id, companyId)).for("update");
    if (!c) throw new UserError("Company not found");
    if (c.package === to) return c;
    const [updated] = await tx.update(companies).set({ package: to }).where(eq(companies.id, companyId)).returning();
    await tx.insert(packageHistory).values({ companyId, fromPackage: c.package, toPackage: to, changedByUserId: ctx.userId, note: note || null });
    await audit(tx, {
      companyId, actorUserId: ctx.userId, actorType: "platform_admin", action: "company.package_changed",
      targetType: "company", targetId: companyId, details: { from: c.package, to, note }, requestId,
    });
    // Stage 4 will hook downgrade handling here (pausing sequences the new package no longer includes).
    return updated!;
  });
}

export async function changeLifecycle(
  ctx: PlatformContext, companyId: string, to: LifecycleStatus, opts: { reason?: string; serviceEndsAt?: Date | null } = {}, requestId?: string,
) {
  return withPlatformDb(ctx, async (tx) => {
    const [c] = await tx.select().from(companies).where(eq(companies.id, companyId)).for("update");
    if (!c) throw new UserError("Company not found");
    if (!canTransition(c.lifecycleStatus, to)) throw new UserError(`A company can't move from ${c.lifecycleStatus} to ${to}.`);
    if (to === "churned" && !opts.reason) throw new UserError("Record a churn reason.");
    const patch: Partial<typeof companies.$inferInsert> = { lifecycleStatus: to };
    if (to === "active" && !c.serviceStartDate) patch.serviceStartDate = new Date();
    if (to === "churned") {
      patch.churnReason = opts.reason;
      patch.serviceEndsAt = opts.serviceEndsAt ?? new Date();
    }
    if (to === "onboarding" && (c.lifecycleStatus === "churned" || c.lifecycleStatus === "archived")) {
      patch.churnReason = null;
      patch.serviceEndsAt = null;
      patch.cancellationRequestedAt = null;
    }
    const [updated] = await tx.update(companies).set(patch).where(eq(companies.id, companyId)).returning();
    await tx.insert(lifecycleHistory).values({ companyId, fromStatus: c.lifecycleStatus, toStatus: to, reason: opts.reason ?? null, changedByUserId: ctx.userId });
    await audit(tx, {
      companyId, actorUserId: ctx.userId, actorType: "platform_admin",
      action: c.lifecycleStatus === "churned" && to === "onboarding" ? "company.reactivated" : "company.lifecycle_changed",
      targetType: "company", targetId: companyId, details: { from: c.lifecycleStatus, to, reason: opts.reason }, requestId,
    });
    return updated!;
  });
}

export async function setSuspended(ctx: PlatformContext, companyId: string, suspended: boolean, reason: string, requestId?: string) {
  if (suspended && !reason.trim()) throw new UserError("Explain why the account is being suspended.");
  return withPlatformDb(ctx, async (tx) => {
    const [updated] = await tx.update(companies).set({ suspended, suspendedReason: suspended ? reason : null })
      .where(eq(companies.id, companyId)).returning();
    if (!updated) throw new UserError("Company not found");
    await audit(tx, {
      companyId, actorUserId: ctx.userId, actorType: "platform_admin",
      action: suspended ? "company.suspended" : "company.unsuspended", targetType: "company", targetId: companyId, details: { reason }, requestId,
    });
    return updated;
  });
}

export const SUPPORT_MAX_MINUTES = 60;

/** Opens time-limited, reason-required access to a client workspace. Visible in the client's activity log. */
export async function startSupportAccess(
  ctx: PlatformContext, companyId: string, input: { reason: string; readOnly: boolean; minutes?: number }, requestId?: string,
) {
  const reason = input.reason.trim();
  if (reason.length < 10) throw new UserError("Describe the support reason (at least 10 characters).");
  const minutes = Math.min(Math.max(input.minutes ?? 30, 5), SUPPORT_MAX_MINUTES);
  return withPlatformDb(ctx, async (tx) => {
    const [c] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
    if (!c) throw new UserError("Company not found");
    await tx.update(supportAccessGrants).set({ endedAt: new Date() })
      .where(and(eq(supportAccessGrants.companyId, companyId), eq(supportAccessGrants.adminUserId, ctx.userId), isNull(supportAccessGrants.endedAt)));
    const [grant] = await tx.insert(supportAccessGrants).values({
      companyId, adminUserId: ctx.userId, reason, readOnly: input.readOnly, expiresAt: new Date(Date.now() + minutes * 60_000),
    }).returning();
    await audit(tx, {
      companyId, actorUserId: ctx.userId, actorType: "support", action: "support.access_started",
      targetType: "support_grant", targetId: grant!.id, details: { reason, readOnly: input.readOnly, minutes }, requestId,
    });
    return grant!;
  });
}

export async function endSupportAccess(ctx: PlatformContext, companyId: string, requestId?: string) {
  return withPlatformDb(ctx, async (tx) => {
    const ended = await tx.update(supportAccessGrants).set({ endedAt: new Date() })
      .where(and(eq(supportAccessGrants.companyId, companyId), eq(supportAccessGrants.adminUserId, ctx.userId), isNull(supportAccessGrants.endedAt)))
      .returning({ id: supportAccessGrants.id });
    if (ended.length) {
      await audit(tx, { companyId, actorUserId: ctx.userId, actorType: "support", action: "support.access_ended", targetType: "support_grant", targetId: ended[0]!.id, requestId });
    }
  });
}
