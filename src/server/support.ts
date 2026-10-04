import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { withCompanyDb, withPlatformDb, withSystemDb } from "@/lib/db/context";
import { companies, incidentNotices, memberships, supportTicketMessages, supportTickets, users } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { UserError } from "@/lib/errors";
import { roleCan } from "@/lib/authz/permissions";
import type { CompanyContext, PlatformContext } from "@/lib/authz/context-types";
import { cleanMultiline, cleanText } from "@/lib/contact-normalize";
import { sendSystemEmail } from "@/lib/system-email";

/**
 * Customer support tickets (docs/SUPPORT.md). Each ticket belongs to one company (row-level security), has a
 * reference like BW-1042, an owner at Bluewater and a status. Bluewater's internal notes are hidden from the
 * client by the database itself, not just the screen.
 */
export const TICKET_STATUSES = ["open", "waiting_on_customer", "resolved", "closed"] as const;
export const STATUS_LABELS: Record<string, string> = { open: "Open — with Bluewater", waiting_on_customer: "Waiting for your reply", resolved: "Resolved", closed: "Closed" };
export const CATEGORIES = { question: "Question", problem: "Something isn't working", billing: "Billing", urgent: "Urgent — leads or messages affected" } as const;
const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

async function emailAdmins(subject: string, text: string) {
  const admins = await withSystemDb("support: admins", (tx) => tx.select({ email: users.email }).from(users).where(and(eq(users.isPlatformAdmin, true), eq(users.status, "active"))));
  for (const a of admins) await sendSystemEmail({ to: a.email, subject, text }).catch(() => undefined);
}

function need(ctx: CompanyContext) {
  if (!roleCan(ctx.role, "support.request")) throw new UserError("You don't have permission to do that.");
  if (ctx.policy.login === "none") throw new UserError("This account can't be used right now.");
}

/* ---------------- Client side ---------------- */

export async function createTicket(ctx: CompanyContext, input: { subject: string; category: string; body: string }): Promise<{ id: string; reference: string }> {
  need(ctx);
  const subject = cleanText(input.subject, 150);
  const body = cleanMultiline(input.body, 5000);
  const category = input.category in CATEGORIES ? input.category : "question";
  if (!subject || !body) throw new UserError("Add a short subject and describe what you need.");
  const t = await withCompanyDb(ctx, async (tx) => {
    const [{ n }] = (await tx.execute<{ n: string }>(sql`select nextval('app.ticket_ref_seq')::text as n`)) as unknown as [{ n: string }];
    const reference = `BW-${n}`;
    const [row] = await tx.insert(supportTickets).values({ companyId: ctx.companyId, reference, subject, category, createdByUserId: ctx.userId }).returning();
    await tx.insert(supportTicketMessages).values({ companyId: ctx.companyId, ticketId: row!.id, authorUserId: ctx.userId, authorType: "customer", body });
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: ctx.supportGrantId ? "support" : "user", action: "support.ticket_created", targetType: "ticket", targetId: reference });
    return { id: row!.id, reference };
  });
  await emailAdmins(`${category === "urgent" ? "URGENT " : ""}${t.reference} from ${ctx.companyName}: ${subject}`,
    `${CATEGORIES[category as keyof typeof CATEGORIES]}\n\n${body}\n\nOpen: ${env().APP_BASE_URL}/admin/support/${t.id}`);
  return t;
}

export async function listMyTickets(ctx: CompanyContext) {
  need(ctx);
  return withCompanyDb(ctx, (tx) => tx.select().from(supportTickets).orderBy(desc(supportTickets.lastActivityAt)).limit(50));
}

export async function getMyTicket(ctx: CompanyContext, id: string) {
  need(ctx);
  if (!isId(id)) return null;
  return withCompanyDb(ctx, async (tx) => {
    const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, id));
    if (!t) return null;
    // Row-level security returns only non-internal messages here.
    const msgs = await tx.select({ m: supportTicketMessages, name: users.fullName }).from(supportTicketMessages).leftJoin(users, eq(users.id, supportTicketMessages.authorUserId))
      .where(eq(supportTicketMessages.ticketId, id)).orderBy(asc(supportTicketMessages.createdAt));
    return { ticket: t, messages: msgs };
  });
}

export async function replyToMyTicket(ctx: CompanyContext, id: string, bodyRaw: string) {
  need(ctx);
  const body = cleanMultiline(bodyRaw, 5000);
  if (!body) throw new UserError("Write a reply first.");
  if (!isId(id)) throw new UserError("Ticket not found.");
  const t = await withCompanyDb(ctx, async (tx) => {
    const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, id)).for("update");
    if (!t) throw new UserError("Ticket not found.");
    if (t.status === "closed") throw new UserError("This ticket is closed. Open a new one and mention its reference.");
    await tx.insert(supportTicketMessages).values({ companyId: ctx.companyId, ticketId: id, authorUserId: ctx.userId, authorType: "customer", body });
    await tx.update(supportTickets).set({ status: "open", lastActivityAt: new Date(), updatedAt: new Date() }).where(eq(supportTickets.id, id));
    return t;
  });
  await emailAdmins(`${t.reference} reply from ${ctx.companyName}`, `${body}\n\nOpen: ${env().APP_BASE_URL}/admin/support/${id}`);
}

/* ---------------- Bluewater side ---------------- */

export async function listTicketsAdmin(ctx: PlatformContext, status: "active" | "all") {
  return withPlatformDb(ctx, (tx) =>
    tx.select({ t: supportTickets, company: companies.name, assignee: users.fullName }).from(supportTickets)
      .innerJoin(companies, eq(companies.id, supportTickets.companyId)).leftJoin(users, eq(users.id, supportTickets.assignedAdminId))
      .where(status === "active" ? inArray(supportTickets.status, ["open", "waiting_on_customer"]) : sql`true`)
      .orderBy(sql`case when ${supportTickets.category} = 'urgent' and ${supportTickets.status} = 'open' then 0 else 1 end`, desc(supportTickets.lastActivityAt)).limit(200));
}

export async function getTicketAdmin(ctx: PlatformContext, id: string) {
  if (!isId(id)) return null;
  return withPlatformDb(ctx, async (tx) => {
    const [t] = await tx.select({ t: supportTickets, company: companies.name }).from(supportTickets).innerJoin(companies, eq(companies.id, supportTickets.companyId)).where(eq(supportTickets.id, id));
    if (!t) return null;
    const msgs = await tx.select({ m: supportTicketMessages, name: users.fullName, email: users.email }).from(supportTicketMessages).leftJoin(users, eq(users.id, supportTicketMessages.authorUserId))
      .where(eq(supportTicketMessages.ticketId, id)).orderBy(asc(supportTicketMessages.createdAt));
    return { ...t, messages: msgs };
  });
}

/** Bluewater's reply (emailed to the person who opened the ticket) or internal note (never shown to the client). */
export async function replyAsBluewater(ctx: PlatformContext, id: string, input: { body: string; internal: boolean; status: string }, requestId?: string) {
  const body = cleanMultiline(input.body, 5000);
  const status = (TICKET_STATUSES as readonly string[]).includes(input.status) ? input.status : "waiting_on_customer";
  if (!body && !input.internal) throw new UserError("Write a reply first.");
  if (!isId(id)) throw new UserError("Ticket not found.");
  const r = await withPlatformDb(ctx, async (tx) => {
    const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, id)).for("update");
    if (!t) throw new UserError("Ticket not found.");
    if (body) await tx.insert(supportTicketMessages).values({ companyId: t.companyId, ticketId: id, authorUserId: ctx.userId, authorType: "bluewater", body, internal: input.internal });
    await tx.update(supportTickets).set({ status, assignedAdminId: t.assignedAdminId ?? ctx.userId, lastActivityAt: new Date(), updatedAt: new Date() }).where(eq(supportTickets.id, id));
    await audit(tx, { companyId: t.companyId, actorUserId: ctx.userId, actorType: "platform_admin", action: input.internal ? "support.note_added" : "support.replied", targetType: "ticket", targetId: t.reference, details: { status }, requestId });
    const [creator] = t.createdByUserId ? await tx.select({ email: users.email }).from(users).where(eq(users.id, t.createdByUserId)) : [];
    return { t, creator };
  });
  if (!input.internal && body && r.creator) {
    await sendSystemEmail({ to: r.creator.email, subject: `${r.t.reference}: reply from Bluewater — ${r.t.subject}`, text: `${body}\n\nStatus: ${STATUS_LABELS[status]}\nReply or see the whole conversation: ${env().APP_BASE_URL}/app/help/tickets/${id}` }).catch(() => undefined);
  }
}

/* ---------------- Service notices (outages, maintenance) ---------------- */

/**
 * Notices are drafted, then the administrator reviews the exact recipient list and confirms the count before
 * anything is sent (the confirmation must match the list at send time). Email only; the status page outside
 * the app is updated separately (docs/MONITORING.md).
 */
export async function createNotice(ctx: PlatformContext, input: { title: string; body: string; audience: string; companyIds: string[] }, requestId?: string) {
  const title = cleanText(input.title, 150), body = cleanMultiline(input.body, 5000);
  if (!title || !body) throw new UserError("Add a subject and the message.");
  const audience = input.audience === "selected" ? "selected" : "all_active";
  const ids = input.companyIds.filter(isId);
  if (audience === "selected" && !ids.length) throw new UserError("Choose at least one company.");
  return withPlatformDb(ctx, async (tx) => {
    const [n] = await tx.insert(incidentNotices).values({ title, body, audience, companyIds: ids, createdByUserId: ctx.userId }).returning();
    await audit(tx, { companyId: null, actorUserId: ctx.userId, actorType: "platform_admin", action: "notice.drafted", targetType: "notice", targetId: n!.id, requestId });
    return n!.id;
  });
}

export async function noticeRecipients(ctx: PlatformContext, id: string) {
  if (!isId(id)) throw new UserError("Notice not found.");
  return withPlatformDb(ctx, async (tx) => {
    const [n] = await tx.select().from(incidentNotices).where(eq(incidentNotices.id, id));
    if (!n) throw new UserError("Notice not found.");
    const rows = await tx.select({ company: companies.name, companyId: companies.id, email: users.email, kind: companies.kind, status: companies.lifecycleStatus })
      .from(memberships).innerJoin(companies, eq(companies.id, memberships.companyId)).innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.role, "owner"), eq(memberships.status, "active"), eq(users.status, "active"),
        n.audience === "selected" ? inArray(companies.id, n.companyIds.length ? n.companyIds : ["00000000-0000-0000-0000-000000000000"])
          : and(eq(companies.kind, "customer"), inArray(companies.lifecycleStatus, ["onboarding", "active", "paused"]))))
      .orderBy(companies.name);
    return { notice: n, recipients: rows };
  });
}

export async function sendNotice(ctx: PlatformContext, id: string, confirmedCount: number, requestId?: string) {
  const { notice, recipients } = await noticeRecipients(ctx, id);
  if (notice.status !== "draft") throw new UserError("This notice was already sent or cancelled.");
  if (confirmedCount !== recipients.length) throw new UserError("The recipient list changed since you reviewed it. Review it again before sending.");
  if (!recipients.length) throw new UserError("There's nobody to send this to.");
  for (const r of recipients) {
    await sendSystemEmail({ to: r.email, subject: `Bluewater service notice: ${notice.title}`, text: `${notice.body}\n\n— Bluewater Collective\nYou receive this because you own the ${r.company} workspace.` }).catch(() => undefined);
  }
  await withPlatformDb(ctx, async (tx) => {
    await tx.update(incidentNotices).set({ status: "sent", sentAt: new Date(), sentByUserId: ctx.userId, recipientCount: recipients.length, updatedAt: new Date() }).where(eq(incidentNotices.id, id));
    await audit(tx, { companyId: null, actorUserId: ctx.userId, actorType: "platform_admin", action: "notice.sent", targetType: "notice", targetId: id, details: { recipients: recipients.length }, requestId });
  });
  return recipients.length;
}

export async function listNotices(ctx: PlatformContext) {
  return withPlatformDb(ctx, (tx) => tx.select().from(incidentNotices).orderBy(desc(incidentNotices.createdAt)).limit(50));
}

export async function cancelNotice(ctx: PlatformContext, id: string) {
  if (!isId(id)) return;
  await withPlatformDb(ctx, (tx) => tx.update(incidentNotices).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(incidentNotices.id, id), eq(incidentNotices.status, "draft"))));
}
