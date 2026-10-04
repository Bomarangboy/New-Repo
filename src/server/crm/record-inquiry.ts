import { and, eq, or, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { consentRecords, contacts, inquiries, inquiryEvents } from "@/lib/db/schema";
import { cleanMultiline, cleanText, normalizeEmail, normalizePhone } from "@/lib/contact-normalize";
import { UserError } from "@/lib/errors";

export type InquirySource = typeof inquiries.$inferInsert["source"];
export type AutomationOrigin = "eligible" | "held" | "none";

export interface InquiryInput {
  fullName?: unknown;
  email?: unknown;
  phone?: unknown;
  serviceRequested?: unknown;
  message?: unknown;
  submittedAt?: Date;
  tracking?: Record<string, string>;
  externalIds?: Record<string, string>;
  consent?: {
    channel: "sms" | "email";
    purpose: "inquiry_response" | "marketing";
    granted: boolean;
    statement?: string | null;
    method: string;
    pageUrl?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }[];
}

export interface RecordOptions {
  companyId: string;
  source: InquirySource;
  sourceLabel?: string | null;
  intakeSourceId?: string | null;
  automationOrigin: AutomationOrigin;
  actorUserId?: string | null;
  actorType: "user" | "system" | "support";
  importBatchId?: string | null;
  assignedUserId?: string | null;
}

export interface ValidatedInquiry {
  fullName: string;
  email: { display: string; normalized: string } | null;
  phone: { display: string; e164: string } | null;
  serviceRequested: string | null;
  message: string | null;
}

/** Validation shared by every lead source. Returns problems in plain language. */
export function validateInquiry(input: InquiryInput): { ok: true; value: ValidatedInquiry } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  if (email === "invalid") problems.push("Email address isn't valid.");
  if (phone === "invalid") problems.push("Phone number isn't a valid US number.");
  const e = email === "invalid" ? null : email;
  const p = phone === "invalid" ? null : phone;
  if (!e && !p && problems.length === 0) problems.push("Provide an email address or a phone number.");
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    value: {
      fullName: cleanText(input.fullName, 200) ?? "",
      email: e,
      phone: p,
      serviceRequested: cleanText(input.serviceRequested, 200),
      message: cleanMultiline(input.message, 5000),
    },
  };
}

export type DedupeOutcome = "new_contact" | "matched_email" | "matched_phone" | "matched_both" | "matched_conflict";

/**
 * Creates or safely updates the contact and records a NEW inquiry (repeat inquiries stay separate).
 * Must run inside a transaction whose RLS context covers opts.companyId.
 *
 * Safe update rule: existing contact details are never overwritten by a new submission. Missing
 * details are filled in; differing details are noted in the history for a person to review.
 */
export async function recordInquiry(tx: Tx, input: InquiryInput, opts: RecordOptions) {
  const v = validateInquiry(input);
  if (!v.ok) throw new UserError(v.problems.join(" "));
  const val = v.value;

  // Serialize contact matching per company so two simultaneous submissions can't create twin contacts.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"contacts:" + opts.companyId}, 0))`);

  const matches = await tx.select().from(contacts).where(and(
    eq(contacts.companyId, opts.companyId),
    or(
      val.email ? eq(contacts.emailNormalized, val.email.normalized) : sql`false`,
      val.phone ? eq(contacts.phoneE164, val.phone.e164) : sql`false`,
    ),
  ));
  const byEmail = val.email ? matches.find((c) => c.emailNormalized === val.email!.normalized) : undefined;
  const byPhone = val.phone ? matches.find((c) => c.phoneE164 === val.phone!.e164) : undefined;

  let outcome: DedupeOutcome;
  let contact = byEmail ?? byPhone;
  const notes: string[] = [];

  if (!contact) {
    outcome = "new_contact";
    [contact] = await tx.insert(contacts).values({
      companyId: opts.companyId,
      fullName: val.fullName,
      email: val.email?.display ?? null,
      emailNormalized: val.email?.normalized ?? null,
      phone: val.phone?.display ?? null,
      phoneE164: val.phone?.e164 ?? null,
    }).returning();
  } else {
    outcome = byEmail && byPhone ? (byEmail.id === byPhone.id ? "matched_both" : "matched_conflict") : byEmail ? "matched_email" : "matched_phone";
    if (outcome === "matched_conflict") notes.push("Email and phone belong to two different existing contacts; attached to the email match. Review for a possible duplicate.");
    const patch: Partial<typeof contacts.$inferInsert> = {};
    if (!contact.fullName && val.fullName) patch.fullName = val.fullName;
    else if (val.fullName && contact.fullName.toLowerCase() !== val.fullName.toLowerCase()) notes.push(`Submitted name "${val.fullName}" differs from the saved name.`);
    if (val.email && !contact.emailNormalized && !byPhone?.emailNormalized) {
      patch.email = val.email.display;
      patch.emailNormalized = val.email.normalized;
    } else if (val.email && contact.emailNormalized && contact.emailNormalized !== val.email.normalized) {
      notes.push(`A different email (${val.email.display}) was submitted.`);
    }
    if (val.phone && !contact.phoneE164 && outcome !== "matched_conflict") {
      patch.phone = val.phone.display;
      patch.phoneE164 = val.phone.e164;
    } else if (val.phone && contact.phoneE164 && contact.phoneE164 !== val.phone.e164) {
      notes.push(`A different phone (${val.phone.display}) was submitted.`);
    }
    if (Object.keys(patch).length) {
      [contact] = await tx.update(contacts).set({ ...patch, updatedAt: new Date() }).where(eq(contacts.id, contact.id)).returning();
    }
  }

  const [{ prior }] = (await tx.select({ prior: sql<number>`count(*)::int` }).from(inquiries)
    .where(and(eq(inquiries.companyId, opts.companyId), eq(inquiries.contactId, contact!.id)))) as [{ prior: number }];

  const now = new Date();
  const [inquiry] = await tx.insert(inquiries).values({
    companyId: opts.companyId,
    contactId: contact!.id,
    source: opts.source,
    sourceLabel: opts.sourceLabel ?? null,
    intakeSourceId: opts.intakeSourceId ?? null,
    serviceRequested: val.serviceRequested,
    message: val.message,
    submittedAt: input.submittedAt && input.submittedAt <= now ? input.submittedAt : now,
    receivedAt: now,
    isRepeat: prior > 0,
    automationOrigin: opts.automationOrigin,
    tracking: input.tracking ?? {},
    externalIds: input.externalIds ?? {},
    importBatchId: opts.importBatchId ?? null,
    assignedUserId: opts.assignedUserId ?? null,
  }).returning();

  for (const c of input.consent ?? []) {
    await tx.insert(consentRecords).values({
      companyId: opts.companyId, contactId: contact!.id, inquiryId: inquiry!.id,
      channel: c.channel, purpose: c.purpose, granted: c.granted, statement: c.statement ?? null, method: c.method,
      capturedAt: now, pageUrl: c.pageUrl ?? null, ipAddress: c.ipAddress ?? null, userAgent: c.userAgent ?? null,
      recordedByUserId: opts.actorType === "user" ? opts.actorUserId ?? null : null,
    });
  }

  await tx.insert(inquiryEvents).values({
    companyId: opts.companyId, inquiryId: inquiry!.id, type: "created",
    actorUserId: opts.actorUserId ?? null, actorType: opts.actorType,
    details: { source: opts.source, sourceLabel: opts.sourceLabel ?? null, dedupe: outcome, repeat: prior > 0, notes },
  });

  return { inquiry: inquiry!, contact: contact!, outcome, notes };
}
