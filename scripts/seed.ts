/**
 * LOCAL DEVELOPMENT ONLY: fictional sample companies and users for trying the app.
 * Refuses to run unless APP_ENV is development and AUTH_PROVIDER is local.
 *
 *   npm run db:seed
 *
 * Sign in with any of the emails below and the password DEV_PASSWORD.
 * (The sales demo has its own, richer dataset — see docs/DEMO.md.)
 */
import "./load-env";
import { sql } from "drizzle-orm";
import { withSystemDb } from "../src/lib/db/context";
import { closeDb } from "../src/lib/db/client";
import { companies, lifecycleHistory, memberships, packageHistory, users } from "../src/lib/db/schema";
import { localCreateUser } from "../src/lib/auth/local-core";
import { generateDemoDataset } from "../src/server/demo/dataset";

export const DEV_PASSWORD = "bluewater-dev-password";

const COMPANIES = [
  { name: "Harbor Home Services", slug: "harbor-home-services", package: "follow_up_booking", timezone: "America/New_York", lifecycleStatus: "active",
    people: [["owner", "jordan@harbor.test", "Jordan Lee"], ["employee", "alex@harbor.test", "Alex Rivera"], ["employee", "sam@harbor.test", "Sam Patel"]] },
  { name: "Summit Roofing", slug: "summit-roofing", package: "instant_response", timezone: "America/Denver", lifecycleStatus: "onboarding",
    people: [["owner", "taylor@summit.test", "Taylor Reed"]] },
  { name: "Bayside Dental", slug: "bayside-dental", package: "performance_reporting", timezone: "America/Los_Angeles", lifecycleStatus: "active",
    people: [["owner", "morgan@bayside.test", "Morgan Diaz"]] },
] as const;

async function main() {
  if (!["development", "test"].includes(process.env.APP_ENV ?? "") || process.env.AUTH_PROVIDER !== "local") {
    throw new Error("Refusing to seed: this script only runs with APP_ENV=development or test and AUTH_PROVIDER=local.");
  }
  const adminAuth = await ensureIdentity("admin@bluewater.test");
  await withSystemDb("dev seed", async (tx) => {
    await tx.insert(users).values({ authUserId: adminAuth, email: "admin@bluewater.test", fullName: "Bluewater Admin", isPlatformAdmin: true }).onConflictDoNothing();
  });

  for (const c of COMPANIES) {
    const ids: { role: "owner" | "employee"; auth: string; email: string; name: string }[] = [];
    for (const [role, email, name] of c.people) ids.push({ role, auth: await ensureIdentity(email), email, name });
    await withSystemDb("dev seed", async (tx) => {
      const [existing] = await tx.select().from(companies).where(sql`${companies.slug} = ${c.slug}`);
      if (existing) return;
      const [co] = await tx.insert(companies).values({
        name: c.name, slug: c.slug, package: c.package, timezone: c.timezone, lifecycleStatus: c.lifecycleStatus,
        kind: "internal_test", crmMode: "built_in", serviceStartDate: c.lifecycleStatus === "active" ? new Date() : null,
      }).returning();
      await tx.insert(packageHistory).values({ companyId: co!.id, toPackage: c.package, note: "Development seed" });
      await tx.insert(lifecycleHistory).values({ companyId: co!.id, toStatus: c.lifecycleStatus, reason: "Development seed" });
      const memberIds: string[] = [];
      for (const p of ids) {
        const [u] = await tx.insert(users).values({ authUserId: p.auth, email: p.email, fullName: p.name }).onConflictDoNothing().returning();
        if (u) { await tx.insert(memberships).values({ companyId: co!.id, userId: u.id, role: p.role }); memberIds.push(u.id); }
      }
      // Fictional sample leads for companies that are "active" (Summit stays empty to show onboarding).
      if (c.lifecycleStatus === "active") {
        await tx.execute(sql`select set_config('app.company_id', ${co!.id}, true)`);
        await generateDemoDataset(tx, { companyId: co!.id, memberIds, seed: c.slug.length * 7919 });
      }
    });
  }
  console.log(`Seeded. Password for every sample account: ${DEV_PASSWORD}`);
  console.log("Administrator: admin@bluewater.test (you'll be asked to set up two-step verification).");
  console.log("Owners: jordan@harbor.test (Package 2), taylor@summit.test (Package 1), morgan@bayside.test (Package 3). Employee: alex@harbor.test");
}

async function ensureIdentity(email: string): Promise<string> {
  const existing = await withSystemDb("dev seed", (tx) => tx.execute(sql`select auth_user_id from app.local_credentials where lower(email) = ${email}`));
  if (existing[0]) return String(existing[0].auth_user_id);
  return localCreateUser(email, DEV_PASSWORD);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(closeDb);
