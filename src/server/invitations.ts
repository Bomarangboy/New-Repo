import { UserError } from "@/lib/errors";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withCompanyDb, withPlatformDb, withSystemDb } from "@/lib/db/context";
import { companies, invitations, memberships, users } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { hashToken, newToken, passwordProblems } from "@/lib/crypto";
import { roleCan } from "@/lib/authz/permissions";
import { accountPolicy } from "@/lib/authz/account-policy";
import type { CompanyContext, PlatformContext } from "@/lib/authz/context-types";
import { sendSystemEmail } from "@/lib/system-email";
import type { AuthProvider, Identity } from "@/lib/auth/types";

export const INVITE_DAYS = 7;
const emailSchema = z.email("Enter a valid email address").transform((e) => e.trim().toLowerCase());

function inviteEmail(to: string, companyName: string, role: string, link: string) {
  return {
    to,
    subject: `You're invited to ${companyName} on Bluewater Collective`,
    text: `You've been invited to join ${companyName} on Bluewater Collective as ${role === "owner" ? "the account owner" : "a team member"}.\n\nAccept the invitation: ${link}\n\nThis link expires in ${INVITE_DAYS} days and can be used once. If you weren't expecting this, you can ignore it.`,
  };
}

/** A company owner invites an employee. */
export async function inviteEmployee(ctx: CompanyContext, rawEmail: string, baseUrl: string, requestId?: string) {
  if (!roleCan(ctx.role, "team.invite")) throw new UserError("Only the account owner can invite people.");
  const email = emailSchema.parse(rawEmail);
  const token = newToken();
  await withCompanyDb(ctx, async (tx) => {
    const existing = await tx.select({ id: memberships.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.companyId, ctx.companyId), eq(memberships.status, "active"), sql`lower(${users.email}) = ${email}`));
    if (existing.length) throw new UserError("That person is already on your team.");
    // Re-inviting replaces any earlier pending invitation for the same address.
    await tx.update(invitations).set({ revokedAt: new Date() })
      .where(and(eq(invitations.companyId, ctx.companyId), sql`lower(${invitations.email}) = ${email}`, isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
    const [inv] = await tx.insert(invitations).values({
      companyId: ctx.companyId, email, role: "employee", tokenHash: hashToken(token),
      invitedByUserId: ctx.userId, expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000),
    }).returning();
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: "user", action: "team.invited", targetType: "invitation", targetId: inv!.id, details: { email, role: "employee" }, requestId });
  });
  await sendSystemEmail(inviteEmail(email, ctx.companyName, "employee", `${baseUrl}/invite/${token}`));
}

/** Bluewater administrator invites a company's owner. */
export async function inviteOwner(ctx: PlatformContext, companyId: string, rawEmail: string, baseUrl: string, requestId?: string) {
  const email = emailSchema.parse(rawEmail);
  const token = newToken();
  const companyName = await withPlatformDb(ctx, async (tx) => {
    const [c] = await tx.select().from(companies).where(eq(companies.id, companyId));
    if (!c) throw new UserError("Company not found");
    const [owner] = await tx.select({ id: memberships.id }).from(memberships)
      .where(and(eq(memberships.companyId, companyId), eq(memberships.role, "owner"), eq(memberships.status, "active")));
    if (owner) throw new UserError("This company already has an owner. Use ownership transfer instead.");
    await tx.update(invitations).set({ revokedAt: new Date() })
      .where(and(eq(invitations.companyId, companyId), eq(invitations.role, "owner"), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
    const [inv] = await tx.insert(invitations).values({
      companyId, email, role: "owner", tokenHash: hashToken(token), invitedByUserId: ctx.userId,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000),
    }).returning();
    await audit(tx, { companyId, actorUserId: ctx.userId, actorType: "platform_admin", action: "team.owner_invited", targetType: "invitation", targetId: inv!.id, details: { email }, requestId });
    return c.name;
  });
  await sendSystemEmail(inviteEmail(email, companyName, "owner", `${baseUrl}/invite/${token}`));
}

export async function listPendingInvitations(ctx: CompanyContext) {
  return withCompanyDb(ctx, (tx) =>
    tx.select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt })
      .from(invitations)
      .where(and(eq(invitations.companyId, ctx.companyId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())))
      .orderBy(desc(invitations.createdAt)),
  );
}

export async function revokeInvitation(ctx: CompanyContext, invitationId: string, requestId?: string) {
  if (!roleCan(ctx.role, "team.invite")) throw new UserError("Only the account owner can manage invitations.");
  await withCompanyDb(ctx, async (tx) => {
    const res = await tx.update(invitations).set({ revokedAt: new Date() })
      .where(and(eq(invitations.id, invitationId), eq(invitations.companyId, ctx.companyId), isNull(invitations.acceptedAt)))
      .returning({ id: invitations.id });
    if (!res.length) throw new UserError("Invitation not found.");
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: "user", action: "team.invitation_revoked", targetType: "invitation", targetId: invitationId, requestId });
  });
}

export type InvitationView =
  | { state: "invalid" }
  | { state: "expired" | "used"; companyName: string }
  | { state: "open"; companyName: string; email: string; role: "owner" | "employee"; accountExists: boolean };

/** Public lookup for the /invite/[token] page. Reveals nothing for unknown tokens. */
export async function viewInvitation(token: string): Promise<InvitationView> {
  return withSystemDb("invitation: view", async (tx) => {
    const [row] = await tx.select({ inv: invitations, companyName: companies.name, companyKind: companies.kind, lifecycle: companies.lifecycleStatus, suspended: companies.suspended, demoExpiresAt: companies.demoExpiresAt })
      .from(invitations).innerJoin(companies, eq(companies.id, invitations.companyId))
      .where(eq(invitations.tokenHash, hashToken(token)));
    if (!row) return { state: "invalid" };
    if (row.inv.acceptedAt || row.inv.revokedAt) return { state: "used", companyName: row.companyName };
    if (row.inv.expiresAt <= new Date()) return { state: "expired", companyName: row.companyName };
    if (accountPolicy({ lifecycleStatus: row.lifecycle, suspended: row.suspended, kind: row.companyKind, demoExpiresAt: row.demoExpiresAt }).login === "none") {
      return { state: "expired", companyName: row.companyName };
    }
    const [u] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${row.inv.email.toLowerCase()}`);
    return { state: "open", companyName: row.companyName, email: row.inv.email, role: row.inv.role, accountExists: Boolean(u) };
  });
}

/**
 * Accepts an invitation. Either `identity` (already signed in with the invited email)
 * or `newAccount` (creates the identity; email ownership is proven by the emailed link).
 * Single use: the invitation row is claimed atomically.
 */
export async function acceptInvitation(
  token: string,
  opts: { identity: Identity } | { newAccount: { fullName: string; password: string }; provider: AuthProvider },
  requestId?: string,
): Promise<{ companyId: string; email: string }> {
  if ("newAccount" in opts) {
    const problem = passwordProblems(opts.newAccount.password);
    if (problem) throw new UserError(problem);
    if (opts.newAccount.fullName.trim().length < 2) throw new UserError("Enter your name.");
  }
  const view = await viewInvitation(token);
  if (view.state !== "open") throw new UserError("This invitation is no longer valid. Ask for a new one.");
  if ("identity" in opts && opts.identity.email.toLowerCase() !== view.email.toLowerCase()) {
    throw new UserError(`This invitation is for ${view.email}. Sign in with that address to accept it.`);
  }
  if ("newAccount" in opts && view.accountExists) throw new UserError("An account already exists for this email. Sign in to accept.");

  // Create the identity first (outside our transaction: it lives in the identity provider).
  const authUserId = "identity" in opts ? opts.identity.authUserId : await opts.provider.createUser(view.email, opts.newAccount.password);

  return withSystemDb("invitation: accept", async (tx) => {
    const [inv] = await tx.update(invitations).set({ acceptedAt: new Date() })
      .where(and(eq(invitations.tokenHash, hashToken(token)), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())))
      .returning();
    if (!inv) throw new UserError("This invitation is no longer valid. Ask for a new one.");

    let [user] = await tx.select().from(users).where(eq(users.authUserId, authUserId));
    if (!user) {
      [user] = await tx.insert(users).values({
        authUserId, email: inv.email, fullName: "newAccount" in opts ? opts.newAccount.fullName.trim() : "",
      }).returning();
    }
    if (user!.status !== "active") throw new UserError("This account is disabled. Contact Bluewater support.");

    if (inv.role === "owner") {
      const [owner] = await tx.select({ id: memberships.id }).from(memberships)
        .where(and(eq(memberships.companyId, inv.companyId), eq(memberships.role, "owner"), eq(memberships.status, "active")));
      if (owner) throw new UserError("This company already has an owner.");
    }
    await tx.insert(memberships).values({ companyId: inv.companyId, userId: user!.id, role: inv.role, status: "active" })
      .onConflictDoUpdate({ target: [memberships.companyId, memberships.userId], set: { role: inv.role, status: "active", removedAt: null, updatedAt: new Date() } });
    await audit(tx, { companyId: inv.companyId, actorUserId: user!.id, actorType: "user", action: "team.invitation_accepted", targetType: "invitation", targetId: inv.id, details: { email: inv.email, role: inv.role }, requestId });
    return { companyId: inv.companyId, email: inv.email };
  });
}
