import { createHash } from "node:crypto";
import twilio from "twilio";
import { eq } from "drizzle-orm";
import { withSystemDb } from "@/lib/db/context";
import { companySenders } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { applyStatusUpdate } from "./send";
import { handleInbound, suppressEmail } from "./inbound";

/**
 * Provider webhooks — AWAITING LIVE VERIFICATION (no provider accounts yet).
 * Twilio: X-Twilio-Signature checked with Twilio's official library against the URL Twilio was given.
 * Postmark: no signatures exist; each company gets a secret webhook path (only its hash is stored).
 */
export async function senderByTwilioAccount(accountSid: string) {
  return withSystemDb("webhooks: find twilio sender", async (tx) => (await tx.select().from(companySenders).where(eq(companySenders.twilioAccountSid, accountSid)))[0] ?? null);
}

export function verifyTwilio(authToken: string, signature: string, path: string, params: Record<string, string>): boolean {
  return twilio.validateRequest(authToken, signature, `${env().APP_BASE_URL}${path}`, params);
}

export async function twilioInbound(params: Record<string, string>, signature: string): Promise<number> {
  const sender = params.AccountSid ? await senderByTwilioAccount(params.AccountSid) : null;
  if (!sender?.twilioAuthTokenEnc || !verifyTwilio(decrypt(sender.twilioAuthTokenEnc), signature, "/api/webhooks/twilio/inbound", params)) return 403;
  if (!params.From || !params.MessageSid) return 400;
  await handleInbound({ companyId: sender.companyId, channel: "sms", from: params.From, to: params.To, body: params.Body ?? "", transport: "twilio", providerMessageId: params.MessageSid });
  return 200;
}

const TWILIO_STATUS: Record<string, "submitted" | "delivered" | "failed" | undefined> = {
  sent: "submitted", delivered: "delivered", undelivered: "failed", failed: "failed",
};

export async function twilioStatus(params: Record<string, string>, signature: string): Promise<number> {
  const sender = params.AccountSid ? await senderByTwilioAccount(params.AccountSid) : null;
  if (!sender?.twilioAuthTokenEnc || !verifyTwilio(decrypt(sender.twilioAuthTokenEnc), signature, "/api/webhooks/twilio/status", params)) return 403;
  const mapped = TWILIO_STATUS[params.MessageStatus ?? ""];
  if (mapped && params.MessageSid) {
    await applyStatusUpdate({ transport: "twilio", providerMessageId: params.MessageSid, status: mapped, providerStatus: params.MessageStatus!, errorCode: params.ErrorCode ?? null });
  }
  return 200;
}

export function webhookKeyHash(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

interface PostmarkPayload {
  RecordType?: string; MessageID?: string; Email?: string; Type?: string; Description?: string; DeliveredAt?: string;
  From?: string; FromFull?: { Email?: string; Name?: string }; To?: string; Subject?: string; TextBody?: string; StrippedTextReply?: string;
}

export async function postmarkWebhook(key: string, p: PostmarkPayload): Promise<number> {
  if (!/^[A-Za-z0-9_-]{32,80}$/.test(key)) return 404;
  const sender = await withSystemDb("webhooks: find postmark sender", async (tx) => (await tx.select().from(companySenders).where(eq(companySenders.webhookKeyHash, webhookKeyHash(key))))[0] ?? null);
  if (!sender) return 404;
  switch (p.RecordType) {
    case "Inbound":
      if (!p.MessageID || !(p.FromFull?.Email ?? p.From)) return 400;
      await handleInbound({
        companyId: sender.companyId, channel: "email", from: p.FromFull?.Email ?? p.From!, fromName: p.FromFull?.Name ?? null, to: p.To ?? null,
        subject: p.Subject ?? null, body: (p.StrippedTextReply || p.TextBody || "").trim(), transport: "postmark", providerMessageId: p.MessageID,
      });
      return 200;
    case "Delivery":
      if (p.MessageID) await applyStatusUpdate({ transport: "postmark", providerMessageId: p.MessageID, status: "delivered", providerStatus: "Delivery", occurredAt: p.DeliveredAt ? new Date(p.DeliveredAt) : undefined });
      return 200;
    case "Bounce":
      if (p.MessageID) await applyStatusUpdate({ transport: "postmark", providerMessageId: p.MessageID, status: "failed", providerStatus: `Bounce:${p.Type ?? ""}`, errorCode: p.Type ?? null, reason: p.Description ?? null });
      if (p.Email && (p.Type === "HardBounce" || p.Type === "BadEmailAddress" || p.Type === "ManuallyDeactivated")) await suppressEmail(sender.companyId, p.Email, "hard_bounce", p.Type);
      return 200;
    case "SpamComplaint":
      if (p.Email) await suppressEmail(sender.companyId, p.Email, "spam_complaint");
      return 200;
    default:
      return 200; // unknown record types are acknowledged and ignored
  }
}
