import { createHash, randomInt } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { withPlatformDb, withSystemDb } from "@/lib/db/context";
import type { Tx } from "@/lib/db/client";
import { companies, contacts, conversations, dataDeletions, inquiries, jobs, lifecycleHistory, memberships, packageHistory, users } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { UserError } from "@/lib/errors";
import { PACKAGES, type PackageTier } from "@/lib/authz/entitlements";
import type { PlatformContext } from "@/lib/authz/context-types";
import { isValidTimezone } from "@/lib/timezones";
import { recordInquiry } from "@/server/crm/record-inquiry";
import { enqueueNewLeadWork } from "@/server/messaging/acknowledgment";
import { handleInbound } from "@/server/messaging/inbound";
import { applyBookingEvent } from "@/server/booking/events";
import { refFromInquiryId } from "@/server/booking/links";
import { disableOrphanUsers, purgeCompanyData } from "@/server/retention";
import { generateDemoDataset } from "./dataset";
import { changePackage, slugify } from "@/server/companies";

/**
 * Sales-demo prospect workspaces (spec §21, docs/DEMO.md). Each prospect gets an isolated, expiring company
 * of kind "demo_prospect" filled with FICTIONAL data. The account policy already refuses sign-in after expiry
 * and never allows live delivery for demo companies; on top of that these workspaces can't be created in
 * production at all. Expired workspaces are deleted automatically after a grace period.
 */
export const DEMO_GRACE_DAYS = 7;
const DAY = 86_400_000;
const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

function requireDemoEnvironment() {
  if (env().APP_ENV === "production") throw new UserError("Prospect workspaces live on the separate demo site, never in production.");
}

async function loadProspect(tx: Tx, id: string) {
  if (!isId(id)) throw new UserError("Demo workspace not found.");
  const [c] = await tx.select().from(companies).where(eq(companies.id, id)).for("update");
  if (!c || c.kind !== "demo_prospect") throw new UserError("Demo workspace not found.");
  return c;
}

async function fill(tx: Tx, companyId: string, seed: number) {
  const members = await tx.select({ id: memberships.userId }).from(memberships).where(and(eq(memberships.companyId, companyId), eq(memberships.status, "active")));
  await tx.execute(sql`select set_config('app.company_id', ${companyId}, true)`);
  return generateDemoDataset(tx, { companyId, memberIds: members.map((m) => m.id), seed });
}

export async function listProspects(ctx: PlatformContext) {
  return withPlatformDb(ctx, async (tx) => {
    const rows = await tx.select({ c: companies, owner: users.email }).from(companies)
      .leftJoin(memberships, and(eq(memberships.companyId, companies.id), eq(memberships.role, "owner"), eq(memberships.status, "active")))
      .leftJoin(users, eq(users.id, memberships.userId))
      .where(eq(companies.kind, "demo_prospect")).orderBy(desc(companies.createdAt)).limit(100);
    return rows;
  });
}

export async function createProspect(ctx: PlatformContext, input: { name: string; package: string; days: number; timezone: string }, requestId?: string) {
  requireDemoEnvironment();
  const name = input.name.trim().slice(0, 120);
  if (name.length < 2) throw new UserError("Enter the prospect's business name.");
  if (!PACKAGES.includes(input.package as PackageTier)) throw new UserError("Choose a package.");
  const days = Math.round(input.days);
  if (!(days >= 1 && days <= 30)) throw new UserError("Demo workspaces last 1 to 30 days.");
  const timezone = isValidTimezone(input.timezone) ? input.timezone : "America/New_York";
  return withPlatformDb(ctx, async (tx) => {
    const slug = `demo-${slugify(name).slice(0, 30)}-${randomInt(1e5, 1e6)}`;
    const [c] = await tx.insert(companies).values({
      name: `${name} (demo)`, slug, timezone, package: input.package as PackageTier, kind: "demo_prospect", lifecycleStatus: "active",
      crmMode: "built_in", serviceStartDate: new Date(), demoExpiresAt: new Date(Date.now() + days * DAY),
    }).returning();
    await tx.insert(packageHistory).values({ companyId: c!.id, toPackage: c!.package, changedByUserId: ctx.userId, note: "Demo workspace created" });
    await tx.insert(lifecycleHistory).values({ companyId: c!.id, toStatus: "active", changedByUserId: ctx.userId, reason: "Demo workspace created" });
    await fill(tx, c!.id, randomInt(1, 1e9));
    await audit(tx, { companyId: c!.id, actorUserId: ctx.userId, actorType: "platform_admin", action: "demo.created", targetType: "company", targetId: c!.id, details: { days, package: c!.package }, requestId });
    return c!;
  });
}

/** Puts the sample data back to a fresh state; the people who can sign in stay. */
export async function resetProspect(ctx: PlatformContext, id: string, requestId?: string) {
  requireDemoEnvironment();
  return withPlatformDb(ctx, async (tx) => {
    const c = await loadProspect(tx, id);
    const summary = await purgeCompanyData(tx, c.id, true);
    await fill(tx, c.id, randomInt(1, 1e9));
    await audit(tx, { companyId: c.id, actorUserId: ctx.userId, actorType: "platform_admin", action: "demo.reset", targetType: "company", targetId: c.id, details: { removed: summary }, requestId });
  });
}

export async function extendProspect(ctx: PlatformContext, id: string, days: number, requestId?: string) {
  if (!(days >= 1 && days <= 30)) throw new UserError("Extend by 1 to 30 days.");
  return withPlatformDb(ctx, async (tx) => {
    const c = await loadProspect(tx, id);
    const base = Math.max(Date.now(), c.demoExpiresAt?.getTime() ?? 0);
    const until = new Date(Math.min(base + days * DAY, Date.now() + 30 * DAY));
    await tx.update(companies).set({ demoExpiresAt: until }).where(eq(companies.id, c.id));
    await audit(tx, { companyId: c.id, actorUserId: ctx.userId, actorType: "platform_admin", action: "demo.extended", targetType: "company", targetId: c.id, details: { until: until.toISOString() }, requestId });
    return until;
  });
}

/** Ends access immediately. The data is deleted automatically after the grace period. */
export async function revokeProspect(ctx: PlatformContext, id: string, requestId?: string) {
  return withPlatformDb(ctx, async (tx) => {
    const c = await loadProspect(tx, id);
    await tx.update(companies).set({ demoExpiresAt: new Date() }).where(eq(companies.id, c.id));
    await audit(tx, { companyId: c.id, actorUserId: ctx.userId, actorType: "platform_admin", action: "demo.revoked", targetType: "company", targetId: c.id, requestId });
  });
}

/** Presentation control: show what another package looks like. Only for demo workspaces. */
export async function switchProspectPackage(ctx: PlatformContext, id: string, to: string, requestId?: string) {
  if (!PACKAGES.includes(to as PackageTier)) throw new UserError("Choose a package.");
  await withPlatformDb(ctx, (tx) => loadProspect(tx, id));
  await changePackage(ctx, id, to as PackageTier, "Demo presentation", requestId);
}

/* ---------------- Presentation controls ---------------- */

const FIRST = ["Jordan", "Riley", "Avery", "Quinn", "Morgan", "Casey", "Parker", "Rowan"];
const LAST = ["Mills", "Rivera", "Chen", "Brooks", "Owens", "Lopez", "Grant", "Shaw"];
const SERVICES = ["Roof repair", "AC tune-up", "Water heater install", "Drain cleaning", "Window replacement"];

export type PresentationAction = "lead" | "reply" | "booking" | "advance";

export async function presentationControl(ctx: PlatformContext, id: string, action: PresentationAction, requestId?: string): Promise<string> {
  requireDemoEnvironment();
  const c = await withPlatformDb(ctx, async (tx) => {
    const c = await loadProspect(tx, id);
    if (c.demoExpiresAt && c.demoExpiresAt <= new Date()) throw new UserError("This demo workspace has expired. Extend it first.");
    await audit(tx, { companyId: c.id, actorUserId: ctx.userId, actorType: "platform_admin", action: `demo.simulate_${action}`, targetType: "company", targetId: c.id, requestId });
    return c;
  });
  const pick = <T,>(xs: readonly T[]) => xs[randomInt(xs.length)]!;

  if (action === "lead") {
    const first = pick(FIRST), last = pick(LAST), n = randomInt(100);
    // Reserved fictional numbers/addresses only (555-01xx, example.com).
    await withPlatformDb(ctx, async (tx) => {
      const res = await recordInquiry(tx, {
        fullName: `${first} ${last}`, email: `${first}.${last}.${randomInt(1e6)}@example.com`.toLowerCase(), phone: `415-555-01${String(n).padStart(2, "0")}`,
        serviceRequested: pick(SERVICES), message: "Hi — could someone come out this week? (sample lead)",
        consent: [{ channel: "sms", purpose: "inquiry_response", granted: true, statement: "Sample consent (demo)", method: "website_checkbox" }],
      }, { companyId: c.id, source: "website_form", sourceLabel: "Website contact form", automationOrigin: "eligible", actorType: "system" });
      await enqueueNewLeadWork(tx, c.id, res.inquiry.id, res.inquiry.automationOrigin);
    });
    return `New sample lead from ${first} ${last}. The automatic reply runs within a few seconds (simulated — nothing is sent).`;
  }

  if (action === "reply") {
    const conv = await withPlatformDb(ctx, async (tx) => (await tx.select({ phone: contacts.phoneE164, email: contacts.email, name: contacts.fullName })
      .from(conversations).innerJoin(contacts, eq(contacts.id, conversations.contactId)).where(eq(conversations.companyId, c.id)).orderBy(desc(conversations.lastMessageAt)).limit(1))[0]);
    if (!conv) throw new UserError("There's no conversation yet. Simulate a lead first.");
    const channel = conv.phone ? "sms" : "email";
    await handleInbound({ companyId: c.id, channel, from: (channel === "sms" ? conv.phone : conv.email)!, body: "Thanks! Is Thursday afternoon possible?", transport: "simulated", providerMessageId: `sim_in_${crypto.randomUUID()}`, subject: channel === "email" ? "Re: your inquiry" : null });
    return `${conv.name ?? "The lead"} replied (simulated). It's in Conversations, marked as needing a reply.`;
  }

  if (action === "booking") {
    const lead = await withPlatformDb(ctx, async (tx) => (await tx.select({ id: inquiries.id, name: contacts.fullName, email: contacts.email, phone: contacts.phone, service: inquiries.serviceRequested })
      .from(inquiries).innerJoin(contacts, eq(contacts.id, inquiries.contactId))
      .where(and(eq(inquiries.companyId, c.id), inArray(inquiries.stage, ["new", "contacted"]),
        sql`not exists (select 1 from app.appointments a where a.inquiry_id = ${inquiries.id} and a.status = 'scheduled')`))
      .orderBy(desc(inquiries.submittedAt)).limit(1))[0]);
    if (!lead) throw new UserError("No open lead to book. Simulate a lead first.");
    const start = new Date(Math.ceil((Date.now() + 2 * DAY) / 3_600_000) * 3_600_000);
    const uid = `sim_${crypto.randomUUID()}`;
    await applyBookingEvent(c.id, {
      provider: "simulated", trigger: "BOOKING_CREATED", uid, startTime: start.toISOString(), endTime: new Date(start.getTime() + 3_600_000).toISOString(),
      title: lead.service ? `Estimate: ${lead.service}` : "Appointment", attendee: { name: lead.name, email: lead.email, phone: lead.phone, timeZone: c.timezone },
      ref: refFromInquiryId(lead.id), eventCreatedAt: new Date(), bodyHash: createHash("sha256").update(uid).digest("hex"),
    });
    return `${lead.name ?? "The lead"} booked an appointment (simulated). Follow-ups for them stop automatically.`;
  }

  // advance: run the next waiting follow-up step now instead of at its scheduled time.
  const moved = await withPlatformDb(ctx, async (tx) => {
    const [j] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.companyId, c.id), eq(jobs.kind, "sequence_step"), eq(jobs.status, "queued")))
      .orderBy(asc(jobs.runAt)).limit(1);
    if (!j) return false;
    await tx.update(jobs).set({ runAt: new Date() }).where(eq(jobs.id, j.id));
    return true;
  });
  if (!moved) throw new UserError("No follow-up is waiting. Simulate a lead first (with Package 2 or 3).");
  return "The next follow-up step runs now instead of later (simulated). Refresh the lead in a few seconds.";
}

/* ---------------- Cleanup (maintenance, every minute; cheap when there's nothing to do) ---------------- */

export async function cleanupExpiredProspects(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DEMO_GRACE_DAYS * DAY);
  return withSystemDb("demo: cleanup expired prospects", async (tx) => {
    const due = await tx.select().from(companies).where(and(eq(companies.kind, "demo_prospect"), lt(companies.demoExpiresAt, cutoff),
      sql`${companies.lifecycleStatus} <> 'archived'`, isNull(companies.serviceEndsAt))).limit(10);
    for (const c of due) {
      const members = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.companyId, c.id));
      const summary = await purgeCompanyData(tx, c.id);
      await disableOrphanUsers(tx, members.map((m) => m.userId));
      await tx.update(companies).set({ lifecycleStatus: "archived" }).where(eq(companies.id, c.id));
      await tx.insert(lifecycleHistory).values({ companyId: c.id, fromStatus: c.lifecycleStatus, toStatus: "archived", reason: "Demo workspace expired; sample data deleted" });
      await tx.insert(dataDeletions).values({ companyId: c.id, companyName: c.name, reason: `Demo workspace expired more than ${DEMO_GRACE_DAYS} days ago`, summary });
      await audit(tx, { companyId: c.id, actorUserId: null, actorType: "system", action: "demo.cleaned_up", targetType: "company", targetId: c.id, details: { summary } });
    }
    return due.length;
  });
}

