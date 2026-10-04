import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb, setContext } from "@/lib/db/client";
import { withCompanyDb } from "@/lib/db/context";
import { auditLog, companies, invitations, memberships, users } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import type { CompanyContext } from "@/lib/authz/context-types";
import { accountPolicy } from "@/lib/authz/account-policy";
import { expectDbError, twoCompanies } from "../helpers";

/**
 * Database-level isolation: even if application code forgot a filter, Row Level
 * Security must keep each company's data invisible and unwritable to others.
 */

let f: Awaited<ReturnType<typeof twoCompanies>>;
const ctxFor = (companyId: string, userId: string, pkg = "follow_up_booking" as const): CompanyContext => ({
  userId, companyId, companyName: "x", companyKind: "customer", timezone: "America/New_York", role: "owner", package: pkg,
  policy: accountPolicy({ lifecycleStatus: "active", suspended: false, kind: "customer" }), supportGrantId: null,
});

beforeAll(async () => {
  f = await twoCompanies();
  await withCompanyDb(ctxFor(f.summit.id, f.summitOwner.id), async (tx) => {
    await tx.insert(invitations).values({ companyId: f.summit.id, email: "secret@summit.test", role: "employee", tokenHash: `h-${Date.now()}`, expiresAt: new Date(Date.now() + 86400_000) });
    await audit(tx, { companyId: f.summit.id, actorUserId: f.summitOwner.id, actorType: "user", action: "test.summit_private" });
  });
});
afterAll(closeDb);

describe("database roles", () => {
  it("the application role cannot bypass row level security", async () => {
    const rows = await getDb().execute(sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`);
    expect(rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
  });

  it("every table in the app schema has row level security enabled and forced", async () => {
    const rows = await getDb().execute(sql`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app' and c.relkind = 'r'`);
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) expect(r, String(r.relname)).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });
});

describe("no context = no data", () => {
  it("queries without a company context see nothing", async () => {
    const db = getDb();
    expect(await db.select().from(companies)).toHaveLength(0);
    expect(await db.select().from(memberships)).toHaveLength(0);
    expect(await db.select().from(invitations)).toHaveLength(0);
    expect(await db.select().from(auditLog)).toHaveLength(0);
    expect(await db.select().from(users)).toHaveLength(0);
  });
});

describe("company A cannot reach company B", () => {
  it("cannot read B's company, members, invitations or activity", async () => {
    await withCompanyDb(ctxFor(f.harbor.id, f.harborOwner.id), async (tx) => {
      expect(await tx.select().from(companies).where(eq(companies.id, f.summit.id))).toHaveLength(0);
      expect(await tx.select().from(memberships).where(eq(memberships.companyId, f.summit.id))).toHaveLength(0);
      expect(await tx.select().from(invitations)).toHaveLength(0);
      const acts = await tx.select().from(auditLog);
      expect(acts.every((a) => a.companyId === f.harbor.id)).toBe(true);
      expect(await tx.select().from(users).where(eq(users.id, f.summitOwner.id))).toHaveLength(0);
    });
  });

  it("cannot insert rows into B, even by naming B's id", async () => {
    await expectDbError(withCompanyDb(ctxFor(f.harbor.id, f.harborOwner.id), (tx) =>
      tx.insert(invitations).values({ companyId: f.summit.id, email: "x@x.test", role: "employee", tokenHash: `x-${Date.now()}`, expiresAt: new Date() }),
    ), /row-level security/);
    await expectDbError(withCompanyDb(ctxFor(f.harbor.id, f.harborOwner.id), (tx) =>
      tx.insert(memberships).values({ companyId: f.summit.id, userId: f.harborOwner.id, role: "employee" }),
    ), /row-level security/);
  });

  it("cannot update or delete B's rows (they are invisible, so nothing changes)", async () => {
    await withCompanyDb(ctxFor(f.harbor.id, f.harborOwner.id), async (tx) => {
      const upd = await tx.update(companies).set({ name: "hijacked" }).where(eq(companies.id, f.summit.id)).returning();
      expect(upd).toHaveLength(0);
      const del = await tx.delete(memberships).where(eq(memberships.companyId, f.summit.id)).returning();
      expect(del).toHaveLength(0);
    });
    await withCompanyDb(ctxFor(f.summit.id, f.summitOwner.id), async (tx) => {
      const [s] = await tx.select().from(companies).where(eq(companies.id, f.summit.id));
      expect(s!.name).toBe("Summit Roofing");
    });
  });

  it("cannot move its own row into another company", async () => {
    await expectDbError(withCompanyDb(ctxFor(f.harbor.id, f.harborOwner.id), (tx) =>
      tx.update(memberships).set({ companyId: f.summit.id }).where(eq(memberships.userId, f.harborEmployee.id)),
    ), /row-level security/);
  });
});

describe("restricted fields and append-only history", () => {
  it("a client workspace cannot change its own package, status or suspension", async () => {
    await expectDbError(withCompanyDb(ctxFor(f.harbor.id, f.harborOwner.id), (tx) =>
      tx.update(companies).set({ package: "performance_reporting" }).where(eq(companies.id, f.harbor.id)),
    ), /platform administrator/);
    await expectDbError(withCompanyDb(ctxFor(f.harbor.id, f.harborOwner.id), (tx) =>
      tx.update(companies).set({ suspended: true }).where(eq(companies.id, f.harbor.id)),
    ), /platform administrator/);
    // Re-saving unchanged values (e.g. a settings form) is allowed.
    await expect(withCompanyDb(ctxFor(f.harbor.id, f.harborOwner.id), (tx) =>
      tx.update(companies).set({ suspended: false, lifecycleStatus: "active", name: "Harbor Home Services" }).where(eq(companies.id, f.harbor.id)),
    )).resolves.toBeDefined();
  });

  it("a user cannot make themself a platform administrator", async () => {
    await expectDbError(getDb().transaction(async (tx) => {
      await setContext(tx, { userId: f.harborOwner.id });
      await tx.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, f.harborOwner.id));
    }), /restricted user fields/);
  });

  it("activity log entries cannot be edited or deleted", async () => {
    await expectDbError(withCompanyDb(ctxFor(f.summit.id, f.summitOwner.id), (tx) => tx.update(auditLog).set({ action: "tampered" })), /permission denied/);
    await expectDbError(withCompanyDb(ctxFor(f.summit.id, f.summitOwner.id), (tx) => tx.delete(auditLog)), /permission denied/);
  });

  it("context set in one transaction does not leak into the next", async () => {
    await withCompanyDb(ctxFor(f.summit.id, f.summitOwner.id), async (tx) => {
      expect((await tx.select().from(companies)).length).toBe(1);
    });
    expect(await getDb().select().from(companies)).toHaveLength(0);
  });
});
