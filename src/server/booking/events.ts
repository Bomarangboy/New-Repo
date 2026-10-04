import { and, desc, eq, inArray, isNotNull, ne, notInArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { withSystemCompanyDb } from "@/lib/db/context";
import { appointments, bookingEvents, bookingSettings, contacts, inquiries, inquiryEvents, jobs } from "@/lib/db/schema";
import { normalizeEmail, normalizePhone } from "@/lib/contact-normalize";
import { enqueue } from "@/server/jobs/queue";
import { recordInquiry, validateInquiry } from "@/server/crm/record-inquiry";
import { stopEnrollments } from "@/server/sequences/stop";
import { inquiryIdFromRef } from "./links";
import { scheduleAppointmentMessages } from "./messages";

/**
 * Booking events from Cal.com (or the simulator, which uses exactly the same code).
 * Rules (docs/BOOKING.md):
 *  - Cal.com is authoritative for its bookings; Bluewater mirrors them. Manual appointments are Bluewater's.
 *  - identical re-deliveries are ignored (body hash); events older than the newest one applied to an
 *    appointment are ignored (out-of-order delivery); a reschedule keeps ONE appointment and remembers the
 *    old booking id, so late events about the old id can't resurrect or cancel it;
 *  - a booking attaches to the inquiry in its link reference, else to the contact with the same email or
 *    phone, else a new lead is recorded (source "Cal.com booking", never auto-messaged).
 *  - booking → lead moves to Booked, follow-ups stop, confirmation/reminders are scheduled, the team is told.
 */
export interface BookingEventInput {
  provider: "calcom" | "simulated";
  trigger: string;
  uid: string | null;
  rescheduleUid?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  title?: string | null;
  location?: string | null;
  attendee?: { name?: string | null; email?: string | null; phone?: string | null; timeZone?: string | null };
  ref?: string | null;
  cancellationReason?: string | null;
  eventCreatedAt?: Date | null;
  bodyHash: string;
}

export type BookingOutcome = "created" | "rescheduled" | "cancelled" | "cancelled_unseen" | "ignored_stale" | "ignored_unknown" | "ping" | "error" | "duplicate";

type Appt = typeof appointments.$inferSelect;
const label = (p: string) => (p === "calcom" ? "Cal.com booking" : "Simulated booking");

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function applyBookingEvent(companyId: string, e: BookingEventInput, now = new Date()): Promise<{ outcome: BookingOutcome; appointmentId?: string; detail?: string }> {
  return withSystemCompanyDb(companyId, "booking: apply event", async (tx) => {
    // One booking event at a time per company: simple, and booking volume is low.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"booking:" + companyId}, 0))`);
    const [dup] = await tx.select({ id: bookingEvents.id }).from(bookingEvents).where(and(eq(bookingEvents.companyId, companyId), eq(bookingEvents.bodyHash, e.bodyHash)));
    if (dup) return { outcome: "duplicate" as const };

    let r: { outcome: BookingOutcome; appointmentId?: string; detail?: string };
    switch (e.trigger) {
      case "PING": r = { outcome: "ping", detail: "Test message received" }; break;
      case "BOOKING_CREATED":
      case "BOOKING_CONFIRMED": r = await created(tx, companyId, e, now); break;
      case "BOOKING_RESCHEDULED": r = await rescheduled(tx, companyId, e, now); break;
      case "BOOKING_CANCELLED":
      case "BOOKING_REJECTED": r = await cancelled(tx, companyId, e, now); break;
      default: r = { outcome: "ignored_unknown", detail: `Event type ${e.trigger.slice(0, 40)} isn't used by Bluewater` };
    }

    await tx.insert(bookingEvents).values({
      companyId, provider: e.provider, triggerEvent: e.trigger.slice(0, 60), externalId: e.uid?.slice(0, 200) ?? null, bodyHash: e.bodyHash,
      outcome: r.outcome, detail: r.detail?.slice(0, 300) ?? null, appointmentId: r.appointmentId ?? null, eventCreatedAt: e.eventCreatedAt ?? null,
    });
    if (e.provider === "calcom") {
      await tx.update(bookingSettings).set({
        status: "connected", lastEventAt: now, updatedAt: now,
        ...(r.outcome === "error" ? { lastError: r.detail ?? "A booking couldn't be processed", lastErrorAt: now } : {}),
      }).where(eq(bookingSettings.companyId, companyId));
    }
    return r;
  });
}

async function byExternal(tx: Tx, companyId: string, source: string, uid: string): Promise<Appt | null> {
  const [a] = await tx.select().from(appointments).where(and(eq(appointments.companyId, companyId), eq(appointments.source, source), eq(appointments.externalId, uid))).for("update");
  return a ?? null;
}
async function replaced(tx: Tx, companyId: string, source: string, uid: string): Promise<Appt | null> {
  const [a] = await tx.select().from(appointments).where(and(eq(appointments.companyId, companyId), eq(appointments.source, source),
    sql`${appointments.replacedExternalIds} @> ${JSON.stringify([uid])}::jsonb`));
  return a ?? null;
}
const isStale = (a: Appt, e: BookingEventInput) => Boolean(a.lastEventAt && e.eventCreatedAt && e.eventCreatedAt < a.lastEventAt);

/** Finds (or records) the lead a booking belongs to. */
async function associate(tx: Tx, companyId: string, e: BookingEventInput, now: Date): Promise<{ inquiryId: string; contactId: string; via: string } | { error: string }> {
  const refId = inquiryIdFromRef(e.ref);
  if (refId) {
    // Row-level security limits this to the company whose signed webhook we're processing.
    const [i] = await tx.select({ id: inquiries.id, contactId: inquiries.contactId }).from(inquiries).where(eq(inquiries.id, refId));
    if (i) return { inquiryId: i.id, contactId: i.contactId, via: "booking link" };
  }
  const email = normalizeEmail(e.attendee?.email);
  const phone = normalizePhone(e.attendee?.phone);
  const em = email && email !== "invalid" ? email.normalized : null;
  const ph = phone && phone !== "invalid" ? phone.e164 : null;
  if (em || ph) {
    const [c] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.companyId, companyId),
      em && ph ? sql`(${contacts.emailNormalized} = ${em} or ${contacts.phoneE164} = ${ph})` : em ? eq(contacts.emailNormalized, em) : eq(contacts.phoneE164, ph!))).limit(1);
    if (c) {
      const [open] = await tx.select({ id: inquiries.id }).from(inquiries).where(and(eq(inquiries.contactId, c.id), notInArray(inquiries.stage, ["won", "lost"]))).orderBy(desc(inquiries.submittedAt)).limit(1);
      const [any] = open ? [open] : await tx.select({ id: inquiries.id }).from(inquiries).where(eq(inquiries.contactId, c.id)).orderBy(desc(inquiries.submittedAt)).limit(1);
      if (any) return { inquiryId: any.id, contactId: c.id, via: em ? "email match" : "phone match" };
    }
  }
  const input = { fullName: e.attendee?.name, email: e.attendee?.email, phone: e.attendee?.phone, serviceRequested: e.title, submittedAt: now };
  const v = validateInquiry(input);
  if (!v.ok) return { error: `Couldn't link the booking to a lead: ${v.problems.join(" ")}` };
  const rec = await recordInquiry(tx, input, { companyId, source: "other", sourceLabel: label(e.provider), automationOrigin: "none", actorType: "system" });
  return { inquiryId: rec.inquiry.id, contactId: rec.contact.id, via: "new lead" };
}

async function created(tx: Tx, companyId: string, e: BookingEventInput, now: Date) {
  const startsAt = parseDate(e.startTime);
  if (!e.uid || !startsAt) return { outcome: "error" as const, detail: "The booking message was missing its id or time" };
  const existing = await byExternal(tx, companyId, e.provider, e.uid);
  if (existing) return { outcome: "ignored_stale" as const, appointmentId: existing.id, detail: "Already recorded" };
  if (await replaced(tx, companyId, e.provider, e.uid)) return { outcome: "ignored_stale" as const, detail: "This booking was already moved to a new time" };
  // Out of order: the cancellation arrived first.
  const [cancelledFirst] = await tx.select({ id: bookingEvents.id }).from(bookingEvents).where(and(eq(bookingEvents.companyId, companyId), eq(bookingEvents.externalId, e.uid), eq(bookingEvents.outcome, "cancelled_unseen")));
  if (cancelledFirst) return { outcome: "ignored_stale" as const, detail: "This booking was cancelled before Bluewater heard about it" };

  const link = await associate(tx, companyId, e, now);
  if ("error" in link) return { outcome: "error" as const, detail: link.error };
  const [appt] = await tx.insert(appointments).values({
    companyId, inquiryId: link.inquiryId, contactId: link.contactId, source: e.provider, externalId: e.uid, status: "scheduled",
    startsAt, endsAt: parseDate(e.endTime), title: e.title?.slice(0, 200) ?? null, location: e.location?.slice(0, 300) ?? null,
    attendeeTimezone: e.attendee?.timeZone?.slice(0, 60) ?? null, lastEventAt: e.eventCreatedAt ?? now,
  }).returning();
  await afterBooked(tx, companyId, appt!, { type: "system" }, now, { notify: true, via: link.via });
  return { outcome: "created" as const, appointmentId: appt!.id, detail: `Linked by ${link.via}` };
}

async function rescheduled(tx: Tx, companyId: string, e: BookingEventInput, now: Date) {
  const startsAt = parseDate(e.startTime);
  if (!e.uid || !startsAt) return { outcome: "error" as const, detail: "The booking message was missing its id or time" };
  if (await byExternal(tx, companyId, e.provider, e.uid)) return { outcome: "ignored_stale" as const, detail: "Already recorded" };
  const old = e.rescheduleUid ? await byExternal(tx, companyId, e.provider, e.rescheduleUid) : null;
  if (!old) return created(tx, companyId, e, now); // we never saw the original booking
  if (isStale(old, e)) return { outcome: "ignored_stale" as const, appointmentId: old.id, detail: "An older message arrived late" };
  const from = old.startsAt;
  const [appt] = await tx.update(appointments).set({
    externalId: e.uid, replacedExternalIds: [...old.replacedExternalIds, old.externalId!].slice(-20), status: "scheduled", startsAt, endsAt: parseDate(e.endTime),
    cancelledAt: null, cancellationReason: null, lastEventAt: e.eventCreatedAt ?? now, updatedAt: now,
  }).where(eq(appointments.id, old.id)).returning();
  await cancelPendingAppointmentMessages(tx, old.id, "The appointment was moved");
  await tx.insert(inquiryEvents).values({ companyId, inquiryId: old.inquiryId, type: "appointment_rescheduled", actorType: "system", details: { appointmentId: old.id, from: from.toISOString(), to: startsAt.toISOString(), source: e.provider } });
  const [i] = await tx.select({ stage: inquiries.stage }).from(inquiries).where(eq(inquiries.id, old.inquiryId));
  if (i && (i.stage === "new" || i.stage === "contacted")) await setStage(tx, companyId, old.inquiryId, i.stage, "booked", "appointment rescheduled");
  await scheduleAppointmentMessages(tx, companyId, appt!, now);
  await enqueue(tx, { companyId, kind: "notify_booking", key: `notify:booking:${old.id}:resched:${startsAt.getTime()}`, payload: { appointmentId: old.id, kind: "booking_rescheduled", refKey: `${old.id}:${startsAt.getTime()}` } });
  return { outcome: "rescheduled" as const, appointmentId: old.id };
}

async function cancelled(tx: Tx, companyId: string, e: BookingEventInput, now: Date) {
  if (!e.uid) return { outcome: "error" as const, detail: "The cancellation was missing the booking id" };
  const appt = await byExternal(tx, companyId, e.provider, e.uid);
  if (!appt) {
    if (await replaced(tx, companyId, e.provider, e.uid)) return { outcome: "ignored_stale" as const, detail: "That booking had already been moved to a new time" };
    return { outcome: "cancelled_unseen" as const, detail: "Cancellation for a booking Bluewater hadn't seen; remembered in case the booking arrives late" };
  }
  if (isStale(appt, e)) return { outcome: "ignored_stale" as const, appointmentId: appt.id, detail: "An older message arrived late" };
  if (appt.status === "cancelled") return { outcome: "ignored_stale" as const, appointmentId: appt.id, detail: "Already cancelled" };
  await cancelAppointmentRow(tx, companyId, appt, e.cancellationReason ?? null, { type: "system" }, now, e.eventCreatedAt ?? now);
  await enqueue(tx, { companyId, kind: "notify_booking", key: `notify:booking:${appt.id}:cancelled`, payload: { appointmentId: appt.id, kind: "booking_cancelled", refKey: `${appt.id}:cancelled` } });
  return { outcome: "cancelled" as const, appointmentId: appt.id };
}

/* ---------------- Shared effects (also used for appointments the team enters) ---------------- */

async function setStage(tx: Tx, companyId: string, inquiryId: string, from: string, to: "booked" | "contacted", reason: string, actor: { userId?: string | null; type: string } = { type: "system" }) {
  await tx.update(inquiries).set({ stage: to, stageChangedAt: new Date() }).where(eq(inquiries.id, inquiryId));
  await tx.insert(inquiryEvents).values({ companyId, inquiryId, type: "stage_changed", actorUserId: actor.userId ?? null, actorType: actor.type, details: { from, to, reason } });
}

export async function afterBooked(tx: Tx, companyId: string, appt: Appt, actor: { userId?: string | null; type: "user" | "support" | "system" }, now: Date, opts: { notify: boolean; via?: string }) {
  const [i] = await tx.select({ stage: inquiries.stage }).from(inquiries).where(eq(inquiries.id, appt.inquiryId));
  if (i && (i.stage === "new" || i.stage === "contacted")) await setStage(tx, companyId, appt.inquiryId, i.stage, "booked", "appointment booked", actor);
  await tx.insert(inquiryEvents).values({
    companyId, inquiryId: appt.inquiryId, type: "appointment_booked", actorUserId: actor.userId ?? null, actorType: actor.type,
    details: { appointmentId: appt.id, startsAt: appt.startsAt.toISOString(), source: appt.source, via: opts.via },
  });
  await stopEnrollments(tx, companyId, { contactId: appt.contactId }, "booked", "They booked an appointment", actor);
  await scheduleAppointmentMessages(tx, companyId, appt, now);
  if (opts.notify) {
    await enqueue(tx, { companyId, kind: "notify_booking", key: `notify:booking:${appt.id}:created`, payload: { appointmentId: appt.id, kind: "booking_created", refKey: `${appt.id}:created` } });
  }
}

export async function cancelAppointmentRow(tx: Tx, companyId: string, appt: Appt, reason: string | null, actor: { userId?: string | null; type: "user" | "support" | "system" }, now: Date, eventAt?: Date) {
  await tx.update(appointments).set({ status: "cancelled", cancelledAt: now, cancellationReason: reason?.slice(0, 300) ?? null, lastEventAt: eventAt ?? appt.lastEventAt, updatedAt: now }).where(eq(appointments.id, appt.id));
  await cancelPendingAppointmentMessages(tx, appt.id, "The appointment was cancelled");
  await tx.insert(inquiryEvents).values({ companyId, inquiryId: appt.inquiryId, type: "appointment_cancelled", actorUserId: actor.userId ?? null, actorType: actor.type, details: { appointmentId: appt.id, startsAt: appt.startsAt.toISOString(), reason } });
  // Back to Contacted only if nothing else is booked for this inquiry (follow-ups are NOT restarted).
  const [i] = await tx.select({ stage: inquiries.stage }).from(inquiries).where(eq(inquiries.id, appt.inquiryId));
  const [other] = await tx.select({ id: appointments.id }).from(appointments)
    .where(and(eq(appointments.inquiryId, appt.inquiryId), eq(appointments.status, "scheduled"), ne(appointments.id, appt.id))).limit(1);
  if (i?.stage === "booked" && !other) await setStage(tx, companyId, appt.inquiryId, "booked", "contacted", "appointment cancelled", actor);
}

export async function cancelPendingAppointmentMessages(tx: Tx, appointmentId: string, reason: string) {
  await tx.update(jobs).set({ status: "cancelled", result: reason, finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(jobs.kind, "booking_message"), inArray(jobs.status, ["queued"]), isNotNull(jobs.payload), sql`${jobs.payload}->>'appointmentId' = ${appointmentId}`));
}
