import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { withCompanyDb } from "@/lib/db/context";
import { appointments, contacts, inquiries, inquiryEvents } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { isSimulatedEnvironment } from "@/lib/env";
import { roleCan, type Action } from "@/lib/authz/permissions";
import { hasFeature } from "@/lib/authz/entitlements";
import type { CompanyContext } from "@/lib/authz/context-types";
import { cleanText } from "@/lib/contact-normalize";
import { zonedDateTime } from "@/lib/periods";
import { afterBooked, applyBookingEvent, cancelAppointmentRow } from "./events";
import { refFromInquiryId } from "./links";

function need(ctx: CompanyContext, action: Action) {
  if (!roleCan(ctx.role, action)) throw new UserError("You don't have permission to do that.");
  if (!hasFeature(ctx.package, "appointments")) throw new UserError("Appointments are part of Package 2. Contact Bluewater to upgrade.");
  if (!action.endsWith(".view") && ctx.policy.login !== "full") throw new UserError("This account is read-only right now, so changes can't be saved.");
}
const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const actorType = (ctx: CompanyContext) => (ctx.supportGrantId ? "support" : "user") as "support" | "user";

export const SOURCE_NAMES: Record<string, string> = { calcom: "Cal.com", manual: "Entered by your team", simulated: "Simulated" };

/** "2026-10-08" + "14:30" in the business's timezone → instant (DST-correct). */
export function localToInstant(date: string, time: string, tz: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!d || !t) return null;
  const [y, m, day, h, min] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  if (m < 1 || m > 12 || day < 1 || day > 31 || h > 23 || min > 59) return null;
  return zonedDateTime(y, m, day, h * 60 + min, tz);
}

/** "YYYY-MM-DD" a few days from now in the business's timezone (form defaults). */
export function localDateInDays(tz: string, days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() + days * 86_400_000));
}

export async function listAppointments(ctx: CompanyContext, when: "upcoming" | "past", limit = 100) {
  need(ctx, "appointment.view");
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const rows = await withCompanyDb(ctx, (tx) =>
    tx.select({ a: appointments, name: contacts.fullName, phone: contacts.phone, email: contacts.email, service: inquiries.serviceRequested })
      .from(appointments).innerJoin(contacts, eq(contacts.id, appointments.contactId)).innerJoin(inquiries, eq(inquiries.id, appointments.inquiryId))
      .where(when === "upcoming" ? and(gte(appointments.startsAt, sql`${now}`), eq(appointments.status, "scheduled")) : sql`not (${appointments.startsAt} >= ${now} and ${appointments.status} = 'scheduled')`)
      .orderBy(when === "upcoming" ? asc(appointments.startsAt) : desc(appointments.startsAt)).limit(limit));
  return rows.map((r) => ({ ...r, started: r.a.startsAt <= nowDate }));
}

export async function upcomingAppointments(ctx: CompanyContext, days = 7, limit = 5) {
  if (!roleCan(ctx.role, "appointment.view") || !hasFeature(ctx.package, "appointments")) return null;
  const now = new Date();
  const until = new Date(now.getTime() + days * 86_400_000);
  return withCompanyDb(ctx, async (tx) => {
    const where = and(eq(appointments.status, "scheduled"), gte(appointments.startsAt, now), lt(appointments.startsAt, until));
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(appointments).where(where)) as [{ n: number }];
    const next = await tx.select({ id: appointments.id, inquiryId: appointments.inquiryId, startsAt: appointments.startsAt, source: appointments.source, name: contacts.fullName, title: appointments.title })
      .from(appointments).innerJoin(contacts, eq(contacts.id, appointments.contactId)).where(where).orderBy(asc(appointments.startsAt)).limit(limit);
    return { total: n, next };
  });
}

export async function appointmentsForInquiry(ctx: CompanyContext, inquiryId: string) {
  if (!isId(inquiryId)) return null;
  if (!roleCan(ctx.role, "appointment.view") || !hasFeature(ctx.package, "appointments")) return null;
  return withCompanyDb(ctx, (tx) => tx.select().from(appointments).where(eq(appointments.inquiryId, inquiryId)).orderBy(desc(appointments.startsAt)));
}

/** An appointment booked outside the booking tool (e.g. by phone). Bluewater is the record for these. */
export async function createManualAppointment(ctx: CompanyContext, input: { inquiryId: string; date: string; time: string; durationMinutes: number; title?: string; location?: string }, requestId?: string) {
  need(ctx, "appointment.manage");
  if (!isId(input.inquiryId)) throw new UserError("Not found.");
  const startsAt = localToInstant(input.date, input.time, ctx.timezone);
  if (!startsAt) throw new UserError("Choose a date and time.");
  if (startsAt.getTime() < Date.now() - 7 * 86_400_000) throw new UserError("That date is more than a week ago. Use a note to record past visits.");
  const dur = Math.round(input.durationMinutes);
  if (!(dur >= 5 && dur <= 12 * 60)) throw new UserError("Length must be between 5 minutes and 12 hours.");
  return withCompanyDb(ctx, async (tx) => {
    const [i] = await tx.select().from(inquiries).where(eq(inquiries.id, input.inquiryId));
    if (!i) throw new UserError("Lead not found.");
    const now = new Date();
    const [appt] = await tx.insert(appointments).values({
      companyId: ctx.companyId, inquiryId: i.id, contactId: i.contactId, source: "manual", status: "scheduled", startsAt,
      endsAt: new Date(startsAt.getTime() + dur * 60_000), title: cleanText(input.title, 200), location: cleanText(input.location, 300), createdByUserId: ctx.userId, lastEventAt: now,
    }).returning();
    await afterBooked(tx, ctx.companyId, appt!, { userId: ctx.userId, type: actorType(ctx) }, now, { notify: false, via: "entered by team" });
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "appointment.created", targetType: "appointment", targetId: appt!.id, details: { inquiryId: i.id }, requestId });
    return appt!.id;
  });
}

/** Completed / no-show is Bluewater's own outcome record (also for Cal.com bookings). */
export async function setAppointmentOutcome(ctx: CompanyContext, appointmentId: string, outcome: "completed" | "no_show") {
  need(ctx, "appointment.manage");
  if (!isId(appointmentId)) throw new UserError("Not found.");
  return withCompanyDb(ctx, async (tx) => {
    const [a] = await tx.select().from(appointments).where(eq(appointments.id, appointmentId)).for("update");
    if (!a) throw new UserError("Appointment not found.");
    if (a.status === "cancelled") throw new UserError("This appointment was cancelled.");
    if (a.startsAt.getTime() > Date.now()) throw new UserError("You can record the outcome once the appointment has started.");
    await tx.update(appointments).set({ status: outcome, updatedAt: new Date() }).where(eq(appointments.id, a.id));
    await tx.insert(inquiryEvents).values({ companyId: ctx.companyId, inquiryId: a.inquiryId, type: "appointment_outcome", actorUserId: ctx.userId, actorType: actorType(ctx), details: { appointmentId: a.id, outcome } });
  });
}

/** Only appointments Bluewater owns can be cancelled here; Cal.com bookings are cancelled in Cal.com. */
export async function cancelAppointment(ctx: CompanyContext, appointmentId: string, reason: string) {
  need(ctx, "appointment.manage");
  if (!isId(appointmentId)) throw new UserError("Not found.");
  return withCompanyDb(ctx, async (tx) => {
    const [a] = await tx.select().from(appointments).where(eq(appointments.id, appointmentId)).for("update");
    if (!a) throw new UserError("Appointment not found.");
    if (a.source === "calcom") throw new UserError("This was booked through Cal.com — cancel it there (so the customer is told) and Bluewater will update automatically.");
    if (a.status !== "scheduled") throw new UserError("Only scheduled appointments can be cancelled.");
    await cancelAppointmentRow(tx, ctx.companyId, a, cleanText(reason, 300), { userId: ctx.userId, type: actorType(ctx) }, new Date());
  });
}

/* ---------------- Simulator (development, test and demo only) ---------------- */

export function simulationAllowed(ctx: CompanyContext): boolean {
  return isSimulatedEnvironment() || ctx.companyKind !== "customer";
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/** Pretends the lead booked through the booking page. Runs the same code as a real Cal.com webhook. */
export async function simulateBooking(ctx: CompanyContext, inquiryId: string, date: string, time: string) {
  need(ctx, "appointment.manage");
  if (!isId(inquiryId)) throw new UserError("Not found.");
  if (!simulationAllowed(ctx)) throw new UserError("Simulation isn't available here.");
  const startsAt = localToInstant(date, time, ctx.timezone);
  if (!startsAt || startsAt.getTime() <= Date.now()) throw new UserError("Choose a future date and time.");
  const lead = await withCompanyDb(ctx, async (tx) => {
    const [r] = await tx.select({ name: contacts.fullName, email: contacts.email, phone: contacts.phone, service: inquiries.serviceRequested })
      .from(inquiries).innerJoin(contacts, eq(contacts.id, inquiries.contactId)).where(eq(inquiries.id, inquiryId));
    return r ?? null;
  });
  if (!lead) throw new UserError("Lead not found.");
  const uid = `sim_${crypto.randomUUID()}`;
  return applyBookingEvent(ctx.companyId, {
    provider: "simulated", trigger: "BOOKING_CREATED", uid, startTime: startsAt.toISOString(), endTime: new Date(startsAt.getTime() + 3600_000).toISOString(),
    title: lead.service ? `Estimate: ${lead.service}` : "Appointment", attendee: { name: lead.name, email: lead.email, phone: lead.phone, timeZone: ctx.timezone },
    ref: refFromInquiryId(inquiryId), eventCreatedAt: new Date(), bodyHash: hash(uid + ":created"),
  });
}

export async function simulateBookingChange(ctx: CompanyContext, appointmentId: string, change: "cancel" | "reschedule", date?: string, time?: string) {
  need(ctx, "appointment.manage");
  if (!isId(appointmentId)) throw new UserError("Not found.");
  if (!simulationAllowed(ctx)) throw new UserError("Simulation isn't available here.");
  const a = await withCompanyDb(ctx, async (tx) => (await tx.select().from(appointments).where(and(eq(appointments.id, appointmentId), inArray(appointments.source, ["simulated"]))))[0] ?? null);
  if (!a?.externalId) throw new UserError("Only simulated bookings can be changed this way.");
  if (change === "cancel") {
    return applyBookingEvent(ctx.companyId, { provider: "simulated", trigger: "BOOKING_CANCELLED", uid: a.externalId, cancellationReason: "Simulated cancellation", eventCreatedAt: new Date(), bodyHash: hash(a.externalId + ":cancel") });
  }
  const startsAt = localToInstant(date ?? "", time ?? "", ctx.timezone);
  if (!startsAt || startsAt.getTime() <= Date.now()) throw new UserError("Choose a future date and time.");
  const uid = `sim_${crypto.randomUUID()}`;
  return applyBookingEvent(ctx.companyId, {
    provider: "simulated", trigger: "BOOKING_RESCHEDULED", uid, rescheduleUid: a.externalId, startTime: startsAt.toISOString(),
    endTime: new Date(startsAt.getTime() + 3600_000).toISOString(), eventCreatedAt: new Date(), bodyHash: hash(uid + ":resched"),
  });
}
