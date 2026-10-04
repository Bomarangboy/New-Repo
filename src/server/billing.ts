import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db/client";
import { withCompanyDb, withPlatformDb } from "@/lib/db/context";
import { companies, companyBilling, invoices, messagingSettings, platformSettings } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { roleCan } from "@/lib/authz/permissions";
import type { CompanyContext, PlatformContext } from "@/lib/authz/context-types";

/**
 * Usage, cost estimates, limits and manual billing records (docs/BILLING.md, D-37).
 *  - Entitlements (what a package includes) are separate from USAGE (what was used).
 *  - Cost ESTIMATES use unit prices an administrator enters; with no prices entered they show "—", never $0.
 *  - Limits are optional per company. "warn" only alerts Bluewater; "pause_automatic" stops AUTOMATIC texts
 *    (emails, manual replies and lead capture continue — a lead is never lost because of a limit).
 *  - Bluewater bills outside the app: invoices here are records, nothing is charged automatically.
 */

export interface UnitPrices {
  /** Price per text segment including carrier fees (USD). */
  smsSegmentUsd: number | null;
  emailUsd: number | null;
  /** Monthly fixed costs per client with a texting number (number rental + A2P campaign fee). */
  smsNumberMonthlyUsd: number | null;
}
const EMPTY_PRICES: UnitPrices = { smsSegmentUsd: null, emailUsd: null, smsNumberMonthlyUsd: null };

export async function getUnitPrices(tx: Tx): Promise<UnitPrices> {
  const [r] = await tx.select().from(platformSettings).where(eq(platformSettings.key, "unit_prices"));
  return { ...EMPTY_PRICES, ...((r?.value ?? {}) as Partial<UnitPrices>) };
}

const priceSchema = z.object({ smsSegmentUsd: z.number().min(0).max(1).nullable(), emailUsd: z.number().min(0).max(1).nullable(), smsNumberMonthlyUsd: z.number().min(0).max(1000).nullable() });

export async function saveUnitPrices(ctx: PlatformContext, input: UnitPrices, requestId?: string) {
  const v = priceSchema.safeParse(input);
  if (!v.success) throw new UserError("Enter prices in dollars (for example 0.0110 per text segment).");
  return withPlatformDb(ctx, async (tx) => {
    await tx.insert(platformSettings).values({ key: "unit_prices", value: v.data, updatedByUserId: ctx.userId })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: v.data, updatedByUserId: ctx.userId, updatedAt: new Date() } });
    await audit(tx, { companyId: null, actorUserId: ctx.userId, actorType: "platform_admin", action: "billing.unit_prices_saved", details: v.data, requestId });
  });
}

/** Text segments and emails this calendar month (UTC) that count toward limits. */
export async function monthlyUsage(tx: Tx, companyId: string): Promise<{ smsSegments: number; emails: number }> {
  const [r] = await tx.execute<{ sms: number; email: number }>(sql`
    select coalesce(sum(segments) filter (where channel = 'sms'), 0)::int as sms, count(*) filter (where channel = 'email')::int as email
    from app.messages where company_id = ${companyId} and direction = 'outbound' and status in ('sending','submitted','delivered','unknown')
      and created_at >= date_trunc('month', now())`);
  return { smsSegments: r?.sms ?? 0, emails: r?.email ?? 0 };
}

/** True when the company's limit says automatic texts must pause now (used just before any automatic text). */
export async function automaticTextsPaused(tx: Tx, companyId: string): Promise<boolean> {
  const [b] = await tx.select().from(companyBilling).where(eq(companyBilling.companyId, companyId));
  if (!b || b.limitMode !== "pause_automatic" || b.smsMonthlyLimit == null) return false;
  return (await monthlyUsage(tx, companyId)).smsSegments >= b.smsMonthlyLimit;
}

/* ---------------- Administrator: usage & costs ---------------- */

const monthRe = /^\d{4}-\d{2}$/;
export function monthBounds(month: string): { from: string; to: string } {
  if (!monthRe.test(month)) throw new UserError("Choose a month.");
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { from: new Date(Date.UTC(y, m - 1, 1)).toISOString(), to: new Date(Date.UTC(y, m, 1)).toISOString() };
}

export async function usageReport(ctx: PlatformContext, month: string) {
  const { from, to } = monthBounds(month);
  return withPlatformDb(ctx, async (tx) => {
    const prices = await getUnitPrices(tx);
    const rows = await tx.execute<{
      id: string; name: string; kind: string; package: string; lifecycle_status: string; billing_status: string; monthly_price_cents: number | null;
      sms_monthly_limit: number | null; limit_mode: string | null; leads: number; sms_live: number; sms_sim: number; email_live: number; email_sim: number; has_number: boolean; ad_syncs: number;
    }>(sql`
      select c.id, c.name, c.kind, c.package, c.lifecycle_status, c.billing_status, b.monthly_price_cents, b.sms_monthly_limit, b.limit_mode,
        (select count(*)::int from app.inquiries i where i.company_id = c.id and i.received_at >= ${from} and i.received_at < ${to}) as leads,
        (select coalesce(sum(m.segments), 0)::int from app.messages m where m.company_id = c.id and m.direction = 'outbound' and m.channel = 'sms' and m.transport <> 'simulated' and m.status in ('sending','submitted','delivered','unknown') and m.created_at >= ${from} and m.created_at < ${to}) as sms_live,
        (select coalesce(sum(m.segments), 0)::int from app.messages m where m.company_id = c.id and m.direction = 'outbound' and m.channel = 'sms' and m.transport = 'simulated' and m.created_at >= ${from} and m.created_at < ${to}) as sms_sim,
        (select count(*)::int from app.messages m where m.company_id = c.id and m.direction = 'outbound' and m.channel = 'email' and m.transport <> 'simulated' and m.status in ('sending','submitted','delivered','unknown') and m.created_at >= ${from} and m.created_at < ${to}) as email_live,
        (select count(*)::int from app.messages m where m.company_id = c.id and m.direction = 'outbound' and m.channel = 'email' and m.transport = 'simulated' and m.created_at >= ${from} and m.created_at < ${to}) as email_sim,
        exists (select 1 from app.company_senders s where s.company_id = c.id and s.channel = 'sms' and s.status = 'verified') as has_number,
        (select count(*)::int from app.ad_sync_runs r where r.company_id = c.id and r.started_at >= ${from} and r.started_at < ${to}) as ad_syncs
      from app.companies c left join app.company_billing b on b.company_id = c.id
      order by (c.kind = 'customer') desc, c.name`);
    const est = (r: (typeof rows)[number]): number | null => {
      // Only real (live) usage costs money; unknown prices make the estimate unknown, not zero.
      const parts: (number | null)[] = [];
      if (r.sms_live > 0) parts.push(prices.smsSegmentUsd == null ? null : r.sms_live * prices.smsSegmentUsd);
      if (r.email_live > 0) parts.push(prices.emailUsd == null ? null : r.email_live * prices.emailUsd);
      if (r.has_number) parts.push(prices.smsNumberMonthlyUsd);
      if (parts.some((x) => x == null)) return null;
      return parts.reduce<number>((a, b) => a + (b ?? 0), 0);
    };
    return { month, prices, rows: rows.map((r) => ({ ...r, estimatedCostUsd: est(r) })) };
  });
}

/** New, activated, churned, reactivated per month — real customers only (demo and test companies excluded). */
export async function lifecycleReport(ctx: PlatformContext, months = 6) {
  return withPlatformDb(ctx, (tx) => tx.execute<{ month: string; created: number; activated: number; churned: number; reactivated: number; active_end: number }>(sql`
    with m as (select generate_series(date_trunc('month', now()) - (${months - 1} || ' months')::interval, date_trunc('month', now()), interval '1 month') as start),
    real as (select id, created_at from app.companies where kind = 'customer')
    select to_char(m.start, 'YYYY-MM') as month,
      (select count(*)::int from real r where r.created_at >= m.start and r.created_at < m.start + interval '1 month') as created,
      (select count(*)::int from app.lifecycle_history h join real r on r.id = h.company_id where h.to_status = 'active' and h.from_status = 'onboarding' and h.created_at >= m.start and h.created_at < m.start + interval '1 month') as activated,
      (select count(*)::int from app.lifecycle_history h join real r on r.id = h.company_id where h.to_status = 'churned' and h.created_at >= m.start and h.created_at < m.start + interval '1 month') as churned,
      (select count(*)::int from app.lifecycle_history h join real r on r.id = h.company_id where h.from_status = 'churned' and h.to_status = 'onboarding' and h.created_at >= m.start and h.created_at < m.start + interval '1 month') as reactivated,
      (select count(*)::int from real r where (
         select h.to_status from app.lifecycle_history h where h.company_id = r.id and h.created_at < m.start + interval '1 month' order by h.created_at desc limit 1) = 'active') as active_end
    from m order by m.start`));
}

/* ---------------- Administrator: terms, limits and invoices ---------------- */

export const billingSchema = z.object({
  monthlyPriceCents: z.number().int().min(0).max(100_000_00).nullable(),
  billingEmail: z.string().email("Enter a valid billing email.").nullable(),
  smsMonthlyLimit: z.number().int().min(1).max(1_000_000).nullable(),
  emailMonthlyLimit: z.number().int().min(1).max(1_000_000).nullable(),
  limitMode: z.enum(["warn", "pause_automatic"]),
  graceDays: z.number().int().min(0).max(90),
  notes: z.string().max(2000).nullable(),
});

export async function getCompanyBillingAdmin(ctx: PlatformContext, companyId: string) {
  return withPlatformDb(ctx, async (tx) => {
    const [b] = await tx.select().from(companyBilling).where(eq(companyBilling.companyId, companyId));
    const list = await tx.select().from(invoices).where(eq(invoices.companyId, companyId)).orderBy(desc(invoices.periodStart)).limit(24);
    const [ms] = await tx.select({ paused: messagingSettings.automationPaused, reason: messagingSettings.automationPausedReason }).from(messagingSettings).where(eq(messagingSettings.companyId, companyId));
    return { billing: b ?? null, invoices: list, usage: await monthlyUsage(tx, companyId), automation: { paused: Boolean(ms?.paused), reason: ms?.reason ?? null } };
  });
}

export async function saveCompanyBilling(ctx: PlatformContext, companyId: string, input: z.input<typeof billingSchema>, requestId?: string) {
  const p = billingSchema.safeParse(input);
  if (!p.success) throw new UserError(p.error.issues[0]?.message ?? "Check the billing details.");
  return withPlatformDb(ctx, async (tx) => {
    const [co] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
    if (!co) throw new UserError("Company not found.");
    await tx.insert(companyBilling).values({ companyId, ...p.data }).onConflictDoUpdate({ target: companyBilling.companyId, set: { ...p.data, updatedAt: new Date() } });
    await audit(tx, { companyId, actorUserId: ctx.userId, actorType: "platform_admin", action: "billing.terms_saved", details: { ...p.data, notes: undefined }, requestId });
  });
}

const invoiceSchema = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.number().int().min(0).max(100_000_00), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), notes: z.string().max(500).nullable(),
});

/** Records an invoice Bluewater sent outside the app (reference INV-YYYYMM-NNN). */
export async function recordInvoice(ctx: PlatformContext, companyId: string, input: z.input<typeof invoiceSchema>, requestId?: string) {
  const p = invoiceSchema.safeParse(input);
  if (!p.success) throw new UserError("Enter the period, amount and due date.");
  if (p.data.periodEnd < p.data.periodStart) throw new UserError("The period ends before it starts.");
  return withPlatformDb(ctx, async (tx) => {
    const [co] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
    if (!co) throw new UserError("Company not found.");
    const prefix = `INV-${p.data.periodStart.slice(0, 7).replace("-", "")}-`;
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(invoices).where(sql`${invoices.reference} like ${prefix + "%"}`)) as [{ n: number }];
    const reference = `${prefix}${String(n + 1).padStart(3, "0")}`;
    await tx.insert(invoices).values({ companyId, reference, ...p.data, status: "sent", createdByUserId: ctx.userId });
    await audit(tx, { companyId, actorUserId: ctx.userId, actorType: "platform_admin", action: "billing.invoice_recorded", targetType: "invoice", targetId: reference, details: { amountCents: p.data.amountCents }, requestId });
    return reference;
  });
}

/**
 * Paid → billing current. Payment failed → billing past due (Bluewater is alerted after the grace period; service is
 * NOT suspended automatically — that is the owner's decision). Void → kept for the record.
 */
export async function setInvoiceStatus(ctx: PlatformContext, invoiceId: string, status: "paid" | "failed" | "void", requestId?: string) {
  return withPlatformDb(ctx, async (tx) => {
    const [inv] = await tx.update(invoices).set({ status, paidAt: status === "paid" ? new Date() : null, updatedAt: new Date() }).where(eq(invoices.id, invoiceId)).returning();
    if (!inv) throw new UserError("Invoice not found.");
    const open = await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.companyId, inv.companyId), eq(invoices.status, "failed")));
    await tx.update(companies).set({ billingStatus: open.length ? "manual_past_due" : "manual_current" }).where(and(eq(companies.id, inv.companyId), sql`${companies.billingStatus} <> 'cancelled'`));
    await audit(tx, { companyId: inv.companyId, actorUserId: ctx.userId, actorType: "platform_admin", action: "billing.invoice_status", targetType: "invoice", targetId: inv.reference, details: { status }, requestId });
  });
}

/* ---------------- Client owner: read-only billing view ---------------- */

export async function billingForOwner(ctx: CompanyContext) {
  if (!roleCan(ctx.role, "billing.view")) throw new UserError("You don't have permission to see billing.");
  return withCompanyDb(ctx, async (tx) => {
    const [b] = await tx.select().from(companyBilling).where(eq(companyBilling.companyId, ctx.companyId));
    const list = await tx.select({ reference: invoices.reference, periodStart: invoices.periodStart, periodEnd: invoices.periodEnd, amountCents: invoices.amountCents, status: invoices.status, dueDate: invoices.dueDate, paidAt: invoices.paidAt })
      .from(invoices).orderBy(desc(invoices.periodStart)).limit(24);
    return {
      monthlyPriceCents: b?.monthlyPriceCents ?? null, smsMonthlyLimit: b?.smsMonthlyLimit ?? null, limitMode: b?.limitMode ?? "warn",
      usage: await monthlyUsage(tx, ctx.companyId), invoices: list,
    };
  });
}
