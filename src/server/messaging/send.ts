import { and, eq, lt } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { withSystemCompanyDb, withSystemDb } from "@/lib/db/context";
import { companies, companySenders, conversations, messages, messageStatusEvents } from "@/lib/db/schema";
import { chooseTransport, type TransportResult } from "./transport";
import { smsSegments } from "./templates";
import { emailFooter } from "./unsubscribe";

/**
 * Outbound message lifecycle (never sends the same message twice):
 *
 *   createOutbound()  → status "queued" (unique idempotency key per company)
 *   deliver():   tx1  → "sending" (committed BEFORE contacting the provider)
 *                call provider
 *                tx2  → "submitted" | "failed" | "unknown"
 *   provider reports  → "delivered" / "failed" (applyStatusUpdate; never moves backwards)
 *
 * If a worker dies between tx1 and tx2 the message stays "sending"; maintenance marks it
 * "unknown" for a person to check (D-25). It is never re-sent automatically.
 */

export type MessageRow = typeof messages.$inferSelect;

export async function ensureConversation(tx: Tx, companyId: string, contactId: string): Promise<string> {
  await tx.insert(conversations).values({ companyId, contactId }).onConflictDoNothing({ target: [conversations.companyId, conversations.contactId] });
  const [c] = await tx.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.companyId, companyId), eq(conversations.contactId, contactId)));
  return c!.id;
}

export interface NewOutbound {
  companyId: string;
  contactId: string;
  inquiryId?: string | null;
  channel: "sms" | "email";
  kind: "acknowledgment" | "manual" | "auto_reply";
  to: string;
  subject?: string | null;
  body: string;
  idempotencyKey: string;
  templateKey?: string | null;
  templateVersion?: number | null;
  sentByUserId?: string | null;
  transport: string;
  /** Needed for the unsubscribe footer on emails. */
  companyName?: string;
}

/** Inserts a queued message, or returns the existing one with the same idempotency key. */
export async function createOutbound(tx: Tx, m: NewOutbound): Promise<{ message: MessageRow; created: boolean }> {
  const conversationId = await ensureConversation(tx, m.companyId, m.contactId);
  const id = crypto.randomUUID();
  // Every client email carries a working unsubscribe link (signed with the message id).
  const body = m.channel === "email" && m.companyName ? m.body + emailFooter(id, m.companyName) : m.body;
  const inserted = await tx.insert(messages).values({
    id, companyId: m.companyId, conversationId, contactId: m.contactId, inquiryId: m.inquiryId ?? null, direction: "outbound",
    channel: m.channel, kind: m.kind, status: "queued", toAddress: m.to, subject: m.subject ?? null, body,
    transport: m.transport, idempotencyKey: m.idempotencyKey, templateKey: m.templateKey ?? null, templateVersion: m.templateVersion ?? null,
    sentByUserId: m.sentByUserId ?? null, segments: m.channel === "sms" ? smsSegments(body).segments : null,
  }).onConflictDoNothing().returning();
  if (inserted[0]) {
    await tx.update(conversations).set({
      lastMessageAt: new Date(), updatedAt: new Date(),
      ...(m.kind === "manual" ? { lastHumanOutboundAt: new Date(), needsReply: false } : {}),
    }).where(eq(conversations.id, conversationId));
    return { message: inserted[0], created: true };
  }
  const [existing] = await tx.select().from(messages).where(and(eq(messages.companyId, m.companyId), eq(messages.idempotencyKey, m.idempotencyKey)));
  return { message: existing!, created: false };
}

const STALE_SENDING_MS = 10 * 60_000;

/** Sends a queued message once. Safe to call repeatedly. Returns the message's resulting status. */
export async function deliver(companyId: string, messageId: string, now = () => new Date()): Promise<{ status: string; message: MessageRow }> {
  // tx1: claim
  const claim = await withSystemCompanyDb(companyId, "messaging: claim send", async (tx) => {
    const [m] = await tx.select().from(messages).where(eq(messages.id, messageId)).for("update");
    if (!m) throw new Error("message not found");
    if (m.status !== "queued") return { m, go: false };
    const [company] = await tx.select({ kind: companies.kind }).from(companies).where(eq(companies.id, companyId));
    const [sender] = await tx.select().from(companySenders).where(and(eq(companySenders.companyId, companyId), eq(companySenders.channel, m.channel)));
    const [updated] = await tx.update(messages).set({ status: "sending", sendingStartedAt: now(), statusUpdatedAt: now() }).where(eq(messages.id, messageId)).returning();
    return { m: updated!, go: true, kind: company!.kind, sender: sender ?? null };
  });
  if (!claim.go) return { status: claim.m.status, message: claim.m };

  const transport = chooseTransport(claim.kind!, claim.sender!, claim.m.channel as "sms" | "email");
  let result: TransportResult;
  try {
    result = await transport.send({ messageId, channel: claim.m.channel as "sms" | "email", to: claim.m.toAddress, subject: claim.m.subject, body: claim.m.body }, claim.sender!);
  } catch (e) {
    result = { outcome: "unknown", error: e instanceof Error ? e.message : "send error" };
  }

  // tx2: record
  return withSystemCompanyDb(companyId, "messaging: record send result", async (tx) => {
    const t = now();
    const patch: Partial<typeof messages.$inferInsert> =
      result.outcome === "submitted" ? { status: "submitted", providerMessageId: result.providerMessageId, fromAddress: result.from ?? null, submittedAt: t, transport: transport.name }
      : result.outcome === "failed" ? { status: "failed", errorCode: result.errorCode, statusReason: result.error, failedAt: t, transport: transport.name }
      : { status: "unknown", statusReason: result.error, transport: transport.name };
    const [updated] = await tx.update(messages).set({ ...patch, statusUpdatedAt: t }).where(and(eq(messages.id, messageId), eq(messages.status, "sending"))).returning();
    await tx.insert(messageStatusEvents).values({ companyId, messageId, status: patch.status!, providerStatus: result.outcome, errorCode: result.outcome === "failed" ? result.errorCode : null, applied: Boolean(updated), occurredAt: t });
    let final = updated ?? claim.m;
    // The simulated provider "delivers" instantly so the inbox and reports behave like the real thing.
    if (updated && transport.name === "simulated" && result.outcome === "submitted") {
      const [d] = await tx.update(messages).set({ status: "delivered", deliveredAt: t, statusUpdatedAt: t }).where(eq(messages.id, messageId)).returning();
      await tx.insert(messageStatusEvents).values({ companyId, messageId, status: "delivered", providerStatus: "simulated_delivered", applied: true, occurredAt: t });
      final = d!;
    }
    return { status: final.status, message: final };
  });
}

/* ---------------- Provider status reports ---------------- */

const RANK: Record<string, number> = { queued: 0, sending: 1, unknown: 1, submitted: 2, delivered: 3, failed: 3 };

/**
 * Applies a provider report. Duplicate and out-of-order reports are recorded but never move a
 * message backwards (e.g. "sent" arriving after "delivered" is ignored). Terminal states stay terminal.
 */
export async function applyStatusUpdate(p: {
  transport: "twilio" | "postmark" | "simulated"; providerMessageId: string; status: "submitted" | "delivered" | "failed";
  providerStatus: string; errorCode?: string | null; reason?: string | null; occurredAt?: Date;
}): Promise<{ applied: boolean; messageId: string | null; companyId: string | null }> {
  const found = await withSystemDb("messaging: find message for provider report", async (tx) => {
    const [m] = await tx.select({ id: messages.id, companyId: messages.companyId }).from(messages)
      .where(and(eq(messages.transport, p.transport), eq(messages.providerMessageId, p.providerMessageId)));
    return m ?? null;
  });
  if (!found) return { applied: false, messageId: null, companyId: null };
  return withSystemCompanyDb(found.companyId, "messaging: apply provider report", async (tx) => {
    const [m] = await tx.select().from(messages).where(eq(messages.id, found.id)).for("update");
    const cur = m!.status;
    const terminal = cur === "delivered" || cur === "failed";
    const applied = !terminal && (RANK[p.status] ?? 0) > (RANK[cur] ?? 0);
    if (applied) {
      const t = p.occurredAt ?? new Date();
      await tx.update(messages).set({
        status: p.status, statusUpdatedAt: new Date(),
        ...(p.status === "delivered" ? { deliveredAt: t } : {}),
        ...(p.status === "failed" ? { failedAt: t, errorCode: p.errorCode ?? null, statusReason: p.reason ?? null } : {}),
        ...(p.status === "submitted" && !m!.submittedAt ? { submittedAt: t } : {}),
      }).where(eq(messages.id, m!.id));
    }
    await tx.insert(messageStatusEvents).values({ companyId: found.companyId, messageId: m!.id, status: p.status, providerStatus: p.providerStatus, errorCode: p.errorCode ?? null, applied, occurredAt: p.occurredAt ?? null });
    return { applied, messageId: m!.id, companyId: found.companyId };
  });
}

/** Maintenance: sends interrupted mid-flight become "unknown" for a person to review (never re-sent). */
export async function markInterruptedSendsUnknown(now = new Date()): Promise<number> {
  return withSystemDb("messaging: mark interrupted sends", async (tx) => {
    const res = await tx.update(messages).set({ status: "unknown", statusReason: "Sending was interrupted; check with the provider before resending", statusUpdatedAt: now })
      .where(and(eq(messages.status, "sending"), lt(messages.sendingStartedAt, new Date(now.getTime() - STALE_SENDING_MS)))).returning({ id: messages.id, companyId: messages.companyId });
    for (const r of res) {
      await tx.insert(messageStatusEvents).values({ companyId: r.companyId, messageId: r.id, status: "unknown", providerStatus: "interrupted", applied: true, occurredAt: now });
    }
    return res.length;
  });
}

