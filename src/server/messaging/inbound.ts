import { and, eq, isNull } from "drizzle-orm";
import { withSystemCompanyDb } from "@/lib/db/context";
import { contacts, conversations, messages, messageStatusEvents, suppressions } from "@/lib/db/schema";
import { enqueue } from "@/server/jobs/queue";
import { ensureConversation } from "./send";

/**
 * Incoming texts and emails. Rules (docs/MESSAGING.md):
 *  - every incoming message is stored once (provider message id is unique);
 *  - opt-out words or clear opt-out phrases → the address is suppressed for this company immediately;
 *    START/UNSTOP lifts a keyword opt-out (texts only);
 *  - any other reply marks the conversation "needs reply", pauses automation for this person
 *    (pending acknowledgments see the reply and cancel; follow-ups check the same flag), and
 *    notifies the assignee/owners — a human takes over.
 */
const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT", "OPT OUT", "STOP ALL"]);
const START_WORDS = new Set(["START", "UNSTOP", "YES"]);
const OPT_OUT_PHRASE = /\b(stop (texting|messaging|contacting|sending)|unsubscribe|opt[ -]?out|remove me|do not (text|contact|message)|don'?t (text|contact|message) me|take me off)\b/i;

export function classifyInbound(body: string): "opt_out" | "opt_in" | "help" | "message" {
  const t = body.trim().toUpperCase().replace(/[.!]+$/, "");
  if (STOP_WORDS.has(t)) return "opt_out";
  if (START_WORDS.has(t)) return "opt_in";
  if (t === "HELP" || t === "INFO") return "help";
  if (body.length <= 160 && OPT_OUT_PHRASE.test(body)) return "opt_out";
  return "message";
}

export interface InboundInput {
  companyId: string;
  channel: "sms" | "email";
  /** E.164 phone or email address. */
  from: string;
  to?: string | null;
  subject?: string | null;
  body: string;
  transport: "twilio" | "postmark" | "simulated";
  providerMessageId: string;
  fromName?: string | null;
}

export async function handleInbound(m: InboundInput): Promise<{ stored: boolean; classification: string; conversationId: string }> {
  const address = m.channel === "email" ? m.from.trim().toLowerCase() : m.from.trim();
  const classification = classifyInbound(m.body);
  return withSystemCompanyDb(m.companyId, "messaging: inbound", async (tx) => {
    let [contact] = await tx.select().from(contacts).where(and(eq(contacts.companyId, m.companyId),
      m.channel === "email" ? eq(contacts.emailNormalized, address) : eq(contacts.phoneE164, address)));
    if (!contact) {
      // Someone new wrote to the business number/address: keep the message and make a contact for it.
      [contact] = await tx.insert(contacts).values({
        companyId: m.companyId, fullName: (m.fromName ?? "").slice(0, 200),
        ...(m.channel === "email" ? { email: m.from.trim(), emailNormalized: address } : { phone: m.from.trim(), phoneE164: address }),
      }).returning();
    }
    const conversationId = await ensureConversation(tx, m.companyId, contact!.id);
    const now = new Date();
    const inserted = await tx.insert(messages).values({
      companyId: m.companyId, conversationId, contactId: contact!.id, direction: "inbound", channel: m.channel, kind: "inbound",
      status: "received", toAddress: m.to ?? "", fromAddress: m.from, subject: m.subject ?? null, body: m.body.slice(0, 10_000),
      transport: m.transport, providerMessageId: m.providerMessageId, statusReason: classification === "message" ? null : classification,
    }).onConflictDoNothing().returning({ id: messages.id });
    if (!inserted[0]) return { stored: false, classification, conversationId }; // duplicate webhook delivery

    if (classification === "opt_out") {
      await tx.insert(suppressions).values({ companyId: m.companyId, channel: m.channel, address, reason: "opt_out_keyword", detail: m.body.slice(0, 200) }).onConflictDoNothing();
    } else if (classification === "opt_in" && m.channel === "sms") {
      await tx.update(suppressions).set({ liftedAt: now, liftedReason: `Contact texted "${m.body.trim().slice(0, 20)}"` })
        .where(and(eq(suppressions.companyId, m.companyId), eq(suppressions.channel, "sms"), eq(suppressions.address, address), eq(suppressions.reason, "opt_out_keyword"), isNull(suppressions.liftedAt)));
    }
    const needsHuman = classification === "message" || classification === "help";
    await tx.update(conversations).set({ lastMessageAt: now, lastInboundAt: now, updatedAt: now, ...(needsHuman ? { needsReply: true } : {}) }).where(eq(conversations.id, conversationId));
    if (needsHuman) {
      await enqueue(tx, { companyId: m.companyId, kind: "notify_reply", key: `notify:reply:${inserted[0].id}`, payload: { conversationId }, runAt: new Date(now.getTime() + 60_000) });
    }
    await tx.insert(messageStatusEvents).values({ companyId: m.companyId, messageId: inserted[0].id, status: "received", providerStatus: classification, applied: true, occurredAt: now });
    return { stored: true, classification, conversationId };
  });
}

/** Email bounces/complaints from the provider → stop emailing that address for this company. */
export async function suppressEmail(companyId: string, address: string, reason: "hard_bounce" | "spam_complaint", detail?: string) {
  await withSystemCompanyDb(companyId, "messaging: email suppression", (tx) =>
    tx.insert(suppressions).values({ companyId, channel: "email", address: address.trim().toLowerCase(), reason, detail: detail?.slice(0, 200) ?? null }).onConflictDoNothing());
}
