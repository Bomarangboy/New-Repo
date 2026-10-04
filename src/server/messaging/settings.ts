import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db/client";
import { withCompanyDb } from "@/lib/db/context";
import { memberships, messageTemplates, messagingSettings } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { roleCan, type Action } from "@/lib/authz/permissions";
import type { CompanyContext } from "@/lib/authz/context-types";
import { zonedDateTime } from "@/lib/periods";
import { DEFAULT_TEMPLATES, validateTemplate, type TemplateKey } from "./templates";

export type MessagingSettings = typeof messagingSettings.$inferSelect;

/** Settings row, created with defaults on first use. */
export async function loadSettings(tx: Tx, companyId: string): Promise<MessagingSettings> {
  const [s] = await tx.select().from(messagingSettings).where(eq(messagingSettings.companyId, companyId));
  if (s) return s;
  await tx.insert(messagingSettings).values({ companyId }).onConflictDoNothing();
  const [created] = await tx.select().from(messagingSettings).where(eq(messagingSettings.companyId, companyId));
  return created!;
}

export interface ActiveTemplate { key: TemplateKey; version: number; subject: string | null; body: string; isDefault: boolean }

export async function activeTemplate(tx: Tx, companyId: string, key: TemplateKey): Promise<ActiveTemplate> {
  const [t] = await tx.select().from(messageTemplates)
    .where(and(eq(messageTemplates.companyId, companyId), eq(messageTemplates.key, key))).orderBy(desc(messageTemplates.version)).limit(1);
  if (t) return { key, version: t.version, subject: t.subject, body: t.body, isDefault: false };
  return { key, version: 0, ...DEFAULT_TEMPLATES[key], isDefault: true };
}

/* ---------------- Sending window ---------------- */

function localParts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday!);
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), minute: Number(p.hour) * 60 + Number(p.minute), weekday: wd };
}

type Window = Pick<MessagingSettings, "windowStartMinute" | "windowEndMinute" | "windowDays">;

export function isWithinWindow(now: Date, tz: string, w: Window): boolean {
  const p = localParts(now, tz);
  return w.windowDays.includes(p.weekday) && p.minute >= w.windowStartMinute && p.minute < w.windowEndMinute;
}

/** Next moment the window opens (or `now` if already open). Null if no day is allowed. */
export function nextWindowStart(now: Date, tz: string, w: Window): Date | null {
  if (isWithinWindow(now, tz, w)) return now;
  const p = localParts(now, tz);
  for (let i = 0; i < 8; i++) {
    const cal = new Date(Date.UTC(p.y, p.m - 1, p.d + i));
    const weekday = (p.weekday + i) % 7;
    if (!w.windowDays.includes(weekday)) continue;
    const open = zonedDateTime(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), w.windowStartMinute, tz);
    if (open > now) return open;
  }
  return null;
}

/* ---------------- Owner-facing changes ---------------- */

function need(ctx: CompanyContext, action: Action) {
  if (!roleCan(ctx.role, action)) throw new UserError("You don't have permission to do that.");
  if (ctx.policy.login !== "full") throw new UserError("This account is read-only right now, so changes can't be saved.");
}
const actor = (ctx: CompanyContext) => (ctx.supportGrantId ? "support" : "user") as "support" | "user";

export async function getAutomationSettings(ctx: CompanyContext) {
  return withCompanyDb(ctx, async (tx) => ({
    settings: await loadSettings(tx, ctx.companyId),
    sms: await activeTemplate(tx, ctx.companyId, "ack_sms"),
    email: await activeTemplate(tx, ctx.companyId, "ack_email"),
    history: await tx.select({ key: messageTemplates.key, version: messageTemplates.version, createdAt: messageTemplates.createdAt })
      .from(messageTemplates).where(eq(messageTemplates.companyId, ctx.companyId)).orderBy(desc(messageTemplates.createdAt)).limit(10),
  }));
}

/** Saves a new template version. Messages already sent keep the version they used. */
export async function saveTemplate(ctx: CompanyContext, key: TemplateKey, input: { subject?: string | null; body: string }, requestId?: string) {
  need(ctx, "template.manage");
  const body = input.body.replace(/\r\n?/g, "\n").trim();
  const subject = key === "ack_email" ? (input.subject ?? "").trim() : null;
  const check = validateTemplate(key, body, subject);
  if (!check.ok) throw new UserError(check.errors.join(" "));
  return withCompanyDb(ctx, async (tx) => {
    const cur = await activeTemplate(tx, ctx.companyId, key);
    if (cur.body === body && (cur.subject ?? null) === (subject || null)) return cur.version;
    const version = cur.version + 1;
    await tx.insert(messageTemplates).values({ companyId: ctx.companyId, key, version, subject: subject || null, body, createdByUserId: ctx.userId });
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actor(ctx), action: "automation.template_saved", targetType: "template", targetId: `${key}:v${version}`, details: { key, version }, requestId });
    return version;
  });
}

export const windowSchema = z.object({
  ackEnabled: z.boolean(),
  windowStartMinute: z.number().int().min(0).max(1439),
  windowEndMinute: z.number().int().min(1).max(1440),
  windowDays: z.array(z.number().int().min(0).max(6)).min(1, "Choose at least one day."),
  notifyUserIds: z.array(z.string().uuid()).max(50),
}).refine((v) => v.windowEndMinute - v.windowStartMinute >= 60, { message: "The sending window must be at least one hour long." });

export async function updateAutomationSettings(ctx: CompanyContext, input: z.input<typeof windowSchema>, requestId?: string) {
  need(ctx, "template.manage");
  const v = windowSchema.parse(input);
  return withCompanyDb(ctx, async (tx) => {
    const before = await loadSettings(tx, ctx.companyId);
    if (v.notifyUserIds.length) {
      const members = await tx.select({ id: memberships.userId }).from(memberships).where(and(eq(memberships.companyId, ctx.companyId), eq(memberships.status, "active")));
      const ok = new Set(members.map((m) => m.id));
      if (v.notifyUserIds.some((id) => !ok.has(id))) throw new UserError("Notifications can only go to people on your team.");
    }
    await tx.update(messagingSettings).set({ ...v, updatedAt: new Date() }).where(eq(messagingSettings.companyId, ctx.companyId));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actor(ctx), action: "automation.settings_updated", details: {
      before: { ackEnabled: before.ackEnabled, window: [before.windowStartMinute, before.windowEndMinute], days: before.windowDays },
      after: { ackEnabled: v.ackEnabled, window: [v.windowStartMinute, v.windowEndMinute], days: v.windowDays },
    }, requestId });
  });
}

/** Emergency stop: no automatic message is sent while paused; pending ones are cancelled, not delayed. */
export async function setEmergencyPause(ctx: CompanyContext, paused: boolean, reason: string, requestId?: string) {
  need(ctx, "automation.emergency_pause");
  if (paused && reason.trim().length < 3) throw new UserError("Say briefly why you're pausing (for your records).");
  return withCompanyDb(ctx, async (tx) => {
    await loadSettings(tx, ctx.companyId);
    await tx.update(messagingSettings).set({ automationPaused: paused, automationPausedReason: paused ? reason.trim() : null, automationPausedAt: paused ? new Date() : null, updatedAt: new Date() })
      .where(eq(messagingSettings.companyId, ctx.companyId));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actor(ctx), action: paused ? "automation.paused" : "automation.resumed", details: { reason }, requestId });
  });
}

export async function isAutomationPaused(ctx: CompanyContext): Promise<boolean> {
  return withCompanyDb(ctx, async (tx) => {
    const [s] = await tx.select({ p: messagingSettings.automationPaused }).from(messagingSettings).where(eq(messagingSettings.companyId, ctx.companyId));
    return Boolean(s?.p);
  });
}
