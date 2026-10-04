/**
 * Creates (or promotes) a Bluewater platform administrator.
 *
 * Local development:
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a long passphrase' npm run admin:create
 * Hosted (Supabase): first create the user in Supabase → Authentication → Users,
 *   then run with ADMIN_EMAIL and ADMIN_AUTH_USER_ID=<the Supabase user id>.
 *
 * This is deliberately a command-line step, not a web page: there is no way to become
 * an administrator through the website.
 */
import "./load-env";
import { eq, sql } from "drizzle-orm";
import { withSystemDb } from "../src/lib/db/context";
import { closeDb } from "../src/lib/db/client";
import { users } from "../src/lib/db/schema";
import { localCreateUser } from "../src/lib/auth/local-core";

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error("Set ADMIN_EMAIL");
  let authUserId = process.env.ADMIN_AUTH_USER_ID;
  if (!authUserId) {
    if (process.env.AUTH_PROVIDER !== "local") throw new Error("For Supabase, create the user in the Supabase dashboard and pass ADMIN_AUTH_USER_ID");
    const pw = process.env.ADMIN_PASSWORD;
    if (!pw || pw.length < 12) throw new Error("Set ADMIN_PASSWORD (12+ characters)");
    authUserId = await localCreateUser(email, pw);
  }
  await withSystemDb("create platform admin", async (tx) => {
    const [existing] = await tx.select().from(users).where(sql`lower(${users.email}) = ${email}`);
    if (existing) {
      await tx.update(users).set({ isPlatformAdmin: true, authUserId }).where(eq(users.id, existing.id));
    } else {
      await tx.insert(users).values({ email, authUserId: authUserId!, fullName: process.env.ADMIN_NAME ?? "Bluewater Admin", isPlatformAdmin: true });
    }
  });
  console.log(`Administrator ready: ${email}. Two-step verification is required at first sign-in.`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(closeDb);
