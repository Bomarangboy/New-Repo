import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { withCompanyDb } from "@/lib/db/context";
import { inquiries, intakeEvents, intakeSources } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { encrypt, newToken } from "@/lib/crypto";
import { UserError } from "@/lib/errors";
import { roleCan } from "@/lib/authz/permissions";
import type { CompanyContext } from "@/lib/authz/context-types";

function need(ctx: CompanyContext, manage: boolean) {
  if (!roleCan(ctx.role, manage ? "integration.manage" : "integration.view")) throw new UserError("You don't have permission to do that.");
  if (manage && ctx.policy.login !== "full") throw new UserError("This account is read-only right now, so changes can't be saved.");
}

const originSchema = z.string().trim().transform((s, c) => {
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.hostname !== "localhost") throw new Error();
    return u.origin;
  } catch {
    c.addIssue({ code: "custom", message: `"${s}" isn't a valid website address (use https://…).` });
    return z.NEVER;
  }
});

export const sourceSchema = z.object({
  name: z.string().trim().min(2, "Name the form, e.g. 'Contact page'").max(80),
  allowedOrigins: z.array(originSchema).max(10),
});

export async function listIntakeSources(ctx: CompanyContext) {
  need(ctx, false);
  return withCompanyDb(ctx, async (tx) => {
    const sources = await tx.select().from(intakeSources).orderBy(desc(intakeSources.createdAt));
    const since = new Date(Date.now() - 7 * 86400_000);
    // "Received" = leads actually created from the form (same basis as the dashboard);
    // rejected/failed come from the raw submission log.
    const leads = await tx.select({ sourceId: inquiries.intakeSourceId, n: count() }).from(inquiries)
      .where(and(gt(inquiries.receivedAt, since), sql`${inquiries.intakeSourceId} is not null`)).groupBy(inquiries.intakeSourceId);
    const stats = await tx.select({ sourceId: intakeEvents.intakeSourceId, status: intakeEvents.status, n: count() }).from(intakeEvents)
      .where(and(gt(intakeEvents.receivedAt, since), sql`${intakeEvents.status} in ('rejected','failed')`, sql`coalesce(${intakeEvents.error}, '') <> 'spam_trap'`))
      .groupBy(intakeEvents.intakeSourceId, intakeEvents.status);
    return sources.map((s) => ({
      id: s.id, name: s.name, kind: s.kind, publicKey: s.publicKey, signed: Boolean(s.signingSecretEnc), allowedOrigins: s.allowedOrigins,
      active: s.active, lastReceivedAt: s.lastReceivedAt, createdAt: s.createdAt,
      last7Days: {
        received: leads.find((x) => x.sourceId === s.id)?.n ?? 0,
        ...Object.fromEntries(stats.filter((x) => x.sourceId === s.id).map((x) => [x.status, x.n])),
      } as Record<string, number>,
    }));
  });
}

export async function createIntakeSource(ctx: CompanyContext, input: z.input<typeof sourceSchema>, requestId?: string) {
  need(ctx, true);
  const data = sourceSchema.parse(input);
  return withCompanyDb(ctx, async (tx) => {
    const [s] = await tx.insert(intakeSources).values({ companyId: ctx.companyId, name: data.name, publicKey: newToken(18), allowedOrigins: data.allowedOrigins }).returning();
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: ctx.supportGrantId ? "support" : "user", action: "intake.source_created", targetType: "intake_source", targetId: s!.id, details: { name: data.name }, requestId });
    return s!;
  });
}

export async function updateIntakeSource(ctx: CompanyContext, id: string, input: z.input<typeof sourceSchema> & { active: boolean }, requestId?: string) {
  need(ctx, true);
  const data = sourceSchema.parse(input);
  return withCompanyDb(ctx, async (tx) => {
    const [s] = await tx.update(intakeSources).set({ name: data.name, allowedOrigins: data.allowedOrigins, active: input.active, updatedAt: new Date() })
      .where(eq(intakeSources.id, id)).returning();
    if (!s) throw new UserError("Form connection not found.");
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: ctx.supportGrantId ? "support" : "user", action: input.active ? "intake.source_updated" : "intake.source_disabled", targetType: "intake_source", targetId: id, details: { name: data.name, allowedOrigins: data.allowedOrigins }, requestId });
  });
}

/** Creates a new signing secret. It is shown ONCE; afterwards only an encrypted copy exists. */
export async function rotateSigningSecret(ctx: CompanyContext, id: string, requestId?: string): Promise<string> {
  need(ctx, true);
  const secret = `bws_${newToken(32)}`;
  await withCompanyDb(ctx, async (tx) => {
    const [s] = await tx.update(intakeSources).set({ signingSecretEnc: encrypt(secret), updatedAt: new Date() }).where(eq(intakeSources.id, id)).returning({ id: intakeSources.id });
    if (!s) throw new UserError("Form connection not found.");
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: ctx.supportGrantId ? "support" : "user", action: "intake.signing_secret_rotated", targetType: "intake_source", targetId: id, requestId });
  });
  return secret;
}

export async function removeSigningSecret(ctx: CompanyContext, id: string, requestId?: string) {
  need(ctx, true);
  await withCompanyDb(ctx, async (tx) => {
    await tx.update(intakeSources).set({ signingSecretEnc: null, updatedAt: new Date() }).where(eq(intakeSources.id, id));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: ctx.supportGrantId ? "support" : "user", action: "intake.signing_secret_removed", targetType: "intake_source", targetId: id, requestId });
  });
}

export async function recentIntakeProblems(ctx: CompanyContext, limit = 20) {
  need(ctx, false);
  return withCompanyDb(ctx, (tx) =>
    tx.select({ id: intakeEvents.id, status: intakeEvents.status, error: intakeEvents.error, receivedAt: intakeEvents.receivedAt, sourceName: intakeSources.name })
      .from(intakeEvents).innerJoin(intakeSources, eq(intakeSources.id, intakeEvents.intakeSourceId))
      .where(and(sql`${intakeEvents.status} in ('rejected','failed')`, sql`coalesce(${intakeEvents.error}, '') <> 'spam_trap'`))
      .orderBy(desc(intakeEvents.receivedAt)).limit(limit),
  );
}
