import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { closeDb } from "@/lib/db/client";
import { withSystemDb } from "@/lib/db/context";
import { devOutbox, lifecycleHistory, memberships } from "@/lib/db/schema";
import * as local from "@/lib/auth/local-core";
import { totpAt } from "@/lib/crypto";
import { resolveCompanyContext, AuthzError } from "@/lib/authz/resolve";
import { acceptInvitation, inviteEmployee, inviteOwner, revokeInvitation, viewInvitation, listPendingInvitations } from "@/server/invitations";
import { removeMember, transferOwnership, updateCompanySettings, companyActivity } from "@/server/team";
import { changeLifecycle, changePackage, createCompany, startSupportAccess, canTransition } from "@/server/companies";
import { localProvider } from "@/lib/auth/local";
import { adminCtx, identityFor, makeUser, PASSWORD, twoCompanies } from "../helpers";

let f: Awaited<ReturnType<typeof twoCompanies>>;
beforeAll(async () => { f = await twoCompanies(); });
afterAll(closeDb);

async function lastEmailTo(to: string) {
  const [m] = await withSystemDb("test", (tx) => tx.select().from(devOutbox).where(eq(devOutbox.toAddress, to)).orderBy(desc(devOutbox.createdAt)).limit(1));
  return m;
}
const tokenFrom = (text: string, path: string) => new RegExp(`${path}([A-Za-z0-9_-]+)`).exec(text)![1]!;
const ctx = (user: typeof f.harborOwner, companyId: string, action: Parameters<typeof resolveCompanyContext>[0]["action"] = "workspace.view") =>
  resolveCompanyContext({ user, identity: identityFor(user), requestedCompanyId: companyId, action });

describe("local sign-in (development/test identity provider)", () => {
  it("signs in with the right password and creates a revocable session", async () => {
    const u = await makeUser();
    const { result, token } = await local.localSignIn(u.email, PASSWORD);
    expect(result).toEqual({ ok: true, needsMfa: false });
    const id = await local.localLookupSession(token!);
    expect(id?.authUserId).toBe(u.authUserId);
    await local.localRevokeSession(token!);
    expect(await local.localLookupSession(token!)).toBeNull();
  });

  it("rejects wrong passwords and locks after 5 failures", async () => {
    const u = await makeUser();
    for (let i = 0; i < 4; i++) expect((await local.localSignIn(u.email, "wrong-password-123")).result).toEqual({ ok: false, reason: "invalid" });
    expect((await local.localSignIn(u.email, "wrong-password-123")).result).toEqual({ ok: false, reason: "locked" });
    expect((await local.localSignIn(u.email, PASSWORD)).result).toEqual({ ok: false, reason: "locked" });
  });

  it("does not reveal whether an email has an account", async () => {
    expect((await local.localSignIn("nobody@example.test", "whatever-password")).result).toEqual({ ok: false, reason: "invalid" });
  });

  it("MFA: enroll, require a code at sign-in, and refuse a replayed code", async () => {
    const u = await makeUser();
    const s1 = await local.localSignIn(u.email, PASSWORD);
    const id1 = (await local.localLookupSession(s1.token!))!;
    const { secret } = await local.localStartMfa(id1);
    const step = Math.floor(Date.now() / 30000);
    expect(await local.localConfirmMfa(id1, "000000")).toBe(false);
    expect(await local.localConfirmMfa(id1, totpAt(secret, step))).toBe(true);
    expect((await local.localLookupSession(s1.token!))!.aal).toBe(2);

    const s2 = await local.localSignIn(u.email, PASSWORD);
    expect(s2.result).toEqual({ ok: true, needsMfa: true });
    const id2 = (await local.localLookupSession(s2.token!))!;
    expect(id2.aal).toBe(1);
    expect(await local.localVerifyMfa(id2.sessionId, totpAt(secret, step))).toBe(false); // same step as enrollment: replay
    expect(await local.localVerifyMfa(id2.sessionId, totpAt(secret, step + 1))).toBe(true);
    expect((await local.localLookupSession(s2.token!))!.aal).toBe(2);
  });

  it("password reset: single-use link, ends existing sessions", async () => {
    const u = await makeUser();
    const s = await local.localSignIn(u.email, PASSWORD);
    await local.localRequestReset(u.email, "http://localhost:3100");
    const mail = await lastEmailTo(u.email);
    const token = tokenFrom(mail!.textBody, "reset-password\\?token=");
    expect(await local.localCompleteReset(token, "a-brand-new-password")).toBe(true);
    expect(await local.localCompleteReset(token, "another-new-password")).toBe(false);
    expect(await local.localLookupSession(s.token!)).toBeNull();
    expect((await local.localSignIn(u.email, "a-brand-new-password")).result.ok).toBe(true);
  });

  it("reset requests for unknown emails send nothing", async () => {
    await local.localRequestReset("ghost@example.test", "http://localhost:3100");
    expect(await lastEmailTo("ghost@example.test")).toBeUndefined();
  });
});

describe("invitations", () => {
  it("owner invites an employee who creates an account and joins only that company", async () => {
    const owner = await ctx(f.harborOwner, f.harbor.id, "team.invite");
    await inviteEmployee(owner, "New.Hire@Example.test", "http://localhost:3100");
    const mail = await lastEmailTo("new.hire@example.test");
    expect(mail?.subject).toContain("Harbor Home Services");
    const token = tokenFrom(mail!.textBody, "/invite/");
    const view = await viewInvitation(token);
    expect(view).toMatchObject({ state: "open", email: "new.hire@example.test", role: "employee", accountExists: false });

    const res = await acceptInvitation(token, { newAccount: { fullName: "New Hire", password: "a-strong-password" }, provider: localProvider });
    expect(res.companyId).toBe(f.harbor.id);
    expect((await viewInvitation(token)).state).toBe("used");
    await expect(acceptInvitation(token, { newAccount: { fullName: "Again", password: "a-strong-password" }, provider: localProvider })).rejects.toThrow(/no longer valid/);

    const signIn = await local.localSignIn("new.hire@example.test", "a-strong-password");
    expect(signIn.result.ok).toBe(true);
  });

  it("employees cannot invite; wrong-email identities cannot accept", async () => {
    const emp = await ctx(f.harborEmployee, f.harbor.id);
    await expect(inviteEmployee(emp, "x@example.test", "http://x")).rejects.toThrow(/owner/);

    const owner = await ctx(f.harborOwner, f.harbor.id, "team.invite");
    await inviteEmployee(owner, "intended@example.test", "http://localhost:3100");
    const token = tokenFrom((await lastEmailTo("intended@example.test"))!.textBody, "/invite/");
    await expect(acceptInvitation(token, { identity: identityFor(f.summitOwner) })).rejects.toThrow(/intended@example.test/);
  });

  it("revoked and re-sent invitations: only the newest link works", async () => {
    const owner = await ctx(f.harborOwner, f.harbor.id, "team.invite");
    await inviteEmployee(owner, "twice@example.test", "http://localhost:3100");
    const first = tokenFrom((await lastEmailTo("twice@example.test"))!.textBody, "/invite/");
    await new Promise((r) => setTimeout(r, 5));
    await inviteEmployee(owner, "twice@example.test", "http://localhost:3100");
    const second = tokenFrom((await lastEmailTo("twice@example.test"))!.textBody, "/invite/");
    expect((await viewInvitation(first)).state).toBe("used");
    expect((await viewInvitation(second)).state).toBe("open");
    const pending = await listPendingInvitations(owner);
    const inv = pending.find((p) => p.email === "twice@example.test")!;
    await revokeInvitation(owner, inv.id);
    expect((await viewInvitation(second)).state).toBe("used");
  });

  it("one company cannot revoke another company's invitation", async () => {
    const summitOwner = await ctx(f.summitOwner, f.summit.id, "team.invite");
    await inviteEmployee(summitOwner, "summit-hire@example.test", "http://localhost:3100");
    const inv = (await listPendingInvitations(summitOwner)).find((p) => p.email === "summit-hire@example.test")!;
    const harborOwner = await ctx(f.harborOwner, f.harbor.id, "team.invite");
    await expect(revokeInvitation(harborOwner, inv.id)).rejects.toThrow(/not found/);
  });

  it("unknown tokens reveal nothing", async () => {
    expect(await viewInvitation("not-a-real-token")).toEqual({ state: "invalid" });
  });

  it("administrator invites an owner; a second owner invitation is refused", async () => {
    const admin = adminCtx(await makeUser({ admin: true }));
    const company = await createCompany(admin, { name: "Coastal Plumbing", timezone: "America/Chicago", package: "instant_response" });
    await inviteOwner(admin, company.id, "owner@coastal.test", "http://localhost:3100");
    const token = tokenFrom((await lastEmailTo("owner@coastal.test"))!.textBody, "/invite/");
    await acceptInvitation(token, { newAccount: { fullName: "Casey Coastal", password: "a-strong-password" }, provider: localProvider });
    await expect(inviteOwner(admin, company.id, "another@coastal.test", "http://x")).rejects.toThrow(/already has an owner/);
  });
});

describe("team management", () => {
  it("removing an employee cuts their access immediately", async () => {
    const owner = await ctx(f.harborOwner, f.harbor.id, "team.remove");
    const temp = await makeUser();
    await withSystemDb("test", (tx) => tx.insert(memberships).values({ companyId: f.harbor.id, userId: temp.id, role: "employee" }));
    await ctx(temp, f.harbor.id);
    await removeMember(owner, temp.id);
    await expect(ctx(temp, f.harbor.id)).rejects.toBeInstanceOf(AuthzError);
  });

  it("ownership transfer requires confirmation and a recent sign-in; old owner becomes employee", async () => {
    const admin = adminCtx(await makeUser({ admin: true }));
    const company = await createCompany(admin, { name: "Transfer Test Co", timezone: "America/Denver", package: "instant_response" });
    const a = await makeUser();
    const b = await makeUser();
    await withSystemDb("test", (tx) => tx.insert(memberships).values([
      { companyId: company.id, userId: a.id, role: "owner" }, { companyId: company.id, userId: b.id, role: "employee" },
    ]));
    const owner = await ctx(a, company.id, "ownership.transfer");
    await expect(transferOwnership(owner, b.id, "wrong name", new Date())).rejects.toThrow(/company name/);
    await expect(transferOwnership(owner, b.id, "Transfer Test Co", new Date(Date.now() - 3600_000))).rejects.toThrow(/sign in again/);
    await transferOwnership(owner, b.id, "Transfer Test Co", new Date());
    expect((await ctx(b, company.id)).role).toBe("owner");
    expect((await ctx(a, company.id)).role).toBe("employee");
  });

  it("settings changes are validated and recorded in the activity log", async () => {
    const owner = await ctx(f.summitOwner, f.summit.id, "settings.manage");
    await expect(updateCompanySettings(owner, { name: "Summit Roofing", timezone: "Mars/Olympus" })).rejects.toThrow();
    await updateCompanySettings(owner, { name: "Summit Roofing", timezone: "America/Phoenix" });
    const log = await companyActivity(await ctx(f.summitOwner, f.summit.id, "audit.view"));
    expect(log.some((l) => l.action === "company.settings_updated")).toBe(true);
  });
});

describe("administrator lifecycle controls", () => {
  it("records package and lifecycle history, including reactivation", async () => {
    const admin = adminCtx(await makeUser({ admin: true }));
    const c = await createCompany(admin, { name: "Lifecycle Co", timezone: "America/New_York", package: "instant_response" });
    await changePackage(admin, c.id, "follow_up_booking", "Upgraded after pilot");
    await changeLifecycle(admin, c.id, "active");
    await expect(changeLifecycle(admin, c.id, "churned")).rejects.toThrow(/churn reason/);
    const churned = await changeLifecycle(admin, c.id, "churned", { reason: "Seasonal business closed" });
    expect(churned.serviceEndsAt).toBeTruthy();
    await expect(changeLifecycle(admin, c.id, "active")).rejects.toThrow(/can't move/);
    const re = await changeLifecycle(admin, c.id, "onboarding", { reason: "Returning customer" });
    expect(re.churnReason).toBeNull();
    const hist = await withSystemDb("test", (tx) => tx.select().from(lifecycleHistory).where(eq(lifecycleHistory.companyId, c.id)));
    expect(hist.map((h) => h.toStatus).sort()).toEqual(["active", "churned", "onboarding", "onboarding"]);
    expect(canTransition("archived", "active")).toBe(false);
  });

  it("support access requires a reason and is visible in the client's activity log", async () => {
    const adminUser = await makeUser({ admin: true });
    const admin = adminCtx(adminUser);
    await expect(startSupportAccess(admin, f.summit.id, { reason: "help", readOnly: true })).rejects.toThrow(/reason/);
    const g = await startSupportAccess(admin, f.summit.id, { reason: "Customer asked about missing lead", readOnly: true, minutes: 500 });
    expect(g.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60 * 60_000 + 1000); // capped at 60 minutes
    const log = await companyActivity(await ctx(f.summitOwner, f.summit.id, "audit.view"));
    expect(log.some((l) => l.action === "support.access_started" && l.actorType === "support")).toBe(true);
  });
});
