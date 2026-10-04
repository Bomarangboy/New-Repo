import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { withCompanyDb } from "@/lib/db/context";
import { companies, companySenders, contacts, conversations, inquiries, inquiryEvents, messages, suppressions, users } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { env, isSimulatedEnvironment } from "@/lib/env";
import { roleCan, type Action } from "@/lib/authz/permissions";
import type { CompanyContext } from "@/lib/authz/context-types";
import { cleanMultiline, cleanText } from "@/lib/contact-normalize";
import { activeSuppression, latestConsent } from "./eligibility";
import { createOutbound, deliver } from "./send";
import { transportDecision } from "./transport";
import { handleInbound } from "./inbound";
import { stopEnrollments } from "@/server/sequences/stop";
import { sequenceEnrollments, sequences } from "@/lib/db/schema";

function need(ctx: CompanyContext, action: Action) {
  if (!roleCan(ctx.role, action)) throw new UserError("You don't have permission to do that.");
}

export async function listConversations(ctx: CompanyContext, filter: "all" | "needs_reply" = "all", limit = 50) {
  need(ctx, "conversation.view");
  return withCompanyDb(ctx, async (tx) => {
    const last = tx.$with("last").as(
      tx.selectDistinctOn([messages.conversationId], { conversationId: messages.conversationId, body: messages.body, direction: messages.direction, channel: messages.channel, status: messages.status, transport: messages.transport })
        .from(messages).orderBy(messages.conversationId, desc(messages.createdAt)),
    );
    return tx.with(last).select({
      id: conversations.id, needsReply: conversations.needsReply, lastMessageAt: conversations.lastMessageAt,
      name: contacts.fullName, email: contacts.email, phone: contacts.phone,
      lastBody: last.body, lastDirection: last.direction, lastChannel: last.channel, lastStatus: last.status, lastTransport: last.transport,
    }).from(conversations).innerJoin(contacts, eq(contacts.id, conversations.contactId)).leftJoin(last, eq(last.conversationId, conversations.id))
      .where(filter === "needs_reply" ? eq(conversations.needsReply, true) : sql`${conversations.lastMessageAt} is not null`)
      .orderBy(desc(conversations.needsReply), sql`${conversations.lastMessageAt} desc nulls last`).limit(limit);
  });
}

export async function needsReplyCount(ctx: CompanyContext): Promise<number> {
  return withCompanyDb(ctx, async (tx) => {
    const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(conversations).where(eq(conversations.needsReply, true));
    return r?.n ?? 0;
  });
}

export async function getConversation(ctx: CompanyContext, id: string) {
  need(ctx, "conversation.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withCompanyDb(ctx, async (tx) => {
    const [row] = await tx.select({ c: conversations, contact: contacts }).from(conversations).innerJoin(contacts, eq(contacts.id, conversations.contactId)).where(eq(conversations.id, id));
    if (!row) return null;
    const thread = await tx.select({ m: messages, senderName: users.fullName }).from(messages).leftJoin(users, eq(users.id, messages.sentByUserId))
      .where(eq(messages.conversationId, id)).orderBy(asc(messages.createdAt)).limit(500);
    const leads = await tx.select({ id: inquiries.id, stage: inquiries.stage, service: inquiries.serviceRequested, submittedAt: inquiries.submittedAt })
      .from(inquiries).where(eq(inquiries.contactId, row.contact.id)).orderBy(desc(inquiries.submittedAt));
    const sup = await tx.select().from(suppressions).where(and(isNull(suppressions.liftedAt),
      sql`((${suppressions.channel} = 'sms' and ${suppressions.address} = ${row.contact.phoneE164 ?? ""}) or (${suppressions.channel} = 'email' and ${suppressions.address} = ${row.contact.emailNormalized ?? ""}))`));
    const smsConsent = await latestConsent(tx, ctx.companyId, row.contact.id, "sms");
    const hasTextedUs = thread.some((t) => t.m.direction === "inbound" && t.m.channel === "sms");
    return { conversation: row.c, contact: row.contact, thread, leads, suppressions: sup, smsAllowed: smsConsent === true || hasTextedUs, smsConsent };
  });
}

export async function markConversationRead(ctx: CompanyContext, id: string) {
  need(ctx, "conversation.view");
  await withCompanyDb(ctx, (tx) => tx.update(conversations).set({ lastReadAt: new Date(), needsReply: false }).where(eq(conversations.id, id)));
}

/** Opens (or creates) the conversation for a lead's contact, for "Message this lead" links. */
export async function conversationForInquiry(ctx: CompanyContext, inquiryId: string): Promise<string | null> {
  need(ctx, "conversation.view");
  return withCompanyDb(ctx, async (tx) => {
    const [i] = await tx.select({ contactId: inquiries.contactId }).from(inquiries).where(eq(inquiries.id, inquiryId));
    if (!i) return null;
    await tx.insert(conversations).values({ companyId: ctx.companyId, contactId: i.contactId }).onConflictDoNothing();
    const [c] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.contactId, i.contactId));
    return c?.id ?? null;
  });
}

/**
 * A team member's reply. Same safety rules as automatic messages: account status, opt-outs, and text
 * permission (recorded permission, or the person texted us first). `clientKey` comes from the form so a
 * double-click sends one message.
 */
export async function sendManualMessage(ctx: CompanyContext, input: { conversationId: string; channel: "sms" | "email"; subject?: string; body: string; clientKey: string }) {
  need(ctx, "message.send_manual");
  if (!ctx.policy.manualSending) throw new UserError("Sending is paused for this account. Contact Bluewater if this is unexpected.");
  const body = cleanMultiline(input.body, input.channel === "sms" ? 1600 : 10_000);
  if (!body) throw new UserError("Write a message first.");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(input.clientKey)) throw new UserError("Please reload the page and try again.");
  const prepared = await withCompanyDb(ctx, async (tx) => {
    const [row] = await tx.select({ c: conversations, contact: contacts }).from(conversations).innerJoin(contacts, eq(contacts.id, conversations.contactId)).where(eq(conversations.id, input.conversationId));
    if (!row) throw new UserError("Conversation not found.");
    const to = input.channel === "sms" ? row.contact.phoneE164 : row.contact.email;
    if (!to) throw new UserError(input.channel === "sms" ? "This contact has no phone number." : "This contact has no email address.");
    const sup = await activeSuppression(tx, ctx.companyId, input.channel, input.channel === "sms" ? to : to.toLowerCase());
    if (sup) throw new UserError(`This person opted out of ${input.channel === "sms" ? "texts" : "email"} on ${sup.createdAt.toLocaleDateString("en-US")}. Don't contact them this way.`);
    if (input.channel === "sms") {
      const consent = await latestConsent(tx, ctx.companyId, row.contact.id, "sms");
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(messages).where(and(eq(messages.conversationId, row.c.id), eq(messages.direction, "inbound"), eq(messages.channel, "sms")))) as [{ n: number }];
      if (consent !== true && n === 0) throw new UserError("There's no recorded permission to text this person, and they haven't texted you. Call or email them instead.");
    }
    const [company] = await tx.select({ kind: companies.kind }).from(companies).where(eq(companies.id, ctx.companyId));
    const [sender] = await tx.select({ status: companySenders.status }).from(companySenders).where(and(eq(companySenders.companyId, ctx.companyId), eq(companySenders.channel, input.channel)));
    const transport = transportDecision({ simulatedEnvironment: isSimulatedEnvironment(), companyKind: company!.kind, senderStatus: sender?.status, channel: input.channel });
    if (transport === "simulated" && company!.kind === "customer" && env().APP_ENV === "production") {
      throw new UserError(`Sending from Bluewater isn't switched on for your ${input.channel === "sms" ? "text number" : "email"} yet. Contact Bluewater.`);
    }
    const { message, created } = await createOutbound(tx, {
      companyId: ctx.companyId, contactId: row.contact.id, channel: input.channel, kind: "manual", to,
      subject: input.channel === "email" ? cleanText(input.subject, 200) ?? `Message from ${ctx.companyName}` : null, body,
      idempotencyKey: `manual:${input.clientKey}`, sentByUserId: ctx.userId, transport, companyName: ctx.companyName,
    });
    if (created) {
      // A person took over: stop follow-ups whose sequence says so.
      const following = await tx.select({ id: sequenceEnrollments.id }).from(sequenceEnrollments).innerJoin(sequences, eq(sequences.id, sequenceEnrollments.sequenceId))
        .where(and(eq(sequenceEnrollments.contactId, row.contact.id), sql`${sequenceEnrollments.status} in ('active','paused')`, eq(sequences.stopOnManualMessage, true)));
      for (const e of following) await stopEnrollments(tx, ctx.companyId, { enrollmentId: e.id }, "manual_message", "A team member messaged them", { userId: ctx.userId, type: ctx.supportGrantId ? "support" : "user" });
      // First human contact moves a New lead to Contacted.
      const [open] = await tx.select().from(inquiries).where(and(eq(inquiries.contactId, row.contact.id), eq(inquiries.stage, "new"))).orderBy(desc(inquiries.submittedAt)).limit(1);
      if (open) {
        await tx.update(inquiries).set({ stage: "contacted", stageChangedAt: new Date() }).where(eq(inquiries.id, open.id));
        await tx.insert(inquiryEvents).values({ companyId: ctx.companyId, inquiryId: open.id, type: "stage_changed", actorUserId: ctx.userId, actorType: ctx.supportGrantId ? "support" : "user", details: { from: "new", to: "contacted", reason: "first_reply" } });
      }
    }
    return message;
  });
  if (prepared.status !== "queued") return prepared.status;
  return (await deliver(ctx.companyId, prepared.id)).status;
}

export async function recordOptOut(ctx: CompanyContext, conversationId: string, channel: "sms" | "email", detail: string, requestId?: string) {
  need(ctx, "contact.opt_out");
  return withCompanyDb(ctx, async (tx) => {
    const [row] = await tx.select({ contact: contacts }).from(conversations).innerJoin(contacts, eq(contacts.id, conversations.contactId)).where(eq(conversations.id, conversationId));
    if (!row) throw new UserError("Conversation not found.");
    const address = channel === "sms" ? row.contact.phoneE164 : row.contact.emailNormalized;
    if (!address) throw new UserError("There's no address on file for that channel.");
    await tx.insert(suppressions).values({ companyId: ctx.companyId, channel, address, reason: "manual", detail: cleanText(detail, 200) ?? "Recorded by staff", createdByUserId: ctx.userId }).onConflictDoNothing();
    await stopEnrollments(tx, ctx.companyId, { contactId: row.contact.id }, "opted_out", "Opt-out recorded by a team member", { userId: ctx.userId, type: ctx.supportGrantId ? "support" : "user" });
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: ctx.supportGrantId ? "support" : "user", action: "contact.opted_out", targetType: "contact", targetId: row.contact.id, details: { channel }, requestId });
  });
}

/** Lifting an opt-out needs a reason (e.g. the person asked to hear from you again). Owner only. */
export async function liftOptOut(ctx: CompanyContext, suppressionId: string, reason: string, requestId?: string) {
  need(ctx, "settings.manage");
  const why = cleanText(reason, 300);
  if (!why || why.length < 10) throw new UserError("Explain how the person gave permission again (at least a short sentence).");
  return withCompanyDb(ctx, async (tx) => {
    const [s] = await tx.update(suppressions).set({ liftedAt: new Date(), liftedReason: why }).where(and(eq(suppressions.id, suppressionId), isNull(suppressions.liftedAt))).returning();
    if (!s) throw new UserError("Opt-out not found.");
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: ctx.supportGrantId ? "support" : "user", action: "contact.opt_out_lifted", targetType: "suppression", targetId: s.id, details: { channel: s.channel, reason: why }, requestId });
  });
}

/** Development/test/demo only: pretend the contact replied (the server refuses this anywhere else). */
export async function simulateIncomingReply(ctx: CompanyContext, conversationId: string, channel: "sms" | "email", body: string) {
  need(ctx, "conversation.view");
  if (!isSimulatedEnvironment() && ctx.companyKind === "customer") throw new UserError("Simulation isn't available here.");
  const contact = await withCompanyDb(ctx, async (tx) => {
    const [row] = await tx.select({ contact: contacts }).from(conversations).innerJoin(contacts, eq(contacts.id, conversations.contactId)).where(eq(conversations.id, conversationId));
    return row?.contact ?? null;
  });
  if (!contact) throw new UserError("Conversation not found.");
  const from = channel === "sms" ? contact.phoneE164 : contact.email;
  if (!from) throw new UserError("No address for that channel.");
  return handleInbound({ companyId: ctx.companyId, channel, from, body: cleanMultiline(body, 2000) ?? "Hi!", transport: "simulated", providerMessageId: `sim_in_${crypto.randomUUID()}`, subject: channel === "email" ? "Re: your inquiry" : null });
}

/** Latest messages with a lead's contact, for the lead page. */
export async function recentMessagesForContact(ctx: CompanyContext, contactId: string, limit = 4) {
  if (!roleCan(ctx.role, "conversation.view")) return [];
  return withCompanyDb(ctx, (tx) =>
    tx.select({ id: messages.id, direction: messages.direction, channel: messages.channel, kind: messages.kind, status: messages.status, body: messages.body, createdAt: messages.createdAt, transport: messages.transport, statusReason: messages.statusReason })
      .from(messages).where(eq(messages.contactId, contactId)).orderBy(desc(messages.createdAt)).limit(limit));
}

/** Why an inquiry's automatic acknowledgment did or didn't go out (from its job). */
export async function acknowledgmentStatus(ctx: CompanyContext, inquiryId: string) {
  return withCompanyDb(ctx, async (tx) => {
    const r = await tx.execute<{ status: string; result: string | null; run_at: Date }>(sql`select status, result, run_at from app.jobs where idempotency_key = ${"ack:" + inquiryId}`);
    return r[0] ? { status: r[0].status, result: r[0].result, runAt: new Date(r[0].run_at) } : null;
  });
}
