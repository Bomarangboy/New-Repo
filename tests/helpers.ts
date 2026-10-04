import { eq } from "drizzle-orm";
import { withSystemDb } from "@/lib/db/context";
import { companies, memberships, supportAccessGrants, users } from "@/lib/db/schema";
import { localCreateUser } from "@/lib/auth/local-core";
import type { Identity } from "@/lib/auth/types";
import type { PlatformContext } from "@/lib/authz/context-types";

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export const PASSWORD = "correct-horse-battery-staple";

export async function makeUser(opts: { email?: string; admin?: boolean; fullName?: string } = {}) {
  const email = opts.email ?? `user-${uniq()}@example.test`;
  const authUserId = await localCreateUser(email, PASSWORD);
  const [u] = await withSystemDb("test fixture", (tx) =>
    tx.insert(users).values({ authUserId, email, fullName: opts.fullName ?? email.split("@")[0]!, isPlatformAdmin: Boolean(opts.admin) }).returning(),
  );
  return u!;
}

export async function makeCompany(opts: Partial<typeof companies.$inferInsert> = {}) {
  const [c] = await withSystemDb("test fixture", (tx) =>
    tx.insert(companies).values({ name: `Company ${uniq()}`, slug: `co-${uniq()}`, lifecycleStatus: "active", ...opts }).returning(),
  );
  return c!;
}

export async function addMember(companyId: string, userId: string, role: "owner" | "employee") {
  await withSystemDb("test fixture", (tx) => tx.insert(memberships).values({ companyId, userId, role }));
}

export function identityFor(u: { authUserId: string; email: string }, aal: 1 | 2 = 1, authenticatedAt = new Date()): Identity {
  return { authUserId: u.authUserId, email: u.email, aal, sessionId: crypto.randomUUID(), authenticatedAt, mfaEnrolled: false };
}

export function adminCtx(u: { id: string }): PlatformContext {
  return { userId: u.id, isPlatformAdmin: true, mfaVerified: true };
}

/** Two fully separate sample companies, each with an owner and an employee. */
export async function twoCompanies() {
  const harbor = await makeCompany({ name: "Harbor Home Services", package: "follow_up_booking" });
  const summit = await makeCompany({ name: "Summit Roofing", package: "instant_response" });
  const harborOwner = await makeUser({ fullName: "Hannah Harbor" });
  const harborEmployee = await makeUser({ fullName: "Alex Harbor" });
  const summitOwner = await makeUser({ fullName: "Sam Summit" });
  await addMember(harbor.id, harborOwner.id, "owner");
  await addMember(harbor.id, harborEmployee.id, "employee");
  await addMember(summit.id, summitOwner.id, "owner");
  return { harbor, summit, harborOwner, harborEmployee, summitOwner };
}

export async function grantSupport(companyId: string, adminUserId: string, opts: { readOnly?: boolean; minutes?: number; ended?: boolean } = {}) {
  await withSystemDb("test fixture", (tx) =>
    tx.insert(supportAccessGrants).values({
      companyId, adminUserId, reason: "Investigating a reported issue",
      readOnly: opts.readOnly ?? true,
      expiresAt: new Date(Date.now() + (opts.minutes ?? 30) * 60_000),
      endedAt: opts.ended ? new Date() : null,
    }),
  );
}

export async function setCompany(id: string, patch: Partial<typeof companies.$inferInsert>) {
  await withSystemDb("test fixture", (tx) => tx.update(companies).set(patch).where(eq(companies.id, id)));
}

/** Asserts a promise fails with a database error whose underlying message matches. */
export async function expectDbError(p: Promise<unknown>, re: RegExp) {
  try {
    await p;
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string } };
    const text = `${err.message ?? ""} ${err.cause?.message ?? ""}`;
    if (!re.test(text)) throw new Error(`Expected error matching ${re}, got: ${text}`);
    return;
  }
  throw new Error(`Expected failure matching ${re}, but it succeeded`);
}
