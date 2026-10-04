import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { withSystemCompanyDb, withSystemDb } from "@/lib/db/context";
import { companies, messages, suppressions } from "@/lib/db/schema";
import { env } from "@/lib/env";

/** Unsubscribe links in client emails: /u/<messageId>.<signature>. Signed, so they can't be forged or enumerated. */
function sign(messageId: string): string {
  const key = Buffer.from(env().ENCRYPTION_KEY, "base64");
  return createHmac("sha256", Buffer.concat([key, Buffer.from("unsubscribe")])).update(messageId).digest("base64url").slice(0, 32);
}

export function unsubscribeUrl(messageId: string): string {
  return `${env().APP_BASE_URL}/u/${messageId}.${sign(messageId)}`;
}

export function emailFooter(messageId: string, companyName: string): string {
  return `\n\n—\nTo stop receiving emails from ${companyName}: ${unsubscribeUrl(messageId)}`;
}

function parse(token: string): string | null {
  const [id, sig] = token.split(".");
  if (!id || !sig || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const expected = Buffer.from(sign(id)), given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

export async function describeUnsubscribe(token: string): Promise<{ companyName: string; email: string; companyId: string } | null> {
  const id = parse(token);
  if (!id) return null;
  return withSystemDb("unsubscribe: look up", async (tx) => {
    const [m] = await tx.select({ email: messages.toAddress, companyId: messages.companyId, channel: messages.channel, companyName: companies.name })
      .from(messages).innerJoin(companies, eq(companies.id, messages.companyId)).where(eq(messages.id, id));
    return m && m.channel === "email" ? { companyName: m.companyName, email: m.email, companyId: m.companyId } : null;
  });
}

export async function confirmUnsubscribe(token: string): Promise<boolean> {
  const info = await describeUnsubscribe(token);
  if (!info) return false;
  await withSystemCompanyDb(info.companyId, "unsubscribe: record", (tx) =>
    tx.insert(suppressions).values({ companyId: info.companyId, channel: "email", address: info.email.toLowerCase(), reason: "unsubscribe_link" }).onConflictDoNothing());
  return true;
}
