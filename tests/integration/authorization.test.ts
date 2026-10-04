import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/lib/db/client";
import { resolveCompanyContext, resolveUser, AuthzError, listUserCompanies } from "@/lib/authz/resolve";
import type { Action } from "@/lib/authz/permissions";
import type { Feature } from "@/lib/authz/entitlements";
import { markSessionsRevoked } from "@/server/team";
import { addMember, grantSupport, identityFor, makeCompany, makeUser, setCompany, twoCompanies } from "../helpers";
import { withSystemDb } from "@/lib/db/context";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

let f: Awaited<ReturnType<typeof twoCompanies>>;
beforeAll(async () => { f = await twoCompanies(); });
afterAll(closeDb);

async function resolve(user: typeof f.harborOwner, companyId: string | null, action: Action, feature?: Feature, aal: 1 | 2 = 1) {
  return resolveCompanyContext({ user, identity: identityFor(user, aal), requestedCompanyId: companyId, action, feature });
}
async function failure(p: Promise<unknown>) {
  try { await p; return "ok"; } catch (e) { if (e instanceof AuthzError) return e.code; throw e; }
}

describe("membership is required — the browser's company choice is never trusted", () => {
  it("a member gets a verified context for their company", async () => {
    const ctx = await resolve(f.harborOwner, f.harbor.id, "lead.view", "leads");
    expect(ctx).toMatchObject({ companyId: f.harbor.id, role: "owner", package: "follow_up_booking" });
  });

  it("requesting another company's id is refused", async () => {
    expect(await failure(resolve(f.harborOwner, f.summit.id, "lead.view"))).toBe("forbidden");
    expect(await failure(resolve(f.summitOwner, f.harbor.id, "workspace.view"))).toBe("forbidden");
  });

  it("with no choice, the user's own company is used; a user with none gets no_company", async () => {
    const ctx = await resolve(f.harborEmployee, null, "workspace.view");
    expect(ctx.companyId).toBe(f.harbor.id);
    const loner = await makeUser();
    expect(await failure(resolve(loner, null, "workspace.view"))).toBe("no_company");
  });

  it("lists only the companies a person belongs to", async () => {
    const list = await listUserCompanies(f.harborOwner.id);
    expect(list.map((c) => c.id)).toEqual([f.harbor.id]);
  });
});

describe("roles", () => {
  it("employees can work leads but cannot invite, export, manage integrations or see billing", async () => {
    expect(await failure(resolve(f.harborEmployee, f.harbor.id, "lead.edit"))).toBe("ok");
    for (const a of ["team.invite", "lead.export", "integration.manage", "billing.view", "ownership.transfer", "data.export_all"] as Action[]) {
      expect(await failure(resolve(f.harborEmployee, f.harbor.id, a)), a).toBe("forbidden");
    }
  });
  it("owners can manage the team", async () => {
    expect(await failure(resolve(f.harborOwner, f.harbor.id, "team.invite"))).toBe("ok");
  });
});

describe("package entitlements are enforced on the server", () => {
  it("Package 1 cannot use sequences, booking or ad reporting; it can receive ad lead-form leads", async () => {
    expect(await failure(resolve(f.summitOwner, f.summit.id, "sequence.view", "sequences"))).toBe("not_entitled");
    expect(await failure(resolve(f.summitOwner, f.summit.id, "appointment.view", "booking"))).toBe("not_entitled");
    expect(await failure(resolve(f.summitOwner, f.summit.id, "report.view", "ad_reporting"))).toBe("not_entitled");
    expect(await failure(resolve(f.summitOwner, f.summit.id, "lead.view", "ad_lead_forms"))).toBe("ok");
  });
  it("Package 2 gets sequences but not ad reporting", async () => {
    expect(await failure(resolve(f.harborOwner, f.harbor.id, "sequence.view", "sequences"))).toBe("ok");
    expect(await failure(resolve(f.harborOwner, f.harbor.id, "report.view", "ad_reporting"))).toBe("not_entitled");
  });
});

describe("account status", () => {
  it("churned: read-only access for exports; changes refused", async () => {
    const c = await makeCompany({ lifecycleStatus: "churned" });
    const o = await makeUser();
    await addMember(c.id, o.id, "owner");
    expect(await failure(resolve(o, c.id, "lead.view"))).toBe("ok");
    expect(await failure(resolve(o, c.id, "data.export_all"))).toBe("ok");
    expect(await failure(resolve(o, c.id, "lead.edit"))).toBe("read_only");
  });
  it("archived: no client access", async () => {
    const c = await makeCompany({ lifecycleStatus: "archived" });
    const o = await makeUser();
    await addMember(c.id, o.id, "owner");
    expect(await failure(resolve(o, c.id, "workspace.view"))).toBe("account_restricted");
  });
  it("technical suspension makes an active account read-only", async () => {
    const c = await makeCompany({ lifecycleStatus: "active", suspended: true });
    const o = await makeUser();
    await addMember(c.id, o.id, "owner");
    expect(await failure(resolve(o, c.id, "lead.view"))).toBe("ok");
    expect(await failure(resolve(o, c.id, "settings.manage"))).toBe("read_only");
  });
  it("an expired demo workspace is closed", async () => {
    const c = await makeCompany({ kind: "demo_prospect", demoExpiresAt: new Date(Date.now() - 1000) });
    const o = await makeUser();
    await addMember(c.id, o.id, "owner");
    expect(await failure(resolve(o, c.id, "workspace.view"))).toBe("account_restricted");
  });
});

describe("platform administrators and support access", () => {
  it("an administrator has NO access to a client workspace without a support grant", async () => {
    const admin = await makeUser({ admin: true });
    expect(await failure(resolve(admin, f.summit.id, "lead.view", undefined, 2))).toBe("forbidden");
  });
  it("a live grant gives read-only support access, only with MFA, and never exports or invitations", async () => {
    const admin = await makeUser({ admin: true });
    await grantSupport(f.summit.id, admin.id, { readOnly: true });
    expect(await failure(resolve(admin, f.summit.id, "lead.view", undefined, 1))).toBe("forbidden"); // no MFA
    const ctx = await resolve(admin, f.summit.id, "lead.view", undefined, 2);
    expect(ctx.role).toBe("support_read");
    expect(ctx.supportGrantId).toBeTruthy();
    expect(await failure(resolve(admin, f.summit.id, "lead.edit", undefined, 2))).toBe("forbidden");
    expect(await failure(resolve(admin, f.summit.id, "lead.export", undefined, 2))).toBe("forbidden");
    expect(await failure(resolve(admin, f.harbor.id, "lead.view", undefined, 2))).toBe("forbidden"); // other company
  });
  it("expired or ended grants give nothing", async () => {
    const admin = await makeUser({ admin: true });
    await grantSupport(f.summit.id, admin.id, { minutes: -1 });
    await grantSupport(f.harbor.id, admin.id, { ended: true });
    expect(await failure(resolve(admin, f.summit.id, "lead.view", undefined, 2))).toBe("forbidden");
    expect(await failure(resolve(admin, f.harbor.id, "lead.view", undefined, 2))).toBe("forbidden");
  });
  it("a non-administrator cannot use a support grant", async () => {
    const someone = await makeUser();
    await grantSupport(f.summit.id, someone.id);
    expect(await failure(resolve(someone, f.summit.id, "lead.view", undefined, 2))).toBe("forbidden");
  });
});

describe("two-step verification", () => {
  it("an account with MFA has no workspace access until the code is verified", async () => {
    const identity = { ...identityFor(f.harborOwner, 1), mfaEnrolled: true };
    expect(await failure(resolveCompanyContext({ user: f.harborOwner, identity, requestedCompanyId: f.harbor.id, action: "workspace.view" }))).toBe("unauthenticated");
    expect(await failure(resolveCompanyContext({ user: f.harborOwner, identity: { ...identity, aal: 2 }, requestedCompanyId: f.harbor.id, action: "workspace.view" }))).toBe("ok");
  });
});

describe("user status and session revocation", () => {
  it("'sign out everywhere' rejects sign-ins from before the revocation", async () => {
    const u = await makeUser();
    const oldSignIn = identityFor(u, 1, new Date(Date.now() - 60_000));
    expect(await resolveUser(oldSignIn)).not.toBeNull();
    await markSessionsRevoked(u.id);
    expect(await resolveUser(oldSignIn)).toBeNull();
    expect(await resolveUser(identityFor(u, 1, new Date(Date.now() + 1000)))).not.toBeNull();
  });
  it("disabled users are rejected", async () => {
    const u = await makeUser();
    await withSystemDb("test", (tx) => tx.update(users).set({ status: "disabled" }).where(eq(users.id, u.id)));
    expect(await resolveUser(identityFor(u))).toBeNull();
  });
  it("an identity with no Bluewater user is rejected", async () => {
    expect(await resolveUser({ authUserId: "nobody", email: "x@y.z", aal: 2, sessionId: "s", authenticatedAt: new Date(), mfaEnrolled: false })).toBeNull();
  });
});

describe("company status changes apply immediately", () => {
  it("archiving a company cuts access on the next request", async () => {
    const c = await makeCompany();
    const o = await makeUser();
    await addMember(c.id, o.id, "owner");
    expect(await failure(resolve(o, c.id, "workspace.view"))).toBe("ok");
    await setCompany(c.id, { lifecycleStatus: "archived" });
    expect(await failure(resolve(o, c.id, "workspace.view"))).toBe("account_restricted");
  });
});
