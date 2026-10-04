import { and, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { withSystemCompanyDb } from "@/lib/db/context";
import { appointments, companies, contacts, inquiries, messages } from "@/lib/db/schema";
import { accountPolicy } from "@/lib/authz/account-policy";
import { hasFeature } from "@/lib/authz/entitlements";
import { enqueue, type JobOutcome, type JobRow } from "@/server/jobs/queue";
import { activeTemplate, isWithinWindow, loadSettings, nextWindowStart } from "@/server/messaging/settings";
import { renderTemplate, varsFor, type TemplateKey } from "@/server/messaging/templates";
import { createOutbound, deliver } from "@/server/messaging/send";
import { pickChannel, transportFor } from "@/server/messaging/channel";
import { formatAppointmentTime } from "./links";
import { loadBookingSettings } from "./settings";

/**
 * Appointment confirmations and reminders. Each is a job keyed by the appointment AND its start time,
 * so moving an appointment schedules new ones and the old ones cancel themselves. Just before sending
 * we check again: still scheduled, same time, in the future, account and package allow it, emergency
 * stop off, permission to text (or email) and no opt-out, and inside sending hours.
 *
 * Avoiding duplicates with Cal.com (D-27): Cal.com already emails its own confirmation, so for Cal.com
 * bookings Bluewater sends TEXTS, and emails only if the owner turns on "also email". Appointments the
 * team enters by hand get an email when texting isn't allowed (nobody else would remind them).
 */
type Appt = typeof appointments.$inferSelect;
const MIN = 60_000;
/** A reminder that would arrive later than this before the appointment isn't worth sending. */
const LATEST_BEFORE_START_MS = 30 * MIN;

export async function scheduleAppointmentMessages(tx: Tx, companyId: string, appt: Appt, now: Date) {
  const s = await loadBookingSettings(tx, companyId);
  const t = appt.startsAt.getTime();
  if (t <= now.getTime()) return;
  const base = { appointmentId: appt.id, startsAt: appt.startsAt.toISOString() };
  if (s.confirmationsEnabled) {
    await enqueue(tx, { companyId, kind: "booking_message", key: `bconfirm:${appt.id}:${t}`, payload: { ...base, type: "confirmation" }, runAt: now });
  }
  if (s.remindersEnabled) {
    for (const off of s.reminderOffsetsMinutes) {
      const runAt = new Date(t - off * MIN);
      if (runAt.getTime() <= now.getTime() + 5 * MIN) continue; // booked too close for this reminder
      await enqueue(tx, { companyId, kind: "booking_message", key: `bremind:${appt.id}:${off}:${t}`, payload: { ...base, type: "reminder", offsetMinutes: off }, runAt });
    }
  }
}

type Decision =
  | { action: "cancel"; reason: string }
  | { action: "wait"; until: Date; reason: string }
  | { action: "send"; channel: "sms" | "email"; to: string; subject: string | null; body: string; transport: string; companyName: string; templateKey: string; templateVersion: number; appt: Appt };

export async function decideBookingMessage(tx: Tx, companyId: string, p: { appointmentId: string; startsAt: string; type: "confirmation" | "reminder" }, now: Date): Promise<Decision> {
  const [appt] = await tx.select().from(appointments).where(eq(appointments.id, p.appointmentId));
  if (!appt) return { action: "cancel", reason: "The appointment no longer exists" };
  if (appt.status !== "scheduled") return { action: "cancel", reason: `The appointment is ${appt.status.replace("_", "-")}` };
  if (appt.startsAt.toISOString() !== p.startsAt) return { action: "cancel", reason: "The appointment was moved (a new message is scheduled)" };
  if (appt.startsAt <= now) return { action: "cancel", reason: "The appointment time has passed" };
  const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
  if (!company || !accountPolicy(company, now).automatedSending) return { action: "cancel", reason: "The account isn't active for automatic messages" };
  if (!hasFeature(company.package, "booking")) return { action: "cancel", reason: "The package doesn't include booking messages" };
  const settings = await loadSettings(tx, companyId);
  if (settings.automationPaused) return { action: "cancel", reason: "Automatic messages are paused for this account" };
  const bs = await loadBookingSettings(tx, companyId);
  if (p.type === "confirmation" && !bs.confirmationsEnabled) return { action: "cancel", reason: "Confirmations are turned off" };
  if (p.type === "reminder" && !bs.remindersEnabled) return { action: "cancel", reason: "Reminders are turned off" };

  const [row] = await tx.select({ c: contacts, i: inquiries }).from(contacts).innerJoin(inquiries, eq(inquiries.id, appt.inquiryId)).where(eq(contacts.id, appt.contactId));
  if (!row) return { action: "cancel", reason: "The contact no longer exists" };
  const emailOk = bs.emailAlso || appt.source !== "calcom";
  const ch = await pickChannel(tx, companyId, row.c, emailOk ? "sms_or_email" : "sms");
  if (!ch.channel) return { action: "cancel", reason: `Not sent: ${ch.reasons.join("; ")}${emailOk ? "" : " (Cal.com emails them itself)"}` };
  const tr = await transportFor(tx, companyId, company.kind, ch.channel);
  if ("blocked" in tr) return { action: "cancel", reason: `Not sent: ${tr.blocked}` };

  if (!isWithinWindow(now, company.timezone, settings)) {
    const next = nextWindowStart(now, company.timezone, settings);
    if (!next || next.getTime() > appt.startsAt.getTime() - LATEST_BEFORE_START_MS) return { action: "cancel", reason: "Outside sending hours, and the next opening is too close to the appointment" };
    return { action: "wait", until: next, reason: "Outside the sending window" };
  }

  const key = `booking_${p.type === "confirmation" ? "confirm" : "reminder"}_${ch.channel}` as TemplateKey;
  const tpl = await activeTemplate(tx, companyId, key);
  const vars = varsFor(row.c, company.name, row.i.serviceRequested, { appointmentTime: formatAppointmentTime(appt.startsAt, company.timezone) });
  return {
    action: "send", channel: ch.channel, to: ch.to, transport: tr.transport, companyName: company.name, templateKey: key, templateVersion: tpl.version, appt,
    subject: tpl.subject ? renderTemplate(tpl.subject, vars) : null, body: renderTemplate(tpl.body, vars),
  };
}

export async function handleBookingMessage(job: JobRow, now = new Date()): Promise<JobOutcome> {
  const companyId = job.companyId!;
  const p = { appointmentId: String(job.payload.appointmentId), startsAt: String(job.payload.startsAt), type: job.payload.type === "reminder" ? "reminder" as const : "confirmation" as const };
  const key = job.idempotencyKey;
  const prepared = await withSystemCompanyDb(companyId, "booking: prepare message", async (tx) => {
    const [existing] = await tx.select().from(messages).where(and(eq(messages.companyId, companyId), eq(messages.idempotencyKey, key)));
    if (existing) return { kind: "message" as const, message: existing };
    const d = await decideBookingMessage(tx, companyId, p, now);
    if (d.action !== "send") return { kind: "decision" as const, d };
    const { message } = await createOutbound(tx, {
      companyId, contactId: d.appt.contactId, inquiryId: d.appt.inquiryId, channel: d.channel, kind: p.type === "reminder" ? "booking_reminder" : "booking_confirmation",
      to: d.to, subject: d.subject, body: d.body, idempotencyKey: key, templateKey: d.templateKey, templateVersion: d.templateVersion, transport: d.transport, companyName: d.companyName,
    });
    return { kind: "message" as const, message };
  });
  if (prepared.kind === "decision") {
    const d = prepared.d;
    if (d.action === "wait") return { status: "reschedule", runAt: d.until, result: d.reason };
    return { status: "cancelled", result: d.action === "cancel" ? d.reason : "cancelled" };
  }
  if (prepared.message.status !== "queued") return { status: "succeeded", result: `Already ${prepared.message.status}` };
  const r = await deliver(companyId, prepared.message.id);
  return { status: "succeeded", result: `Message ${r.status}` };
}
