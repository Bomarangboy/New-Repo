import { UserError } from "@/lib/errors";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { withCompanyDb, withSystemDb } from "@/lib/db/context";
import { auditLog, companies, memberships, users } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { roleCan } from "@/lib/authz/permissions";
import type { CompanyContext } from "@/lib/authz/context-types";
import { isValidTimezone } from "@/lib/timezones";

function assertCan(ctx: CompanyContext, action: Parameters<typeof roleCan>[1]) {
  if (!roleCan(ctx.role, action)) throw new UserError("You don't have permission to do that.");
}

function actorType(ctx: CompanyContext) {
  return ctx.supportGrantId ? ("support" as const) : ("user" as const);
}

export async function listTeam(ctx: CompanyContext) {
  assertCan(ctx, "team.view");
  return withCompanyDb(ctx, (tx) =>
    tx.select({ userId: users.id, email: users.email, fullName: users.fullName, role: memberships.role, since: memberships.createdAt })
      .from(memberships).innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.companyId, ctx.companyId), eq(memberships.status, "active")))
      .orderBy(memberships.role, users.fullName),
  );
}

/**
 * Employee offboarding: removes workspace access immediately (every request re-checks
 * membership) and records the change. The person's past activity stays attributed to them.
 */
export async function removeMember(ctx: CompanyContext, userId: string, requestId?: string) {
  assertCan(ctx, "team.remove");
  if (userId === ctx.userId) throw new UserError("You can't remove yourself. Transfer ownership first.");
  await withCompanyDb(ctx, async (tx) => {
    const res = await tx.update(memberships).set({ status: "removed", removedAt: new Date() })
      .where(and(eq(memberships.companyId, ctx.companyId), eq(memberships.userId, userId), eq(memberships.status, "active"), ne(memberships.role, "owner")))
      .returning({ id: memberships.id });
    if (!res.length) throw new UserError("Team member not found.");
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "team.member_removed", targetType: "user", targetId: userId, requestId });
  });
  // Assignments/tasks reassignment is added in Stage 2 when those records exist.
}

/**
 * Transfers ownership to an existing active employee. The current owner becomes an
 * employee. Requires the owner to type the company name and to have signed in recently.
 */
export async function transferOwnership(
  ctx: CompanyContext, toUserId: string, confirmName: string, authenticatedAt: Date, requestId?: string,
) {
  if (ctx.role !== "owner") throw new UserError("Only the current owner can transfer ownership.");
  if (confirmName.trim() !== ctx.companyName) throw new UserError("Type the company name exactly to confirm.");
  if (Date.now() - authenticatedAt.getTime() > 15 * 60_000) throw new UserError("For security, sign out and sign in again, then retry within 15 minutes.");
  if (toUserId === ctx.userId) throw new UserError("Choose a different team member.");
  await withCompanyDb(ctx, async (tx) => {
    const [target] = await tx.select().from(memberships)
      .where(and(eq(memberships.companyId, ctx.companyId), eq(memberships.userId, toUserId), eq(memberships.status, "active")));
    if (!target) throw new UserError("The new owner must be an active team member.");
    // Demote first so the one-owner rule holds at every moment.
    await tx.update(memberships).set({ role: "employee" }).where(and(eq(memberships.companyId, ctx.companyId), eq(memberships.userId, ctx.userId)));
    await tx.update(memberships).set({ role: "owner" }).where(eq(memberships.id, target.id));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: "user", action: "company.ownership_transferred", targetType: "user", targetId: toUserId, requestId });
  });
}

export const settingsSchema = z.object({
  name: z.string().trim().min(2, "Enter the business name").max(120),
  timezone: z.string().refine(isValidTimezone, "Choose a valid timezone"),
});

export async function updateCompanySettings(ctx: CompanyContext, input: z.input<typeof settingsSchema>, requestId?: string) {
  assertCan(ctx, "settings.manage");
  const data = settingsSchema.parse(input);
  return withCompanyDb(ctx, async (tx) => {
    const [before] = await tx.select({ name: companies.name, timezone: companies.timezone }).from(companies).where(eq(companies.id, ctx.companyId));
    const [updated] = await tx.update(companies).set({ name: data.name, timezone: data.timezone }).where(eq(companies.id, ctx.companyId)).returning();
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "company.settings_updated", targetType: "company", targetId: ctx.companyId, details: { before, after: data }, requestId });
    return updated!;
  });
}

export async function companyActivity(ctx: CompanyContext, limit = 100) {
  assertCan(ctx, "audit.view");
  return withCompanyDb(ctx, (tx) =>
    tx.select({ id: auditLog.id, action: auditLog.action, actorType: auditLog.actorType, actorEmail: users.email, details: auditLog.details, createdAt: auditLog.createdAt })
      .from(auditLog).leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(eq(auditLog.companyId, ctx.companyId)).orderBy(desc(auditLog.createdAt)).limit(limit),
  );
}

/** Platform-level: disable a user everywhere (e.g. compromised account). */
export async function markSessionsRevoked(userId: string) {
  await withSystemDb("account: revoke sessions", (tx) => tx.update(users).set({ sessionsRevokedAt: new Date() }).where(eq(users.id, userId)));
}

/** Built-in CRM is available; external CRM connectors are added per client (none live yet). */
export const AVAILABLE_EXTERNAL_CRMS: { id: string; name: string }[] = [];

export async function chooseCrmMode(ctx: CompanyContext, mode: "built_in" | "external", requestId?: string) {
  assertCan(ctx, "settings.manage");
  if (mode === "external" && AVAILABLE_EXTERNAL_CRMS.length === 0) {
    throw new UserError("Connecting an external CRM isn't available yet. Use the built-in CRM for now — your records can be moved later.");
  }
  await withCompanyDb(ctx, async (tx) => {
    await tx.update(companies).set({ crmMode: mode }).where(eq(companies.id, ctx.companyId));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "company.crm_mode_selected", targetType: "company", targetId: ctx.companyId, details: { mode }, requestId });
  });
}

export async function getCompanySummary(ctx: CompanyContext) {
  return withCompanyDb(ctx, async (tx) => {
    const [c] = await tx.select().from(companies).where(eq(companies.id, ctx.companyId));
    return c!;
  });
}
