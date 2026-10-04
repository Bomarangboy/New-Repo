import { afterAll, beforeAll, describe, expect, it } from "vitest";
import twilio from "twilio";
import { and, eq } from "drizzle-orm";
import { closeDb } from "@/lib/db/client";
import { withSystemDb } from "@/lib/db/context";
import { messages, suppressions } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getSenders, saveEmailSender, saveSmsSender } from "@/server/senders";
import { postmarkWebhook, twilioInbound, twilioStatus } from "@/server/messaging/webhooks";
import { confirmUnsubscribe, describeUnsubscribe, unsubscribeUrl } from "@/server/messaging/unsubscribe";
import { createOutbound, deliver } from "@/server/messaging/send";
import { recordInquiry } from "@/server/crm/record-inquiry";
import { addMember, adminCtx, makeCompany, makeUser } from "../helpers";
import { withSystemCompanyDb } from "@/lib/db/context";

const SID = "AC" + "1".repeat(32);
const TOKEN = "test_auth_token_1234567890abcdef";
let companyId = "";
let pmKey = "";

const sign = (path: string, params: Record<string, string>) => twilio.getExpectedTwilioSignature(TOKEN, `${env().APP_BASE_URL}${path}`, params);

beforeAll(async () => {
  const admin = adminCtx(await makeUser({ admin: true }));
  const c = await makeCompany({ name: "Webhook Co", lifecycleStatus: "active" });
  companyId = c.id;
  await addMember(c.id, (await makeUser()).id, "owner");
  await saveSmsSender(admin, c.id, { status: "pending_verification", twilioAccountSid: SID, twilioAuthToken: TOKEN, messagingServiceSid: "", fromNumber: "+14155550000" });
  const url = await saveEmailSender(admin, c.id, { status: "pending_verification", fromEmail: "hello@webhookco.example", postmarkServerToken: "pm-token", rotateWebhook: true });
  pmKey = url!.split("/").pop()!;
  const senders = await getSenders(admin, c.id);
  expect(JSON.stringify(senders)).not.toContain(TOKEN); // secrets never leave the server
  expect(JSON.stringify(senders)).not.toContain("pm-token");
});
afterAll(closeDb);

describe("Twilio webhooks", () => {
  it("accepts a correctly signed incoming text and rejects forgeries", async () => {
    const params = { AccountSid: SID, From: "+14155557777", To: "+14155550000", Body: "Is Tuesday OK?", MessageSid: "SM" + "a".repeat(32) };
    expect(await twilioInbound(params, "forged")).toBe(403);
    expect(await twilioInbound({ ...params, Body: "tampered" }, sign("/api/webhooks/twilio/inbound", params))).toBe(403);
    expect(await twilioInbound({ ...params, AccountSid: "AC" + "9".repeat(32) }, sign("/api/webhooks/twilio/inbound", params))).toBe(403);
    expect(await twilioInbound(params, sign("/api/webhooks/twilio/inbound", params))).toBe(200);
    expect(await twilioInbound(params, sign("/api/webhooks/twilio/inbound", params))).toBe(200); // replay → stored once
    const rows = await withSystemDb("t", (tx) => tx.select().from(messages).where(eq(messages.providerMessageId, params.MessageSid)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ companyId, direction: "inbound", body: "Is Tuesday OK?" });
  });

  it("applies signed delivery reports", async () => {
    const msg = await withSystemCompanyDb(companyId, "t", async (tx) => {
      const r = await recordInquiry(tx, { fullName: "T", phone: "415-555-7001" }, { companyId, source: "manual", automationOrigin: "none", actorType: "system" });
      return (await createOutbound(tx, { companyId, contactId: r.contact.id, channel: "sms", kind: "manual", to: "+14155557001", body: "hi", idempotencyKey: "wh-1", transport: "simulated" })).message;
    });
    await deliver(companyId, msg.id);
    // Pretend Twilio sent it (simulated transport id) — reports reference provider ids.
    await withSystemDb("t", (tx) => tx.update(messages).set({ transport: "twilio", providerMessageId: "SM" + "b".repeat(32), status: "submitted" }).where(eq(messages.id, msg.id)));
    const params = { AccountSid: SID, MessageSid: "SM" + "b".repeat(32), MessageStatus: "undelivered", ErrorCode: "30005" };
    expect(await twilioStatus(params, "bad")).toBe(403);
    expect(await twilioStatus(params, sign("/api/webhooks/twilio/status", params))).toBe(200);
    const [m] = await withSystemDb("t", (tx) => tx.select().from(messages).where(eq(messages.id, msg.id)));
    expect(m).toMatchObject({ status: "failed", errorCode: "30005" });
  });
});

describe("Postmark webhooks", () => {
  it("rejects unknown keys and records inbound email, bounces and complaints", async () => {
    expect(await postmarkWebhook("x".repeat(40), { RecordType: "Inbound" })).toBe(404);
    expect(await postmarkWebhook(pmKey, { RecordType: "Inbound", MessageID: "pm-in-1", FromFull: { Email: "Reply@Example.com", Name: "Rae" }, Subject: "Re: hi", StrippedTextReply: "Thanks!" })).toBe(200);
    const [inbound] = await withSystemDb("t", (tx) => tx.select().from(messages).where(eq(messages.providerMessageId, "pm-in-1")));
    expect(inbound).toMatchObject({ companyId, channel: "email", body: "Thanks!" });
    await postmarkWebhook(pmKey, { RecordType: "Bounce", Type: "HardBounce", Email: "gone@example.com", MessageID: "x" });
    await postmarkWebhook(pmKey, { RecordType: "SpamComplaint", Email: "angry@example.com" });
    await postmarkWebhook(pmKey, { RecordType: "Bounce", Type: "SoftBounce", Email: "full@example.com" });
    const sup = await withSystemDb("t", (tx) => tx.select().from(suppressions).where(and(eq(suppressions.companyId, companyId), eq(suppressions.channel, "email"))));
    expect(sup.map((s) => `${s.address}:${s.reason}`).sort()).toEqual(["angry@example.com:spam_complaint", "gone@example.com:hard_bounce"]);
  });
});

describe("unsubscribe links", () => {
  it("are signed, show who is unsubscribing, and record an opt-out on confirmation", async () => {
    const msg = await withSystemCompanyDb(companyId, "t", async (tx) => {
      const r = await recordInquiry(tx, { fullName: "U", email: "unsub@example.com" }, { companyId, source: "manual", automationOrigin: "none", actorType: "system" });
      return (await createOutbound(tx, { companyId, contactId: r.contact.id, channel: "email", kind: "manual", to: "unsub@example.com", subject: "Hi", body: "Hello", idempotencyKey: "wh-unsub", transport: "simulated", companyName: "Webhook Co" })).message;
    });
    expect(msg.body).toContain(unsubscribeUrl(msg.id));
    const token = unsubscribeUrl(msg.id).split("/u/")[1]!;
    expect(await describeUnsubscribe(token.slice(0, -2) + "xx")).toBeNull();
    expect(await describeUnsubscribe(`${crypto.randomUUID()}.${token.split(".")[1]}`)).toBeNull();
    expect(await describeUnsubscribe(token)).toMatchObject({ email: "unsub@example.com", companyName: "Webhook Co" });
    expect(await confirmUnsubscribe(token)).toBe(true);
    const sup = await withSystemDb("t", (tx) => tx.select().from(suppressions).where(eq(suppressions.address, "unsub@example.com")));
    expect(sup[0]!.reason).toBe("unsubscribe_link");
  });
});
