import { and, desc, eq, isNull } from "drizzle-orm";
import { withSystemCompanyDb } from "@/lib/db/context";
import { appointments, companies, contacts, conversations, inquiries, memberships, notifications, users } from "@/lib/db/schema";
import { formatAppointmentTime } from "@/server/booking/links";
import { env } from "@/lib/env";
import { sendSystemEmail } from "@/lib/system-email";
import type { JobOutcome, JobRow } from "@/server/jobs/queue";
import { loadSettings } from "./settings";

/**
 * Team alerts are Bluewater's own service emails (not messages to the client's customers) plus an
 * in-app record. Recipients: the company's chosen list, else the lead's assignee, else every owner.
 * One alert per person per event (unique index), so retries never double-notify.
 */
type Kind = "new_lead" | "reply" | "ack_problem" | "booking_created" | "booking_rescheduled" | "booking_cancelled";

async function recipients(companyId: string, assignedUserId: string | null): Promise<{ id: string; email: string }[]> {
  return withSystemCompanyDb(companyId, "notifications: recipients", async (tx) => {
    const settings = await loadSettings(tx, companyId);
    const active = await tx.select({ id: users.id, email: users.email, role: memberships.role }).from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.companyId, companyId), eq(memberships.status, "active"), eq(users.status, "active")));
    if (settings.notifyUserIds.length) return active.filter((u) => settings.notifyUserIds.includes(u.id));
    if (assignedUserId) { const a = active.find((u) => u.id === assignedUserId); if (a) return [a]; }
    return active.filter((u) => u.role === "owner");
  });
}

async function notify(companyId: string, kind: Kind, p: { inquiryId?: string | null; conversationId?: string | null; refKey?: string | null; assignedUserId: string | null; title: string; text: string; link: string }) {
  const people = await recipients(companyId, p.assignedUserId);
  let failures = 0;
  for (const person of people) {
    const fresh = await withSystemCompanyDb(companyId, "notifications: record", async (tx) => {
      const rows = await tx.insert(notifications).values({
        companyId, userId: person.id, kind, inquiryId: p.inquiryId ?? null, conversationId: p.conversationId ?? null, refKey: p.refKey ?? null, title: p.title, emailStatus: "pending",
      }).onConflictDoNothing().returning({ id: notifications.id });
      if (rows[0]) return rows[0].id;
      // Retry after a crash: resend only if the earlier email didn't go out.
      const [prev] = await tx.select().from(notifications).where(and(eq(notifications.companyId, companyId), eq(notifications.userId, person.id), eq(notifications.kind, kind),
        p.inquiryId ? eq(notifications.inquiryId, p.inquiryId) : isNull(notifications.inquiryId), p.conversationId ? eq(notifications.conversationId, p.conversationId) : isNull(notifications.conversationId),
        p.refKey ? eq(notifications.refKey, p.refKey) : isNull(notifications.refKey)));
      return prev && prev.emailStatus !== "sent" ? prev.id : null;
    });
    if (!fresh) continue;
    let status = "sent";
    try {
      await sendSystemEmail({ to: person.email, subject: p.title, text: `${p.text}\n\nOpen in Bluewater: ${env().APP_BASE_URL}${p.link}\n\nYou receive these alerts because you're on this team in Bluewater Collective.` });
    } catch {
      status = "failed";
      failures++;
    }
    await withSystemCompanyDb(companyId, "notifications: update", (tx) => tx.update(notifications).set({ emailStatus: status }).where(eq(notifications.id, fresh)));
  }
  return { people: people.length, failures };
}

async function inquiryInfo(companyId: string, inquiryId: string) {
  return withSystemCompanyDb(companyId, "notifications: load lead", async (tx) => {
    const [r] = await tx.select({ name: contacts.fullName, email: contacts.email, phone: contacts.phone, service: inquiries.serviceRequested, source: inquiries.sourceLabel, assigned: inquiries.assignedUserId, company: companies.name })
      .from(inquiries).innerJoin(contacts, eq(contacts.id, inquiries.contactId)).innerJoin(companies, eq(companies.id, inquiries.companyId)).where(eq(inquiries.id, inquiryId));
    return r ?? null;
  });
}

const outcome = (r: { people: number; failures: number }): JobOutcome =>
  r.failures > 0 ? { status: "retry", error: `${r.failures} alert email(s) failed` } : { status: "succeeded", result: `${r.people} notified` };

export async function handleNotifyNewLead(job: JobRow): Promise<JobOutcome> {
  const inquiryId = String(job.payload.inquiryId);
  const info = await inquiryInfo(job.companyId!, inquiryId);
  if (!info) return { status: "cancelled", result: "Lead no longer exists" };
  const who = info.name || info.email || info.phone || "Someone";
  return outcome(await notify(job.companyId!, "new_lead", {
    inquiryId, assignedUserId: info.assigned, link: `/app/leads/${inquiryId}`,
    title: `New lead for ${info.company}: ${who}`,
    text: `${who} just sent an inquiry${info.service ? ` about ${info.service}` : ""}${info.source ? ` (${info.source})` : ""}.`,
  }));
}

export async function handleNotifyAckProblem(job: JobRow): Promise<JobOutcome> {
  const inquiryId = String(job.payload.inquiryId);
  const info = await inquiryInfo(job.companyId!, inquiryId);
  if (!info) return { status: "cancelled", result: "Lead no longer exists" };
  const who = info.name || info.email || info.phone || "a new lead";
  return outcome(await notify(job.companyId!, "ack_problem", {
    inquiryId, assignedUserId: info.assigned, link: `/app/leads/${inquiryId}`,
    title: `Please contact ${who} personally`, text: `${String(job.payload.detail ?? "No automatic acknowledgment was sent.")} Please reach out to ${who} yourself.`,
  }));
}

export async function handleNotifyReply(job: JobRow): Promise<JobOutcome> {
  const conversationId = String(job.payload.conversationId);
  const info = await withSystemCompanyDb(job.companyId!, "notifications: load conversation", async (tx) => {
    const [c] = await tx.select({ name: contacts.fullName, email: contacts.email, phone: contacts.phone, contactId: contacts.id, needsReply: conversations.needsReply })
      .from(conversations).innerJoin(contacts, eq(contacts.id, conversations.contactId)).where(eq(conversations.id, conversationId));
    if (!c) return null;
    const [latest] = await tx.select({ assigned: inquiries.assignedUserId }).from(inquiries).where(eq(inquiries.contactId, c.contactId)).orderBy(desc(inquiries.submittedAt)).limit(1);
    return { ...c, assigned: latest?.assigned ?? null };
  });
  if (!info) return { status: "cancelled", result: "Conversation no longer exists" };
  if (!info.needsReply) return { status: "cancelled", result: "Already answered" };
  const who = info.name || info.phone || info.email || "A contact";
  return outcome(await notify(job.companyId!, "reply", {
    conversationId, assignedUserId: info.assigned, link: `/app/conversations/${conversationId}`,
    title: `${who} replied`, text: `${who} sent a new message. Automatic follow-up for this person is paused so a person can answer.`,
  }));
}

/** Booking created / moved / cancelled — the team hears about it once per change. */
export async function handleNotifyBooking(job: JobRow): Promise<JobOutcome> {
  const companyId = job.companyId!;
  const kind = String(job.payload.kind) as "booking_created" | "booking_rescheduled" | "booking_cancelled";
  const info = await withSystemCompanyDb(companyId, "notifications: load appointment", async (tx) => {
    const [r] = await tx.select({ a: appointments, name: contacts.fullName, email: contacts.email, phone: contacts.phone, assigned: inquiries.assignedUserId, company: companies.name, tz: companies.timezone })
      .from(appointments).innerJoin(contacts, eq(contacts.id, appointments.contactId)).innerJoin(inquiries, eq(inquiries.id, appointments.inquiryId))
      .innerJoin(companies, eq(companies.id, appointments.companyId)).where(eq(appointments.id, String(job.payload.appointmentId)));
    return r ?? null;
  });
  if (!info) return { status: "cancelled", result: "Appointment no longer exists" };
  const who = info.name || info.email || info.phone || "A lead";
  const when = formatAppointmentTime(info.a.startsAt, info.tz);
  const src = info.a.source === "simulated" ? " (simulated)" : "";
  const title = kind === "booking_created" ? `${who} booked ${when}${src}` : kind === "booking_rescheduled" ? `${who} moved their appointment to ${when}${src}` : `${who} cancelled their appointment${src}`;
  const text = kind === "booking_cancelled"
    ? `${who} cancelled the appointment on ${when}${info.a.cancellationReason ? ` (reason: ${info.a.cancellationReason})` : ""}. Automatic follow-up does not restart; reach out if you'd like to rebook.`
    : `${title}. Automatic follow-up for this person has stopped.`;
  return outcome(await notify(companyId, kind, { inquiryId: info.a.inquiryId, refKey: String(job.payload.refKey ?? info.a.id), assignedUserId: info.assigned, link: `/app/leads/${info.a.inquiryId}`, title, text }));
}

export async function unreadNotificationCount(companyId: string, userId: string): Promise<number> {
  return withSystemCompanyDb(companyId, "notifications: count", async (tx) => {
    const rows = await tx.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return rows.length;
  });
}
