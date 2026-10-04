import { env, isSimulatedEnvironment } from "@/lib/env";
import { decrypt } from "@/lib/crypto";
import type { companySenders } from "@/lib/db/schema";
import type { CompanyKind } from "@/lib/authz/account-policy";

export type Sender = typeof companySenders.$inferSelect;
export type TransportName = "simulated" | "twilio" | "postmark";

export interface OutboundPayload {
  messageId: string;
  channel: "sms" | "email";
  to: string;
  subject?: string | null;
  body: string;
}

/**
 * submitted – the provider accepted it (NOT proof of delivery)
 * failed    – the provider definitely rejected it (safe to tell the team; never auto-retried for messages)
 * unknown   – we can't tell whether it was accepted (timeout, provider 5xx); never retried automatically (D-25)
 */
export type TransportResult =
  | { outcome: "submitted"; providerMessageId: string; from?: string | null }
  | { outcome: "failed"; errorCode: string; error: string }
  | { outcome: "unknown"; error: string };

export interface Transport {
  name: TransportName;
  send(m: OutboundPayload, sender: Sender | null): Promise<TransportResult>;
}

/**
 * Real delivery requires every condition (D-23). Anything else → simulated.
 * Exported separately so the rule is unit-tested without touching providers.
 */
export function transportDecision(p: {
  simulatedEnvironment: boolean; companyKind: CompanyKind; senderStatus: string | null | undefined; channel: "sms" | "email";
}): TransportName {
  if (p.simulatedEnvironment || p.companyKind !== "customer" || p.senderStatus !== "verified") return "simulated";
  return p.channel === "sms" ? "twilio" : "postmark";
}

export function chooseTransport(companyKind: CompanyKind, sender: Sender | null, channel: "sms" | "email"): Transport {
  const name = transportDecision({ simulatedEnvironment: isSimulatedEnvironment(), companyKind, senderStatus: sender?.status, channel });
  return name === "twilio" ? twilioTransport : name === "postmark" ? postmarkTransport : simulatedTransport;
}

/* ---------------- Simulated (development, test, staging, demo, and unverified senders) ---------------- */

/** Records the message and reports it accepted. Addresses starting with "fail" simulate a rejection. */
export const simulatedTransport: Transport = {
  name: "simulated",
  async send(m) {
    if (/^fail/i.test(m.to) || m.to.endsWith("0000000")) return { outcome: "failed", errorCode: "SIMULATED_REJECTION", error: "Simulated provider rejection (test address)" };
    return { outcome: "submitted", providerMessageId: `sim_${m.messageId}`, from: m.channel === "sms" ? "+15550000000 (simulated)" : "simulated@bluewater.invalid" };
  },
};

/* ---------------- Twilio (SMS) — AWAITING LIVE VERIFICATION ---------------- */

export const twilioTransport: Transport = {
  name: "twilio",
  async send(m, sender) {
    if (!sender?.twilioAccountSid || !sender.twilioAuthTokenEnc || !(sender.messagingServiceSid || sender.fromNumber)) {
      return { outcome: "failed", errorCode: "SENDER_NOT_CONFIGURED", error: "Text sender isn't fully configured." };
    }
    const form = new URLSearchParams({ To: m.to, Body: m.body, StatusCallback: `${env().APP_BASE_URL}/api/webhooks/twilio/status` });
    if (sender.messagingServiceSid) form.set("MessagingServiceSid", sender.messagingServiceSid);
    else form.set("From", sender.fromNumber!);
    let res: Response;
    try {
      res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sender.twilioAccountSid)}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sender.twilioAccountSid}:${decrypt(sender.twilioAuthTokenEnc)}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      return { outcome: "unknown", error: `No response from Twilio (${e instanceof Error ? e.name : "error"})` };
    }
    const data = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string; from?: string };
    if (res.ok && data.sid) return { outcome: "submitted", providerMessageId: data.sid, from: data.from ?? null };
    if (res.status >= 500) return { outcome: "unknown", error: `Twilio returned ${res.status}` };
    return { outcome: "failed", errorCode: String(data.code ?? res.status), error: (data.message ?? `Twilio rejected the message (${res.status})`).slice(0, 300) };
  },
};

/* ---------------- Postmark (client email) — AWAITING LIVE VERIFICATION ---------------- */

export const postmarkTransport: Transport = {
  name: "postmark",
  async send(m, sender) {
    if (!sender?.postmarkServerTokenEnc || !sender.fromEmail) {
      return { outcome: "failed", errorCode: "SENDER_NOT_CONFIGURED", error: "Email sender isn't fully configured." };
    }
    let res: Response;
    try {
      res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "X-Postmark-Server-Token": decrypt(sender.postmarkServerTokenEnc) },
        body: JSON.stringify({
          From: sender.fromName ? `${sender.fromName.replace(/[<>"]/g, "")} <${sender.fromEmail}>` : sender.fromEmail,
          To: m.to, Subject: m.subject ?? "", TextBody: m.body, ReplyTo: sender.replyTo ?? undefined,
          MessageStream: "outbound", Metadata: { bluewater_message_id: m.messageId },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      return { outcome: "unknown", error: `No response from Postmark (${e instanceof Error ? e.name : "error"})` };
    }
    const data = (await res.json().catch(() => ({}))) as { MessageID?: string; ErrorCode?: number; Message?: string };
    if (res.ok && data.ErrorCode === 0 && data.MessageID) return { outcome: "submitted", providerMessageId: data.MessageID, from: sender.fromEmail };
    if (res.status >= 500) return { outcome: "unknown", error: `Postmark returned ${res.status}` };
    return { outcome: "failed", errorCode: String(data.ErrorCode ?? res.status), error: (data.Message ?? "Postmark rejected the message").slice(0, 300) };
  },
};
