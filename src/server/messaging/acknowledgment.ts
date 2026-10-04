import { and, eq, gt, or, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { withSystemCompanyDb } from "@/lib/db/context";
import { bookingSettings, companies, companySenders, contacts, inquiries, messages } from "@/lib/db/schema";
import { accountPolicy } from "@/lib/authz/account-policy";
import { hasFeature } from "@/lib/authz/entitlements";
import { autoEnrollNewLead } from "@/server/sequences/engine";
import { bookingLinkFor } from "@/server/booking/links";
import { env, isSimulatedEnvironment } from "@/lib/env";
import { enqueue, type JobOutcome, type JobRow } from "@/server/jobs/queue";
import { activeSuppression, latestConsent } from "./eligibility";
import { activeTemplate, isWithinWindow, loadSettings, nextWindowStart } from "./settings";
import { renderTemplate, varsFor } from "./templates";
import { createOutbound, deliver } from "./send";
import { transportDecision } from "./transport";

export const ACK_MAX_AGE_MS = 24 * 3600_000;

/**
 * Called inside the transaction that records a live inquiry. Enqueues the acknowledgment (only for
 * "eligible" inquiries) and the team notification. Idempotent: keys are per inquiry.
 */
export async function enqueueNewLeadWork(tx: Tx, companyId: string, inquiryId: string, automationOrigin: string) {
  if (automationOrigin === "eligible") {
    await enqueue(tx, { companyId, kind: "send_acknowledgment", key: `ack:${inquiryId}`, payload: { inquiryId }, maxAttempts: 5 });
    await autoEnrollNewLead(tx, companyId, inquiryId);
  }
  if (automationOrigin === "eligible" || automationOrigin === "held") {
    await enqueue(tx, { companyId, kind: "notify_new_lead", key: `notify:new_lead:${inquiryId}`, payload: { inquiryId }, maxAttempts: 5 });
  }
}

type Decision =
  | { action: "cancel"; reason: string; notify?: string }
  | { action: "wait"; until: Date; reason: string }
  | { action: "send"; channel: "sms" | "email"; to: string; subject: string | null; body: string; templateKey: string; templateVersion: number; transport: string; companyName: string };

/** Every check, evaluated immediately before sending (also after waiting for the window). */
export async function decideAcknowledgment(tx: Tx, companyId: string, inquiryId: string, now: Date): Promise<Decision> {
  const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
  if (!company) return { action: "cancel", reason: "Company not found" };
  const policy = accountPolicy(company, now);
  if (!policy.automatedSending) return { action: "cancel", reason: "The account isn't active for automatic messages" };
  const settings = await loadSettings(tx, companyId);
  if (settings.automationPaused) return { action: "cancel", reason: "Automatic messages are paused for this account" };
  if (!settings.ackEnabled) return { action: "cancel", reason: "Automatic acknowledgment is turned off" };

  const [row] = await tx.select({ i: inquiries, c: contacts }).from(inquiries).innerJoin(contacts, eq(contacts.id, inquiries.contactId)).where(eq(inquiries.id, inquiryId));
  if (!row) return { action: "cancel", reason: "Inquiry no longer exists" };
  const { i, c } = row;
  if (i.automationOrigin !== "eligible") return { action: "cancel", reason: "This inquiry isn't eligible for automatic messages" };
  if (i.stage !== "new") return { action: "cancel", reason: "Someone already moved this lead forward" };
  if (now.getTime() - i.receivedAt.getTime() > ACK_MAX_AGE_MS) return { action: "cancel", reason: "Too late to acknowledge (over 24 hours old)" };

  // Already in conversation since the inquiry arrived? Then a human (or the lead) has taken over.
  const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(messages).where(and(
    eq(messages.contactId, c.id), gt(messages.createdAt, i.receivedAt),
    or(eq(messages.direction, "inbound"), eq(messages.kind, "manual"), eq(messages.kind, "acknowledgment")),
  ))) as [{ n: number }];
  if (n > 0) return { action: "cancel", reason: "The lead already replied or was already contacted" };

  // Channel: text only with recorded permission and no opt-out; otherwise email.
  let channel: "sms" | "email" | null = null;
  const reasons: string[] = [];
  if (c.phoneE164) {
    if (await activeSuppression(tx, companyId, "sms", c.phoneE164)) reasons.push("their number opted out of texts");
    else if ((await latestConsent(tx, companyId, c.id, "sms")) !== true) reasons.push("no text permission recorded");
    else channel = "sms";
  } else reasons.push("no phone number");
  if (!channel) {
    if (c.emailNormalized && !(await activeSuppression(tx, companyId, "email", c.emailNormalized))) channel = "email";
    else reasons.push(c.emailNormalized ? "their email is unsubscribed" : "no email address");
  }
  if (!channel) return { action: "cancel", reason: `No acknowledgment possible: ${reasons.join("; ")}`, notify: `No automatic acknowledgment was sent: ${reasons.join("; ")}.` };

  const [sender] = await tx.select().from(companySenders).where(and(eq(companySenders.companyId, companyId), eq(companySenders.channel, channel)));
  const transport = transportDecision({ simulatedEnvironment: isSimulatedEnvironment(), companyKind: company.kind, senderStatus: sender?.status, channel });
  if (transport === "simulated" && company.kind === "customer" && env().APP_ENV === "production") {
    // Real customer in production but live sending is off or the sender isn't verified:
    // never record a simulated message as if it reached a real person.
    const why = isSimulatedEnvironment() ? "live sending hasn't been switched on yet" : `the ${channel === "sms" ? "text" : "email"} sender isn't verified yet`;
    return { action: "cancel", reason: `Not sent: ${why}`, notify: `No automatic acknowledgment was sent: ${why}.` };
  }

  if (!isWithinWindow(now, company.timezone, settings)) {
    const next = nextWindowStart(now, company.timezone, settings);
    if (!next || next.getTime() - i.receivedAt.getTime() > ACK_MAX_AGE_MS) return { action: "cancel", reason: "Sending window doesn't open within 24 hours of the inquiry" };
    return { action: "wait", until: next, reason: "Outside the sending window" };
  }

  const tpl = await activeTemplate(tx, companyId, channel === "sms" ? "ack_sms" : "ack_email");
  let bookingLink: string | null = null;
  if (hasFeature(company.package, "booking")) {
    const [b] = await tx.select({ url: bookingSettings.bookingUrl }).from(bookingSettings).where(eq(bookingSettings.companyId, companyId));
    bookingLink = bookingLinkFor(b?.url, i.id, channel === "email" ? { name: c.fullName || null, email: c.email } : undefined);
  }
  const vars = varsFor(c, company.name, i.serviceRequested, { bookingLink });
  return {
    action: "send", channel, to: channel === "sms" ? c.phoneE164! : c.email!, transport,
    subject: tpl.subject ? renderTemplate(tpl.subject, vars) : null, body: renderTemplate(tpl.body, vars),
    templateKey: tpl.key, templateVersion: tpl.version, companyName: company.name,
  };
}

export async function handleSendAcknowledgment(job: JobRow, now = new Date()): Promise<JobOutcome> {
  const companyId = job.companyId!;
  const inquiryId = String(job.payload.inquiryId);
  const prepared = await withSystemCompanyDb(companyId, "messaging: prepare acknowledgment", async (tx) => {
    // An earlier attempt may already have created the message: never create a second one.
    const [existing] = await tx.select().from(messages).where(and(eq(messages.companyId, companyId), eq(messages.idempotencyKey, `ack:${inquiryId}`)));
    if (existing) return { kind: "existing" as const, message: existing };
    const d = await decideAcknowledgment(tx, companyId, inquiryId, now);
    if (d.action !== "send") return { kind: "decision" as const, d };
    const [i] = await tx.select({ contactId: inquiries.contactId }).from(inquiries).where(eq(inquiries.id, inquiryId));
    const { message } = await createOutbound(tx, {
      companyId, contactId: i!.contactId, inquiryId, channel: d.channel, kind: "acknowledgment", to: d.to, subject: d.subject, body: d.body,
      idempotencyKey: `ack:${inquiryId}`, templateKey: d.templateKey, templateVersion: d.templateVersion, transport: d.transport, companyName: d.companyName,
    });
    return { kind: "existing" as const, message };
  });

  if (prepared.kind === "decision") {
    const d = prepared.d;
    if (d.action === "wait") return { status: "reschedule", runAt: d.until, result: d.reason };
    if (d.action === "cancel" && d.notify) {
      await withSystemCompanyDb(companyId, "messaging: report acknowledgment problem", (tx) =>
        enqueue(tx, { companyId, kind: "notify_ack_problem", key: `notify:ack_problem:${inquiryId}`, payload: { inquiryId, detail: d.notify } }));
    }
    return { status: "cancelled", result: d.action === "cancel" ? d.reason : "cancelled" };
  }

  const msg = prepared.message;
  if (msg.status !== "queued") return { status: "succeeded", result: `Already ${msg.status}` };
  const r = await deliver(companyId, msg.id);
  if (r.status === "failed" || r.status === "unknown") {
    await withSystemCompanyDb(companyId, "messaging: report acknowledgment problem", (tx) =>
      enqueue(tx, { companyId, kind: "notify_ack_problem", key: `notify:ack_problem:${inquiryId}`, payload: {
        inquiryId, detail: r.status === "failed" ? "The automatic acknowledgment could not be delivered." : "We couldn't confirm whether the automatic acknowledgment was sent. Bluewater is checking." } }));
  }
  return { status: "succeeded", result: `Message ${r.status}` };
}
