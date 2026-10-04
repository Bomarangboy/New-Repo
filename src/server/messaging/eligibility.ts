import { and, desc, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { consentRecords, suppressions } from "@/lib/db/schema";

/** Latest recorded answer for this channel's inquiry-response permission: true, false, or null (never asked). */
export async function latestConsent(tx: Tx, companyId: string, contactId: string, channel: "sms" | "email"): Promise<boolean | null> {
  const [c] = await tx.select({ granted: consentRecords.granted }).from(consentRecords)
    .where(and(eq(consentRecords.companyId, companyId), eq(consentRecords.contactId, contactId), eq(consentRecords.channel, channel), eq(consentRecords.purpose, "inquiry_response")))
    .orderBy(desc(consentRecords.capturedAt), desc(consentRecords.createdAt)).limit(1);
  return c ? c.granted : null;
}

export async function activeSuppression(tx: Tx, companyId: string, channel: "sms" | "email", address: string) {
  const [s] = await tx.select().from(suppressions)
    .where(and(eq(suppressions.companyId, companyId), eq(suppressions.channel, channel), eq(suppressions.address, address.toLowerCase()), isNull(suppressions.liftedAt)));
  return s ?? null;
}

export function normalizeAddress(channel: "sms" | "email", raw: string): string {
  return channel === "email" ? raw.trim().toLowerCase() : raw.trim();
}
