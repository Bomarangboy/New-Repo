import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withPlatformDb } from "@/lib/db/context";
import { companySenders } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { encrypt, newToken } from "@/lib/crypto";
import { UserError } from "@/lib/errors";
import { env } from "@/lib/env";
import type { PlatformContext } from "@/lib/authz/context-types";
import { webhookKeyHash } from "@/server/messaging/webhooks";

/**
 * Bluewater-managed sender identities (D-06). Only platform administrators configure them.
 * Secrets are write-only: stored encrypted and never shown again. Marking a sender "verified"
 * is a deliberate step after the provider registration (A2P 10DLC / domain DNS) is approved.
 */
export const SENDER_STATUSES = ["not_configured", "pending_verification", "verified", "disabled"] as const;

const sms = z.object({
  status: z.enum(SENDER_STATUSES),
  twilioAccountSid: z.string().trim().regex(/^AC[0-9a-fA-F]{32}$/, "Twilio account SIDs start with AC followed by 32 characters.").or(z.literal("")),
  twilioAuthToken: z.string().trim().max(200).optional(),
  messagingServiceSid: z.string().trim().regex(/^MG[0-9a-fA-F]{32}$/, "Messaging Service SIDs start with MG.").or(z.literal("")),
  fromNumber: z.string().trim().regex(/^\+1\d{10}$/, "Use the +1XXXXXXXXXX format.").or(z.literal("")),
  notes: z.string().trim().max(500).optional(),
});
const email = z.object({
  status: z.enum(SENDER_STATUSES),
  postmarkServerToken: z.string().trim().max(200).optional(),
  fromEmail: z.email().or(z.literal("")),
  fromName: z.string().trim().max(100).optional(),
  replyTo: z.email().or(z.literal("")).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function getSenders(ctx: PlatformContext, companyId: string) {
  return withPlatformDb(ctx, async (tx) => {
    const rows = await tx.select().from(companySenders).where(eq(companySenders.companyId, companyId));
    // Never return secrets — only whether they're set.
    return rows.map(({ twilioAuthTokenEnc, postmarkServerTokenEnc, webhookKeyHash: wk, ...rest }) => ({
      ...rest, hasTwilioToken: Boolean(twilioAuthTokenEnc), hasPostmarkToken: Boolean(postmarkServerTokenEnc), hasWebhookKey: Boolean(wk),
    }));
  });
}

export async function saveSmsSender(ctx: PlatformContext, companyId: string, input: z.input<typeof sms>, requestId?: string) {
  const v = sms.parse(input);
  if (v.status === "verified" && (!v.twilioAccountSid || !(v.messagingServiceSid || v.fromNumber))) throw new UserError("A verified text sender needs the account SID and a Messaging Service SID or number.");
  return withPlatformDb(ctx, async (tx) => {
    const [cur] = await tx.select().from(companySenders).where(and(eq(companySenders.companyId, companyId), eq(companySenders.channel, "sms")));
    if (v.status === "verified" && !v.twilioAuthToken && !cur?.twilioAuthTokenEnc) throw new UserError("Enter the Twilio auth token before marking the sender verified.");
    const values = {
      status: v.status, twilioAccountSid: v.twilioAccountSid || null, messagingServiceSid: v.messagingServiceSid || null, fromNumber: v.fromNumber || null,
      notes: v.notes || null, verifiedAt: v.status === "verified" ? cur?.verifiedAt ?? new Date() : null, updatedAt: new Date(),
      ...(v.twilioAuthToken ? { twilioAuthTokenEnc: encrypt(v.twilioAuthToken) } : {}),
    };
    try {
      await tx.insert(companySenders).values({ companyId, channel: "sms", ...values }).onConflictDoUpdate({ target: [companySenders.companyId, companySenders.channel], set: values });
    } catch (e) {
      if (/company_senders_twilio_key/.test(String((e as { cause?: { message?: string } }).cause?.message ?? ""))) throw new UserError("That Twilio account is already used by another company.");
      throw e;
    }
    await audit(tx, { companyId, actorUserId: ctx.userId, actorType: "platform_admin", action: "sender.sms_saved", details: { status: v.status, tokenChanged: Boolean(v.twilioAuthToken) }, requestId });
  });
}

/** Returns the Postmark webhook URL ONCE when `rotateWebhook` is true (only its hash is stored). */
export async function saveEmailSender(ctx: PlatformContext, companyId: string, input: z.input<typeof email> & { rotateWebhook?: boolean }, requestId?: string): Promise<string | null> {
  const v = email.parse(input);
  if (v.status === "verified" && !v.fromEmail) throw new UserError("A verified email sender needs a From address.");
  const key = input.rotateWebhook ? newToken(32) : null;
  await withPlatformDb(ctx, async (tx) => {
    const [cur] = await tx.select().from(companySenders).where(and(eq(companySenders.companyId, companyId), eq(companySenders.channel, "email")));
    if (v.status === "verified" && !v.postmarkServerToken && !cur?.postmarkServerTokenEnc) throw new UserError("Enter the Postmark server token before marking the sender verified.");
    const values = {
      status: v.status, fromEmail: v.fromEmail || null, fromName: v.fromName || null, replyTo: v.replyTo || null, notes: v.notes || null,
      verifiedAt: v.status === "verified" ? cur?.verifiedAt ?? new Date() : null, updatedAt: new Date(),
      ...(v.postmarkServerToken ? { postmarkServerTokenEnc: encrypt(v.postmarkServerToken) } : {}),
      ...(key ? { webhookKeyHash: webhookKeyHash(key) } : {}),
    };
    await tx.insert(companySenders).values({ companyId, channel: "email", ...values }).onConflictDoUpdate({ target: [companySenders.companyId, companySenders.channel], set: values });
    await audit(tx, { companyId, actorUserId: ctx.userId, actorType: "platform_admin", action: "sender.email_saved", details: { status: v.status, tokenChanged: Boolean(v.postmarkServerToken), webhookRotated: Boolean(key) }, requestId });
  });
  return key ? `${env().APP_BASE_URL}/api/webhooks/postmark/${key}` : null;
}
