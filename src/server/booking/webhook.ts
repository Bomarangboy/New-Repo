import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { withSystemCompanyDb, withSystemDb } from "@/lib/db/context";
import { bookingSettings } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { webhookKeyHash } from "@/server/messaging/webhooks";
import { applyBookingEvent, type BookingEventInput } from "./events";

/**
 * Cal.com webhooks — AWAITING LIVE VERIFICATION (no Cal.com account connected yet).
 * Cal.com signs the exact request body with HMAC-SHA256 using the webhook's secret and sends the hex
 * digest in `X-Cal-Signature-256` (Cal.com source: packages/features/webhooks/lib/sendPayload.ts).
 * The address contains a per-company secret path; we look the company up by its hash, then verify the
 * signature with that company's secret before trusting anything in the body.
 */
export function calSignature(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyCalSignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const given = header.trim().replace(/^sha256=/i, "");
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;
  const a = Buffer.from(calSignature(secret, rawBody), "hex");
  const b = Buffer.from(given, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

const str = (v: unknown): string | null => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "value" in v) return str((v as { value: unknown }).value);
  return null;
};

/** Turns a Cal.com webhook body into our booking event (pure; unit-tested). */
export function parseCalcomBody(rawBody: string): BookingEventInput | null {
  let body: { triggerEvent?: unknown; createdAt?: unknown; payload?: Record<string, unknown> };
  try { body = JSON.parse(rawBody); } catch { return null; }
  if (!body || typeof body !== "object" || typeof body.triggerEvent !== "string") return null;
  const p = (body.payload ?? {}) as Record<string, unknown>;
  const attendees = Array.isArray(p.attendees) ? (p.attendees as Record<string, unknown>[]) : [];
  const a = attendees[0] ?? {};
  const responses = (p.responses ?? {}) as Record<string, unknown>;
  const metadata = (p.metadata ?? {}) as Record<string, unknown>;
  const created = typeof body.createdAt === "string" ? new Date(body.createdAt) : null;
  return {
    provider: "calcom",
    trigger: body.triggerEvent,
    uid: str(p.uid),
    rescheduleUid: str(p.rescheduleUid),
    startTime: str(p.startTime),
    endTime: str(p.endTime),
    title: str(p.title),
    location: str(p.location),
    attendee: {
      name: str(a.name) ?? str(responses.name),
      email: str(a.email) ?? str(responses.email),
      phone: str(a.phoneNumber) ?? str(responses.attendeePhoneNumber) ?? str(responses.phone) ?? str(p.smsReminderNumber),
      timeZone: str(a.timeZone),
    },
    ref: str(metadata.bw),
    cancellationReason: str(p.cancellationReason),
    eventCreatedAt: created && !Number.isNaN(created.getTime()) ? created : null,
    bodyHash: createHash("sha256").update(rawBody).digest("hex"),
  };
}

export async function calcomWebhook(key: string, rawBody: string, signature: string | null): Promise<number> {
  if (!/^[A-Za-z0-9_-]{24,80}$/.test(key)) return 404;
  const settings = await withSystemDb("webhooks: find booking connection", async (tx) =>
    (await tx.select().from(bookingSettings).where(eq(bookingSettings.webhookKeyHash, webhookKeyHash(key))))[0] ?? null);
  if (!settings?.webhookSecretEnc) return 404;
  if (!verifyCalSignature(decrypt(settings.webhookSecretEnc), rawBody, signature)) {
    await withSystemCompanyDb(settings.companyId, "booking: record bad signature", (tx) =>
      tx.update(bookingSettings).set({ lastError: "A message arrived with a wrong signature. Check the secret in Cal.com matches the one Bluewater gave you.", lastErrorAt: new Date() })
        .where(eq(bookingSettings.companyId, settings.companyId)));
    return 401;
  }
  const event = parseCalcomBody(rawBody);
  if (!event) return 400;
  await applyBookingEvent(settings.companyId, event);
  return 200;
}
