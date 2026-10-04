import { and, asc, count, desc, eq, gte, ilike, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withCompanyDb } from "@/lib/db/context";
import type { Tx } from "@/lib/db/client";
import { consentRecords, contacts, inquiries, inquiryEvents, memberships, notes, tasks, users } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { roleCan, type Action } from "@/lib/authz/permissions";
import { hasFeature } from "@/lib/authz/entitlements";
import type { CompanyContext } from "@/lib/authz/context-types";
import { cleanMultiline, cleanText, csvSafe, normalizeEmail, normalizePhone } from "@/lib/contact-normalize";
import { recordInquiry } from "./record-inquiry";
import { stopEnrollments } from "@/server/sequences/stop";

export const STAGES = ["new", "contacted", "booked", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = { new: "New", contacted: "Contacted", booked: "Booked", won: "Won", lost: "Lost" };
export const SOURCE_LABELS: Record<string, string> = {
  website_form: "Website form", manual: "Entered manually", csv_import: "Imported", meta_lead_form: "Facebook/Instagram lead form",
  google_lead_form: "Google lead form", other: "Other",
};

function need(ctx: CompanyContext, action: Action) {
  if (!roleCan(ctx.role, action)) throw new UserError("You don't have permission to do that.");
  if (ctx.policy.login === "read_only" && !action.endsWith(".view") && action !== "lead.export") {
    throw new UserError("This account is read-only right now, so changes can't be saved.");
  }
}
const actorType = (ctx: CompanyContext) => (ctx.supportGrantId ? "support" : "user");

async function logEvent(tx: Tx, ctx: CompanyContext, inquiryId: string, type: string, details: Record<string, unknown> = {}) {
  await tx.insert(inquiryEvents).values({ companyId: ctx.companyId, inquiryId, type, actorUserId: ctx.userId, actorType: actorType(ctx), details });
}

/* ---------------- List / search ---------------- */

export const PAGE_SIZE = 25;

export interface LeadFilters {
  q?: string;
  stage?: Stage;
  source?: string;
  assigned?: "me" | "unassigned" | string;
  from?: Date;
  to?: Date;
  page?: number;
}

export async function listLeads(ctx: CompanyContext, f: LeadFilters) {
  need(ctx, "lead.view");
  const conds: SQL[] = [eq(inquiries.companyId, ctx.companyId)];
  if (f.q) {
    const q = `%${f.q.replace(/[%_\\]/g, (m) => "\\" + m).slice(0, 100)}%`;
    const digits = f.q.replace(/\D/g, "");
    conds.push(or(
      ilike(contacts.fullName, q), ilike(contacts.email, q), ilike(inquiries.serviceRequested, q),
      ...(digits.length >= 4 ? [sql`${contacts.phoneE164} like ${"%" + digits + "%"}`] : []),
    )!);
  }
  if (f.stage) conds.push(eq(inquiries.stage, f.stage));
  if (f.source) conds.push(sql`${inquiries.source} = ${f.source}`);
  if (f.assigned === "me") conds.push(eq(inquiries.assignedUserId, ctx.userId));
  else if (f.assigned === "unassigned") conds.push(isNull(inquiries.assignedUserId));
  else if (f.assigned && /^[0-9a-f-]{36}$/i.test(f.assigned)) conds.push(eq(inquiries.assignedUserId, f.assigned));
  if (f.from) conds.push(gte(inquiries.submittedAt, f.from));
  if (f.to) conds.push(lt(inquiries.submittedAt, f.to));
  const page = Math.max(1, Math.min(f.page ?? 1, 10_000));

  return withCompanyDb(ctx, async (tx) => {
    const where = and(...conds);
    const [{ total }] = (await tx.select({ total: count() }).from(inquiries).innerJoin(contacts, eq(contacts.id, inquiries.contactId)).where(where)) as [{ total: number }];
    const rows = await tx.select({
      id: inquiries.id, stage: inquiries.stage, source: inquiries.source, sourceLabel: inquiries.sourceLabel,
      serviceRequested: inquiries.serviceRequested, submittedAt: inquiries.submittedAt, isRepeat: inquiries.isRepeat,
      saleValueCents: inquiries.saleValueCents,
      contactName: contacts.fullName, email: contacts.email, phone: contacts.phone,
      assignedName: users.fullName, assignedEmail: users.email,
    }).from(inquiries)
      .innerJoin(contacts, eq(contacts.id, inquiries.contactId))
      .leftJoin(users, eq(users.id, inquiries.assignedUserId))
      .where(where).orderBy(desc(inquiries.submittedAt), desc(inquiries.id))
      .limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE);
    return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
  });
}

export async function assignableMembers(ctx: CompanyContext) {
  return withCompanyDb(ctx, (tx) =>
    tx.select({ userId: users.id, name: users.fullName, email: users.email }).from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.companyId, ctx.companyId), eq(memberships.status, "active"))).orderBy(users.fullName),
  );
}

/* ---------------- Detail ---------------- */

export async function getLead(ctx: CompanyContext, inquiryId: string) {
  need(ctx, "lead.view");
  if (!/^[0-9a-f-]{36}$/i.test(inquiryId)) return null;
  return withCompanyDb(ctx, async (tx) => {
    const [row] = await tx.select({ inquiry: inquiries, contact: contacts }).from(inquiries)
      .innerJoin(contacts, eq(contacts.id, inquiries.contactId))
      .where(and(eq(inquiries.id, inquiryId), eq(inquiries.companyId, ctx.companyId)));
    if (!row) return null;
    const history = await tx.select({ e: inquiryEvents, actorName: users.fullName, actorEmail: users.email }).from(inquiryEvents)
      .leftJoin(users, eq(users.id, inquiryEvents.actorUserId))
      .where(eq(inquiryEvents.inquiryId, inquiryId)).orderBy(desc(inquiryEvents.createdAt));
    const noteRows = await tx.select({ n: notes, authorName: users.fullName, authorEmail: users.email }).from(notes)
      .leftJoin(users, eq(users.id, notes.authorUserId)).where(eq(notes.inquiryId, inquiryId)).orderBy(desc(notes.createdAt));
    const taskRows = await tx.select({ t: tasks, assigneeName: users.fullName }).from(tasks)
      .leftJoin(users, eq(users.id, tasks.assignedUserId)).where(eq(tasks.inquiryId, inquiryId)).orderBy(asc(tasks.completedAt), asc(tasks.dueAt));
    const otherInquiries = await tx.select({ id: inquiries.id, submittedAt: inquiries.submittedAt, stage: inquiries.stage, serviceRequested: inquiries.serviceRequested, source: inquiries.source })
      .from(inquiries).where(and(eq(inquiries.contactId, row.contact.id), sql`${inquiries.id} <> ${inquiryId}`)).orderBy(desc(inquiries.submittedAt));
    const consent = await tx.select().from(consentRecords).where(eq(consentRecords.contactId, row.contact.id)).orderBy(desc(consentRecords.capturedAt));
    return { ...row, history, notes: noteRows, tasks: taskRows, otherInquiries, consent };
  });
}

/* ---------------- Manual entry ---------------- */

export async function createLeadManually(ctx: CompanyContext, input: {
  fullName: string; email?: string; phone?: string; serviceRequested?: string; message?: string; assignToUserId?: string | null;
}) {
  need(ctx, "lead.create");
  return withCompanyDb(ctx, async (tx) => {
    const res = await recordInquiry(tx, input, {
      companyId: ctx.companyId, source: "manual", sourceLabel: "Entered manually",
      automationOrigin: "none", actorUserId: ctx.userId, actorType: actorType(ctx), assignedUserId: input.assignToUserId || null,
    });
    return res;
  });
}

/* ---------------- Edits ---------------- */

export async function updateContactDetails(ctx: CompanyContext, inquiryId: string, input: { fullName: string; email: string; phone: string }) {
  need(ctx, "lead.edit");
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  if (email === "invalid") throw new UserError("Email address isn't valid.");
  if (phone === "invalid") throw new UserError("Phone number isn't a valid US number.");
  if (!email && !phone) throw new UserError("Keep at least an email address or a phone number.");
  return withCompanyDb(ctx, async (tx) => {
    const [inq] = await tx.select({ contactId: inquiries.contactId }).from(inquiries).where(eq(inquiries.id, inquiryId));
    if (!inq) throw new UserError("Lead not found.");
    const [before] = await tx.select().from(contacts).where(eq(contacts.id, inq.contactId));
    try {
      await tx.update(contacts).set({
        fullName: cleanText(input.fullName, 200) ?? "",
        email: email?.display ?? null, emailNormalized: email?.normalized ?? null,
        phone: phone?.display ?? null, phoneE164: phone?.e164 ?? null, updatedAt: new Date(),
      }).where(eq(contacts.id, inq.contactId));
    } catch (e) {
      if (/contacts_company_(email|phone)_key/.test(String((e as { cause?: { message?: string } }).cause?.message ?? e))) {
        throw new UserError("Another contact already has that email or phone number.");
      }
      throw e;
    }
    await logEvent(tx, ctx, inquiryId, "contact_updated", {
      before: { name: before!.fullName, email: before!.email, phone: before!.phone },
      after: { name: input.fullName, email: email?.display ?? null, phone: phone?.display ?? null },
    });
  });
}

export async function changeStage(ctx: CompanyContext, inquiryId: string, stage: Stage, opts: { lostReason?: string } = {}) {
  need(ctx, "lead.edit");
  if (!STAGES.includes(stage)) throw new UserError("Unknown stage.");
  return withCompanyDb(ctx, async (tx) => {
    const [cur] = await tx.select().from(inquiries).where(eq(inquiries.id, inquiryId)).for("update");
    if (!cur) throw new UserError("Lead not found.");
    if (cur.stage === stage) return cur;
    const patch: Partial<typeof inquiries.$inferInsert> = { stage, stageChangedAt: new Date() };
    if (stage === "won") patch.wonAt = cur.wonAt ?? new Date();
    if (stage !== "won") { patch.wonAt = null; }
    if (stage === "lost") patch.lostReason = cleanText(opts.lostReason, 300);
    else patch.lostReason = null;
    const [updated] = await tx.update(inquiries).set(patch).where(eq(inquiries.id, inquiryId)).returning();
    await logEvent(tx, ctx, inquiryId, "stage_changed", { from: cur.stage, to: stage, lostReason: patch.lostReason ?? undefined });
    if (stage === "booked" || stage === "won" || stage === "lost") {
      await stopEnrollments(tx, ctx.companyId, { inquiryId }, stage === "booked" ? "booked" : "closed", stage === "booked" ? "The lead was marked Booked" : `The lead was marked ${STAGE_LABELS[stage]}`, { userId: ctx.userId, type: actorType(ctx) });
    }
    return updated!;
  });
}

/** Records (or clears) the sale value. Setting a value marks the lead Won. Null means "not recorded", never $0. */
export async function recordSale(ctx: CompanyContext, inquiryId: string, rawAmount: string) {
  need(ctx, "lead.edit");
  const trimmed = rawAmount.replace(/[$,\s]/g, "");
  let cents: number | null = null;
  if (trimmed !== "") {
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(trimmed)) throw new UserError("Enter the sale amount in dollars, for example 1250 or 1250.50.");
    cents = Math.round(Number(trimmed) * 100);
  }
  return withCompanyDb(ctx, async (tx) => {
    const [cur] = await tx.select().from(inquiries).where(eq(inquiries.id, inquiryId)).for("update");
    if (!cur) throw new UserError("Lead not found.");
    const patch: Partial<typeof inquiries.$inferInsert> = { saleValueCents: cents };
    if (cents != null && cur.stage !== "won") Object.assign(patch, { stage: "won", stageChangedAt: new Date(), wonAt: cur.wonAt ?? new Date(), lostReason: null });
    await tx.update(inquiries).set(patch).where(eq(inquiries.id, inquiryId));
    await logEvent(tx, ctx, inquiryId, "sale_recorded", { fromCents: cur.saleValueCents, toCents: cents, stageFrom: cur.stage });
    if (cents != null) await stopEnrollments(tx, ctx.companyId, { inquiryId }, "closed", "The lead was marked Won", { userId: ctx.userId, type: actorType(ctx) });
  });
}

export async function assignLead(ctx: CompanyContext, inquiryId: string, userId: string | null) {
  need(ctx, "lead.assign");
  return withCompanyDb(ctx, async (tx) => {
    const [cur] = await tx.select({ a: inquiries.assignedUserId }).from(inquiries).where(eq(inquiries.id, inquiryId));
    if (!cur) throw new UserError("Lead not found.");
    try {
      await tx.update(inquiries).set({ assignedUserId: userId }).where(eq(inquiries.id, inquiryId));
    } catch (e) {
      if (/active member/.test(String((e as { cause?: { message?: string } }).cause?.message ?? ""))) throw new UserError("That person isn't on this team.");
      throw e;
    }
    await logEvent(tx, ctx, inquiryId, "assigned", { from: cur.a, to: userId });
  });
}

export async function addNote(ctx: CompanyContext, inquiryId: string, body: string) {
  need(ctx, "lead.edit");
  const text = cleanMultiline(body, 5000);
  if (!text) throw new UserError("Write something in the note.");
  return withCompanyDb(ctx, async (tx) => {
    const [inq] = await tx.select({ id: inquiries.id }).from(inquiries).where(eq(inquiries.id, inquiryId));
    if (!inq) throw new UserError("Lead not found.");
    await tx.insert(notes).values({ companyId: ctx.companyId, inquiryId, authorUserId: ctx.userId, body: text });
    await logEvent(tx, ctx, inquiryId, "note_added");
  });
}

const taskSchema = z.object({ title: z.string().trim().min(2, "Describe the task.").max(200), dueAt: z.date().nullable(), assignedUserId: z.string().uuid().nullable() });

export async function addTask(ctx: CompanyContext, inquiryId: string, input: z.input<typeof taskSchema>) {
  need(ctx, "lead.edit");
  if (!hasFeature(ctx.package, "tasks")) throw new UserError("Follow-up tasks are part of Package 2.");
  const t = taskSchema.parse(input);
  return withCompanyDb(ctx, async (tx) => {
    const [inq] = await tx.select({ id: inquiries.id }).from(inquiries).where(eq(inquiries.id, inquiryId));
    if (!inq) throw new UserError("Lead not found.");
    try {
      await tx.insert(tasks).values({ companyId: ctx.companyId, inquiryId, title: t.title, dueAt: t.dueAt, assignedUserId: t.assignedUserId, createdByUserId: ctx.userId });
    } catch (e) {
      if (/active member/.test(String((e as { cause?: { message?: string } }).cause?.message ?? ""))) throw new UserError("That person isn't on this team.");
      throw e;
    }
    await logEvent(tx, ctx, inquiryId, "task_added", { title: t.title });
  });
}

export async function setTaskDone(ctx: CompanyContext, taskId: string, done: boolean) {
  need(ctx, "lead.edit");
  if (!hasFeature(ctx.package, "tasks")) throw new UserError("Follow-up tasks are part of Package 2.");
  return withCompanyDb(ctx, async (tx) => {
    const [t] = await tx.update(tasks).set({ completedAt: done ? new Date() : null }).where(eq(tasks.id, taskId)).returning();
    if (!t) throw new UserError("Task not found.");
    await logEvent(tx, ctx, t.inquiryId, done ? "task_completed" : "task_reopened", { title: t.title });
  });
}

export async function openTasksForUser(ctx: CompanyContext, limit = 10) {
  if (!hasFeature(ctx.package, "tasks")) return [];
  return withCompanyDb(ctx, (tx) =>
    tx.select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, inquiryId: tasks.inquiryId, contactName: contacts.fullName })
      .from(tasks).innerJoin(inquiries, eq(inquiries.id, tasks.inquiryId)).innerJoin(contacts, eq(contacts.id, inquiries.contactId))
      .where(and(isNull(tasks.completedAt), or(eq(tasks.assignedUserId, ctx.userId), isNull(tasks.assignedUserId))))
      .orderBy(sql`${tasks.dueAt} asc nulls last`).limit(limit),
  );
}

/* ---------------- Pipeline board ---------------- */

export async function pipelineBoard(ctx: CompanyContext, perStage = 30) {
  need(ctx, "lead.view");
  if (!hasFeature(ctx.package, "pipeline_board")) throw new UserError("The pipeline board is part of Package 2.");
  return withCompanyDb(ctx, async (tx) => {
    const out = {} as Record<Stage, { total: number; items: { id: string; name: string; service: string | null; submittedAt: Date; saleValueCents: number | null }[] }>;
    for (const s of STAGES) {
      const [{ total }] = (await tx.select({ total: count() }).from(inquiries).where(eq(inquiries.stage, s))) as [{ total: number }];
      const items = await tx.select({ id: inquiries.id, name: contacts.fullName, email: contacts.email, phone: contacts.phone, service: inquiries.serviceRequested, submittedAt: inquiries.submittedAt, saleValueCents: inquiries.saleValueCents })
        .from(inquiries).innerJoin(contacts, eq(contacts.id, inquiries.contactId))
        .where(eq(inquiries.stage, s)).orderBy(desc(inquiries.stageChangedAt)).limit(perStage);
      out[s] = { total, items: items.map((i) => ({ ...i, name: i.name || i.email || i.phone || "Unnamed" })) };
    }
    return out;
  });
}

/* ---------------- Export ---------------- */

const EXPORT_LIMIT = 50_000;

/** Owner-only CSV export. Logged. Values are guarded against spreadsheet formula injection. */
export async function exportLeadsCsv(ctx: CompanyContext, requestId?: string): Promise<{ csv: string; rows: number }> {
  need(ctx, "lead.export");
  return withCompanyDb(ctx, async (tx) => {
    const rows = await tx.select({
      submittedAt: inquiries.submittedAt, name: contacts.fullName, email: contacts.email, phone: contacts.phone,
      service: inquiries.serviceRequested, message: inquiries.message, source: inquiries.source, sourceLabel: inquiries.sourceLabel,
      stage: inquiries.stage, saleValueCents: inquiries.saleValueCents, assigned: users.email, tracking: inquiries.tracking, repeat: inquiries.isRepeat,
    }).from(inquiries).innerJoin(contacts, eq(contacts.id, inquiries.contactId)).leftJoin(users, eq(users.id, inquiries.assignedUserId))
      .orderBy(desc(inquiries.submittedAt)).limit(EXPORT_LIMIT);
    const header = ["submitted_at", "name", "email", "phone", "service_requested", "message", "source", "source_label", "stage", "sale_value_usd", "assigned_to", "repeat_inquiry", "utm_source", "utm_medium", "utm_campaign", "gclid", "fbclid"];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push([
        r.submittedAt.toISOString(), r.name, r.email, r.phone, r.service, r.message, r.source, r.sourceLabel, r.stage,
        r.saleValueCents == null ? "" : (r.saleValueCents / 100).toFixed(2), r.assigned, r.repeat ? "yes" : "no",
        r.tracking.utm_source, r.tracking.utm_medium, r.tracking.utm_campaign, r.tracking.gclid, r.tracking.fbclid,
      ].map(csvSafe).join(","));
    }
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "data.leads_exported", details: { rows: rows.length }, requestId });
    return { csv: lines.join("\r\n") + "\r\n", rows: rows.length };
  });
}
