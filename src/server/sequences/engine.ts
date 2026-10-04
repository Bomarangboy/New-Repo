import { and, asc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { withSystemCompanyDb } from "@/lib/db/context";
import {
  appointments, bookingSettings, companies, contacts, inquiries, inquiryEvents, messages, sequenceEnrollments, sequenceSteps, sequences, suppressions, tasks,
} from "@/lib/db/schema";
import { accountPolicy } from "@/lib/authz/account-policy";
import { hasFeature } from "@/lib/authz/entitlements";
import { enqueue, type JobOutcome, type JobRow } from "@/server/jobs/queue";
import { isWithinWindow, loadSettings, nextWindowStart } from "@/server/messaging/settings";
import { renderTemplate, varsFor } from "@/server/messaging/templates";
import { createOutbound, deliver } from "@/server/messaging/send";
import { pickChannel, transportFor, type ChannelPreference } from "@/server/messaging/channel";
import { bookingLinkFor } from "@/server/booking/links";
import { stopEnrollments, type StopCode } from "./stop";

/**
 * Follow-up sequences (Package 2+). docs/MESSAGING.md describes the rules; in short:
 *  - each step is a job; just before sending, EVERY stop rule and permission is checked again;
 *  - each step creates at most one message (idempotency key `seq:<enrollment>:<step>`), and the
 *    enrollment moves to the next step in the SAME transaction that creates the message;
 *  - a step with no permitted channel is skipped (recorded), not sent another way.
 */

export type StepRow = typeof sequenceSteps.$inferSelect;
export type EnrollmentRow = typeof sequenceEnrollments.$inferSelect;
const MIN = 60_000;
/** A follow-up step this late (outage, stopped scheduler) is not sent automatically. */
export const STALE_STEP_MS = 24 * 60 * MIN;

/** Opt-out reasons stop a sequence; a bounced email only makes email unavailable. */
const OPT_OUT_REASONS = ["opt_out_keyword", "unsubscribe_link", "manual", "spam_complaint"];

export async function stepsFor(tx: Tx, sequenceId: string, version: number): Promise<StepRow[]> {
  return tx.select().from(sequenceSteps).where(and(eq(sequenceSteps.sequenceId, sequenceId), eq(sequenceSteps.version, version))).orderBy(asc(sequenceSteps.position));
}

const stepJobKey = (enrollmentId: string, step: number, suffix = "") => `seq:${enrollmentId}:${step}${suffix}`;

export async function enqueueStep(tx: Tx, companyId: string, enrollmentId: string, step: number, runAt: Date, suffix = "") {
  await enqueue(tx, { companyId, kind: "sequence_step", key: stepJobKey(enrollmentId, step, suffix), payload: { enrollmentId, step }, runAt, maxAttempts: 5 });
}

export interface StartInput {
  companyId: string; sequenceId: string; version: number; inquiryId: string; contactId: string;
  origin: "auto" | "manual"; userId?: string | null; actorType: "user" | "support" | "system"; now?: Date; details?: Record<string, unknown>;
}

/** Creates an enrollment and schedules its first step. Returns null if the person already has an open one. */
export async function startEnrollment(tx: Tx, p: StartInput): Promise<string | null> {
  const now = p.now ?? new Date();
  const steps = await stepsFor(tx, p.sequenceId, p.version);
  if (!steps.length) return null;
  const runAt = new Date(now.getTime() + steps[0]!.delayMinutes * MIN);
  const [row] = await tx.insert(sequenceEnrollments).values({
    companyId: p.companyId, sequenceId: p.sequenceId, version: p.version, inquiryId: p.inquiryId, contactId: p.contactId,
    status: "active", nextStep: 0, nextRunAt: runAt, origin: p.origin, enrolledByUserId: p.userId ?? null, enrolledAt: now,
  }).onConflictDoNothing().returning({ id: sequenceEnrollments.id });
  if (!row) return null;
  await enqueueStep(tx, p.companyId, row.id, 0, runAt);
  await tx.insert(inquiryEvents).values({
    companyId: p.companyId, inquiryId: p.inquiryId, type: "follow_up_started", actorUserId: p.userId ?? null, actorType: p.actorType,
    details: { sequenceId: p.sequenceId, version: p.version, origin: p.origin, firstStepAt: runAt.toISOString(), ...p.details },
  });
  return row.id;
}

/** Inside the transaction that records a live, eligible inquiry: start the company's automatic sequence. */
export async function autoEnrollNewLead(tx: Tx, companyId: string, inquiryId: string): Promise<void> {
  const [company] = await tx.select({ package: companies.package }).from(companies).where(eq(companies.id, companyId));
  if (!company || !hasFeature(company.package, "sequences")) return;
  const [seq] = await tx.select().from(sequences).where(and(eq(sequences.companyId, companyId), eq(sequences.autoEnroll, true), eq(sequences.status, "active")));
  if (!seq) return;
  const [i] = await tx.select({ contactId: inquiries.contactId }).from(inquiries).where(eq(inquiries.id, inquiryId));
  if (!i) return;
  const started = await startEnrollment(tx, { companyId, sequenceId: seq.id, version: seq.currentVersion, inquiryId, contactId: i.contactId, origin: "auto", actorType: "system" });
  if (!started) {
    await tx.insert(inquiryEvents).values({ companyId, inquiryId, type: "follow_up_not_started", actorType: "system", details: { reason: "This person is already receiving a follow-up from an earlier inquiry." } });
  }
}

type Decision =
  | { action: "stop"; code: StopCode; reason: string }
  | { action: "wait"; until: Date; reason: string }
  | { action: "skip"; reason: string }
  | { action: "advance" }
  | { action: "send"; channel: "sms" | "email"; to: string; subject: string | null; body: string; transport: string; companyName: string };

/** Every rule, checked immediately before a step is sent (and again after waiting for the window). */
export async function decideStep(tx: Tx, enr: EnrollmentRow, now: Date): Promise<Decision & { steps: StepRow[]; seq: typeof sequences.$inferSelect | null }> {
  const companyId = enr.companyId;
  const base = { steps: [] as StepRow[], seq: null as typeof sequences.$inferSelect | null };
  const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
  if (!company) return { ...base, action: "stop", code: "account", reason: "Company not found" };
  if (!accountPolicy(company, now).automatedSending) return { ...base, action: "stop", code: "account", reason: "The account isn't active for automatic messages" };
  if (!hasFeature(company.package, "sequences")) return { ...base, action: "stop", code: "package", reason: "The package no longer includes follow-up sequences" };
  const settings = await loadSettings(tx, companyId);
  if (settings.automationPaused) return { ...base, action: "stop", code: "paused_all", reason: "All automatic messages were stopped (emergency stop)" };
  const [seq] = await tx.select().from(sequences).where(eq(sequences.id, enr.sequenceId));
  if (!seq || seq.status !== "active") return { ...base, action: "stop", code: "sequence_off", reason: "The sequence was turned off" };
  const withSeq = { steps: [] as StepRow[], seq };

  const [row] = await tx.select({ i: inquiries, c: contacts }).from(inquiries).innerJoin(contacts, eq(contacts.id, inquiries.contactId)).where(eq(inquiries.id, enr.inquiryId));
  if (!row) return { ...withSeq, action: "stop", code: "closed", reason: "The lead no longer exists" };
  const { i, c } = row;
  if (i.stage === "booked") return { ...withSeq, action: "stop", code: "booked", reason: "The lead is booked" };
  if (i.stage === "won" || i.stage === "lost") return { ...withSeq, action: "stop", code: "closed", reason: `The lead was marked ${i.stage}` };

  const [booked] = await tx.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.contactId, c.id), or(
    and(eq(appointments.status, "scheduled"), sql`${appointments.startsAt} > ${now.toISOString()}`),
    gte(appointments.createdAt, enr.enrolledAt),
  ))).limit(1);
  if (booked) return { ...withSeq, action: "stop", code: "booked", reason: "They have an appointment" };

  const [inbound] = await tx.select({ id: messages.id }).from(messages)
    .where(and(eq(messages.contactId, c.id), eq(messages.direction, "inbound"), gte(messages.createdAt, enr.enrolledAt))).limit(1);
  if (inbound) return { ...withSeq, action: "stop", code: "replied", reason: "They replied" };
  if (seq.stopOnManualMessage) {
    const [manual] = await tx.select({ id: messages.id }).from(messages)
      .where(and(eq(messages.contactId, c.id), eq(messages.kind, "manual"), gte(messages.createdAt, enr.enrolledAt))).limit(1);
    if (manual) return { ...withSeq, action: "stop", code: "manual_message", reason: "A team member messaged them" };
  }
  const addresses = [c.phoneE164, c.emailNormalized].filter((a): a is string => Boolean(a));
  if (addresses.length) {
    const [opt] = await tx.select({ id: suppressions.id }).from(suppressions)
      .where(and(eq(suppressions.companyId, companyId), inArray(suppressions.address, addresses), inArray(suppressions.reason, OPT_OUT_REASONS), isNull(suppressions.liftedAt))).limit(1);
    if (opt) return { ...withSeq, action: "stop", code: "opted_out", reason: "They opted out" };
  }

  const steps = await stepsFor(tx, enr.sequenceId, enr.version);
  const s = steps[enr.nextStep];
  if (!s) return { ...withSeq, steps, action: "advance" };
  const ch = await pickChannel(tx, companyId, c, s.channel as ChannelPreference);
  if (!ch.channel) return { ...withSeq, steps, action: "skip", reason: `Step ${enr.nextStep + 1} skipped: ${ch.reasons.join("; ")}` };
  const tr = await transportFor(tx, companyId, company.kind, ch.channel);
  if ("blocked" in tr) return { ...withSeq, steps, action: "stop", code: "sending_off", reason: `Not sent: ${tr.blocked}` };

  if (!isWithinWindow(now, company.timezone, settings)) {
    const next = nextWindowStart(now, company.timezone, settings);
    if (!next) return { ...withSeq, steps, action: "stop", code: "sending_off", reason: "No sending days are allowed" };
    return { ...withSeq, steps, action: "wait", until: next, reason: "Outside the sending window" };
  }

  let bookingLink: string | null = null;
  if (hasFeature(company.package, "booking")) {
    const [b] = await tx.select({ url: bookingSettings.bookingUrl }).from(bookingSettings).where(eq(bookingSettings.companyId, companyId));
    bookingLink = bookingLinkFor(b?.url, i.id, ch.channel === "email" ? { name: c.fullName || null, email: c.email } : undefined);
  }
  const vars = varsFor(c, company.name, i.serviceRequested, { bookingLink });
  const body = ch.channel === "sms" ? s.smsBody : s.emailBody;
  if (!body) return { ...withSeq, steps, action: "skip", reason: `Step ${enr.nextStep + 1} skipped: no ${ch.channel === "sms" ? "text" : "email"} wording` };
  return {
    ...withSeq, steps, action: "send", channel: ch.channel, to: ch.to, transport: tr.transport, companyName: company.name,
    subject: ch.channel === "email" ? renderTemplate(s.emailSubject ?? "", vars) || `Following up — ${company.name}` : null,
    body: renderTemplate(body, vars),
  };
}

/** Moves to the next step (scheduling it), or finishes and hands the lead to a person. */
async function advance(tx: Tx, enr: EnrollmentRow, steps: StepRow[], seq: typeof sequences.$inferSelect, now: Date) {
  const next = enr.nextStep + 1;
  if (next < steps.length) {
    const runAt = new Date(now.getTime() + steps[next]!.delayMinutes * MIN);
    await tx.update(sequenceEnrollments).set({ nextStep: next, nextRunAt: runAt, updatedAt: now }).where(eq(sequenceEnrollments.id, enr.id));
    await enqueueStep(tx, enr.companyId, enr.id, next, runAt);
    return;
  }
  await tx.update(sequenceEnrollments).set({ nextStep: next, status: "completed", nextRunAt: null, endedAt: now, updatedAt: now }).where(eq(sequenceEnrollments.id, enr.id));
  await tx.insert(inquiryEvents).values({ companyId: enr.companyId, inquiryId: enr.inquiryId, type: "follow_up_completed", actorType: "system", details: { sequenceId: enr.sequenceId, steps: steps.length } });
  if (seq.handoffTask) {
    const [row] = await tx.select({ name: contacts.fullName, assigned: inquiries.assignedUserId }).from(inquiries).innerJoin(contacts, eq(contacts.id, inquiries.contactId)).where(eq(inquiries.id, enr.inquiryId));
    await tx.insert(tasks).values({
      companyId: enr.companyId, inquiryId: enr.inquiryId, assignedUserId: row?.assigned ?? null, dueAt: new Date(now.getTime() + 24 * 60 * MIN),
      title: `Call ${row?.name || "this lead"} — automatic follow-up finished without a reply`,
    });
  }
}

export async function handleSequenceStep(job: JobRow, now = new Date()): Promise<JobOutcome> {
  const companyId = job.companyId!;
  const enrollmentId = String(job.payload.enrollmentId);
  const step = Number(job.payload.step);
  const key = stepJobKey(enrollmentId, step);
  const prepared = await withSystemCompanyDb(companyId, "sequences: prepare step", async (tx) => {
    // An earlier attempt may already have created this step's message: never create a second one.
    const [existing] = await tx.select().from(messages).where(and(eq(messages.companyId, companyId), eq(messages.idempotencyKey, key)));
    if (existing) return { kind: "message" as const, message: existing };
    const [enr] = await tx.select().from(sequenceEnrollments).where(eq(sequenceEnrollments.id, enrollmentId)).for("update");
    if (!enr) return { kind: "done" as const, outcome: { status: "cancelled", result: "The follow-up no longer exists" } as JobOutcome };
    if (enr.status !== "active") return { kind: "done" as const, outcome: { status: "cancelled", result: `The follow-up is ${enr.status}` } as JobOutcome };
    if (enr.nextStep !== step) return { kind: "done" as const, outcome: { status: "cancelled", result: "This step was already handled" } as JobOutcome };
    // After an outage, never fire a backlog of follow-ups: a step more than a day late is paused for a person to review.
    if (now.getTime() - job.runAt.getTime() > STALE_STEP_MS) {
      const reason = `Step ${step + 1} was due ${job.runAt.toISOString().slice(0, 16).replace("T", " ")} UTC but couldn't be sent on time; paused so a person can decide`;
      await tx.update(sequenceEnrollments).set({ status: "paused", pausedAt: now, pauseReason: reason, updatedAt: now }).where(eq(sequenceEnrollments.id, enr.id));
      await tx.insert(inquiryEvents).values({ companyId, inquiryId: enr.inquiryId, type: "follow_up_paused", actorType: "system", details: { reason } });
      return { kind: "done" as const, outcome: { status: "cancelled", result: "Paused: step was more than a day late" } as JobOutcome };
    }

    const d = await decideStep(tx, enr, now);
    switch (d.action) {
      case "stop":
        await stopEnrollments(tx, companyId, { enrollmentId }, d.code, d.reason);
        return { kind: "done" as const, outcome: { status: "cancelled", result: d.reason } as JobOutcome };
      case "wait":
        await tx.update(sequenceEnrollments).set({ nextRunAt: d.until, updatedAt: now }).where(eq(sequenceEnrollments.id, enr.id));
        return { kind: "done" as const, outcome: { status: "reschedule", runAt: d.until, result: d.reason } as JobOutcome };
      case "skip":
        await tx.insert(inquiryEvents).values({ companyId, inquiryId: enr.inquiryId, type: "follow_up_step_skipped", actorType: "system", details: { step: step + 1, reason: d.reason } });
        await advance(tx, enr, d.steps, d.seq!, now);
        return { kind: "done" as const, outcome: { status: "succeeded", result: d.reason } as JobOutcome };
      case "advance":
        await advance(tx, enr, d.steps, d.seq!, now);
        return { kind: "done" as const, outcome: { status: "succeeded", result: "No more steps" } as JobOutcome };
      case "send": {
        const { message } = await createOutbound(tx, {
          companyId, contactId: enr.contactId, inquiryId: enr.inquiryId, channel: d.channel, kind: "follow_up", to: d.to, subject: d.subject, body: d.body,
          idempotencyKey: key, templateKey: `sequence:${enr.sequenceId}:step${step + 1}`, templateVersion: enr.version, transport: d.transport, companyName: d.companyName,
        });
        await advance(tx, enr, d.steps, d.seq!, now);
        return { kind: "message" as const, message };
      }
    }
  });
  if (prepared.kind === "done") return prepared.outcome;
  const msg = prepared.message;
  if (msg.status !== "queued") return { status: "succeeded", result: `Already ${msg.status}` };
  const r = await deliver(companyId, msg.id);
  return { status: "succeeded", result: `Message ${r.status}` };
}
