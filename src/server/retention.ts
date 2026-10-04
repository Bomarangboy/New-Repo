import { and, eq, notExists, sql } from "drizzle-orm";
import { withPlatformDb } from "@/lib/db/context";
import type { Tx } from "@/lib/db/client";
import { companies, dataDeletions, memberships, users } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import type { PlatformContext } from "@/lib/authz/context-types";

/**
 * Permanent deletion of one company's customer data (docs/RETENTION.md, D-38).
 *
 * Restricted on purpose: only for ARCHIVED companies, only by an administrator with two-step verification
 * (adminActionContext), only after typing the company's exact name, and the database function itself
 * refuses anything that isn't archived (or a demo prospect). What is kept: the company row, invoices and
 * billing terms, lifecycle/package history, support-access grants, the activity log and this deletion record.
 * Backups still contain the data until they expire (see RETENTION.md) — the screen says so.
 */
export const KEPT_AFTER_DELETION = ["company name and status", "invoices and billing terms", "package and status history", "support-access records", "activity log", "opt-out list (so people who said STOP are never contacted again)", "this deletion record"];

/** Runs the database function; returns rows removed per table. Caller must already be in platform/system scope. */
export async function purgeCompanyData(tx: Tx, companyId: string, keepAccess = false): Promise<Record<string, number>> {
  const [r] = await tx.execute<{ summary: Record<string, number> }>(sql`select app.purge_company_data(${companyId}::uuid, ${keepAccess}) as summary`);
  return Object.fromEntries(Object.entries(r!.summary).filter(([, n]) => Number(n) > 0).map(([k, n]) => [k, Number(n)]));
}

/** Sign-in accounts that no longer belong to any company are switched off (never platform administrators). */
export async function disableOrphanUsers(tx: Tx, userIds: string[]): Promise<number> {
  let n = 0;
  for (const id of userIds) {
    const r = await tx.update(users).set({ status: "disabled" }).where(and(eq(users.id, id), eq(users.isPlatformAdmin, false),
      notExists(tx.select({ x: sql`1` }).from(memberships).where(and(eq(memberships.userId, id), eq(memberships.status, "active")))))).returning({ id: users.id });
    n += r.length;
  }
  return n;
}

export async function deletionPreview(ctx: PlatformContext, companyId: string) {
  return withPlatformDb(ctx, async (tx) => {
    const [c] = await tx.select().from(companies).where(eq(companies.id, companyId));
    if (!c) return null;
    const [counts] = await tx.execute<{ leads: number; contacts: number; messages: number; appointments: number; members: number }>(sql`
      select (select count(*) from app.inquiries where company_id = ${companyId})::int as leads,
             (select count(*) from app.contacts where company_id = ${companyId})::int as contacts,
             (select count(*) from app.messages where company_id = ${companyId})::int as messages,
             (select count(*) from app.appointments where company_id = ${companyId})::int as appointments,
             (select count(*) from app.memberships where company_id = ${companyId})::int as members`);
    const previous = await tx.select().from(dataDeletions).where(eq(dataDeletions.companyId, companyId));
    return { company: c, counts: counts!, previous, allowed: c.lifecycleStatus === "archived" };
  });
}

export async function deleteCompanyData(ctx: PlatformContext, companyId: string, input: { confirmName: string; reason: string }, requestId?: string) {
  const reason = input.reason.trim().slice(0, 500);
  if (reason.length < 5) throw new UserError("Say why the data is being deleted (for example, “client asked in writing on 3 May”).");
  return withPlatformDb(ctx, async (tx) => {
    const [c] = await tx.select().from(companies).where(eq(companies.id, companyId)).for("update");
    if (!c) throw new UserError("Company not found.");
    if (c.lifecycleStatus !== "archived") throw new UserError("Archive the company first. Data can only be deleted from archived companies.");
    if (input.confirmName.trim() !== c.name) throw new UserError("The name you typed doesn't match the company name exactly.");
    const members = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.companyId, companyId));
    const summary = await purgeCompanyData(tx, companyId);
    const disabled = await disableOrphanUsers(tx, members.map((m) => m.userId));
    if (disabled) summary.sign_in_accounts_disabled = disabled;
    const [rec] = await tx.insert(dataDeletions).values({ companyId, companyName: c.name, requestedByUserId: ctx.userId, reason, summary }).returning();
    await audit(tx, { companyId, actorUserId: ctx.userId, actorType: "platform_admin", action: "company.data_deleted", targetType: "company", targetId: companyId, details: { reason, summary }, requestId });
    return rec!;
  });
}
