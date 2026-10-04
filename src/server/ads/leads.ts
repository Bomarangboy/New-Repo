import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { withCompanyDb, withSystemCompanyDb, withSystemDb } from "@/lib/db/context";
import { adLeadEvents, adLeadSources, companies } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { env, isSimulatedEnvironment } from "@/lib/env";
import { UserError } from "@/lib/errors";
import { roleCan } from "@/lib/authz/permissions";
import { accountPolicy } from "@/lib/authz/account-policy";
import type { CompanyContext } from "@/lib/authz/context-types";
import { recordInquiry, validateInquiry, type InquiryInput } from "@/server/crm/record-inquiry";
import { enqueueNewLeadWork } from "@/server/messaging/acknowledgment";
import { webhookKeyHash } from "@/server/messaging/webhooks";
import { enqueue, type JobOutcome, type JobRow } from "@/server/jobs/queue";
import { clientFor } from "./clients";
import { simulatedLead } from "./clients/simulated";
import type { LeadAnswer, LeadData } from "./clients/types";
import { AdsAuthError, AdsRateLimitError } from "./errors";
import { recordConnectionProblem } from "./connections";

/**
 * Ad lead-form intake (all packages). docs/ADS.md. A lead is recorded exactly once per platform lead id,
 * through recordInquiry() like every other lead, with its campaign/ad ids kept for reporting.
 * Lead forms don't record permission to TEXT, so acknowledgments go by email unless the form asked (D-32).
 */

/* ---------------- Meta webhook ---------------- */

/** GET verification when the webhook is registered in Meta's app dashboard. */
export function metaVerify(mode: string | null, token: string | null, challenge: string | null): { status: number; body: string } {
  const expected = env().META_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token && token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected)) && challenge) return { status: 200, body: challenge };
  return { status: 403, body: "" };
}

export function verifyMetaSignature(appSecret: string, rawBody: string, header: string | null): boolean {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header?.trim() ?? "");
  if (!m) return false;
  const a = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"), "hex");
  const b = Buffer.from(m[1]!, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

interface MetaNotification { object?: string; entry?: { id?: string; changes?: { field?: string; value?: { leadgen_id?: string | number; page_id?: string | number; form_id?: string | number } }[] }[] }

/** POST: lead notifications for any Page connected to Bluewater's Meta app. Returns quickly; fetching happens in jobs. */
export async function metaWebhook(rawBody: string, signature: string | null): Promise<{ status: number; queued: number }> {
  const secret = env().META_APP_SECRET;
  if (!secret || !verifyMetaSignature(secret, rawBody, signature)) return { status: 401, queued: 0 };
  let body: MetaNotification;
  try { body = JSON.parse(rawBody); } catch { return { status: 400, queued: 0 }; }
  let queued = 0;
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      if (ch.field !== "leadgen" || !ch.value?.leadgen_id) continue;
      const pageId = String(ch.value.page_id ?? entry.id ?? "");
      const source = await withSystemDb("ads: route meta lead by page", async (tx) =>
        (await tx.select().from(adLeadSources).where(and(eq(adLeadSources.kind, "meta_page"), eq(adLeadSources.externalId, pageId), eq(adLeadSources.active, true))))[0] ?? null);
      if (!source) continue; // a Page no company receives from (or turned off): acknowledged and ignored
      if (await registerLeadEvent(source, String(ch.value.leadgen_id), { formId: ch.value.form_id ? String(ch.value.form_id) : null, via: "webhook" })) queued++;
    }
  }
  return { status: 200, queued };
}

/* ---------------- Google lead-form webhook ---------------- */

interface GooglePayload { lead_id?: string; form_id?: string | number; campaign_id?: string | number; adgroup_id?: string | number; creative_id?: string | number; gcl_id?: string; google_key?: string; is_test?: boolean; user_column_data?: { column_id?: string; column_name?: string; string_value?: string }[] }

export async function googleLeadWebhook(pathKey: string, rawBody: string): Promise<{ status: number; queued: boolean }> {
  if (!/^[A-Za-z0-9_-]{24,80}$/.test(pathKey)) return { status: 404, queued: false };
  const source = await withSystemDb("ads: find google webhook", async (tx) =>
    (await tx.select().from(adLeadSources).where(and(eq(adLeadSources.webhookKeyHash, webhookKeyHash(pathKey)), eq(adLeadSources.active, true))))[0] ?? null);
  if (!source?.googleKeyHash) return { status: 404, queued: false };
  let p: GooglePayload;
  try { p = JSON.parse(rawBody); } catch { return { status: 400, queued: false }; }
  const given = Buffer.from(webhookKeyHash(String(p.google_key ?? "")));
  const expected = Buffer.from(source.googleKeyHash);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    await withSystemCompanyDb(source.companyId, "ads: google key mismatch", (tx) => tx.update(adLeadSources).set({ lastError: "A lead arrived with the wrong key. Check the key in the Google Ads lead form matches the one Bluewater gave you." }).where(eq(adLeadSources.id, source.id)));
    return { status: 401, queued: false };
  }
  if (!p.lead_id) return { status: 400, queued: false };
  const lead = mapGooglePayload(p);
  const queued = await registerLeadEvent(source, lead.externalLeadId, { formId: lead.formId ?? null, via: "webhook", payload: lead as unknown as Record<string, unknown>, isTest: Boolean(p.is_test) });
  return { status: 200, queued };
}

export function mapGooglePayload(p: GooglePayload): LeadData {
  return {
    externalLeadId: String(p.lead_id), createdAt: new Date(),
    answers: (p.user_column_data ?? []).map((c) => ({ key: (c.column_id ?? c.column_name ?? "").toLowerCase(), label: c.column_name ?? null, value: c.string_value ?? "" })),
    formId: p.form_id != null ? String(p.form_id) : null, campaignId: p.campaign_id != null ? String(p.campaign_id) : null,
    adsetId: p.adgroup_id != null ? String(p.adgroup_id) : null, adId: p.creative_id != null ? String(p.creative_id) : null, clickId: p.gcl_id ?? null,
  };
}

/* ---------------- Shared: register once, then record in a job ---------------- */

type Source = typeof adLeadSources.$inferSelect;

/** Returns true if this is the first time we've seen this lead (and a job was queued). */
export async function registerLeadEvent(source: Source, externalLeadId: string, o: { formId?: string | null; via: "webhook" | "reconcile" | "simulated"; payload?: Record<string, unknown> | null; isTest?: boolean }): Promise<boolean> {
  return withSystemCompanyDb(source.companyId, "ads: register lead event", async (tx) => {
    const [ev] = await tx.insert(adLeadEvents).values({
      companyId: source.companyId, leadSourceId: source.id, platform: source.platform, externalLeadId: externalLeadId.slice(0, 100), formId: o.formId?.slice(0, 100) ?? null,
      payload: o.payload ?? null, via: o.via, isTest: Boolean(o.isTest), status: o.isTest ? "test" : "received",
    }).onConflictDoNothing().returning({ id: adLeadEvents.id });
    if (o.isTest) {
      // Google's "send test data": proves the connection works; no lead is created.
      await tx.update(adLeadSources).set({ verifiedAt: new Date(), lastError: null }).where(eq(adLeadSources.id, source.id));
      return Boolean(ev);
    }
    if (!ev) return false; // duplicate delivery
    await enqueue(tx, { companyId: source.companyId, kind: "ad_lead_record", key: `adlead:${ev.id}`, payload: { eventId: ev.id }, maxAttempts: 8 });
    return true;
  });
}

const pick = (answers: LeadAnswer[], ...keys: string[]) => answers.find((a) => keys.includes(a.key.toLowerCase()))?.value?.trim() || null;

/** Lead-form answers → the fields every lead has; other answers are kept in the inquiry's message. */
export function leadToInquiryInput(l: LeadData): InquiryInput {
  const a = l.answers ?? [];
  // Stored payloads come back from JSON with the date as text.
  const created = l.createdAt ? new Date(l.createdAt) : null;
  const first = pick(a, "first_name"), last = pick(a, "last_name");
  const name = pick(a, "full_name") ?? ([first, last].filter(Boolean).join(" ") || null);
  const known = new Set(["full_name", "first_name", "last_name", "email", "phone_number", "phone"]);
  const service = a.find((x) => /service|interest|looking for|need/i.test(`${x.key} ${x.label ?? ""}`) && !known.has(x.key))?.value ?? null;
  const other = a.filter((x) => !known.has(x.key) && x.value);
  return {
    fullName: name, email: pick(a, "email"), phone: pick(a, "phone_number", "phone"), serviceRequested: service,
    message: other.length ? other.map((x) => `${x.label ?? x.key.replaceAll("_", " ")}: ${x.value}`).join("\n") : null,
    submittedAt: created && !Number.isNaN(created.getTime()) ? created : undefined,
    tracking: l.clickId ? { gclid: l.clickId } : {},
    externalIds: Object.fromEntries(Object.entries({ lead_id: l.externalLeadId, form_id: l.formId, campaign_id: l.campaignId, adset_id: l.adsetId, ad_id: l.adId, page_id: l.pageId })
      .filter(([, v]) => v).map(([k, v]) => [k, String(v)])),
  };
}

/** Job: fetch (Meta) or read (Google) the lead and record it once. */
export async function handleAdLeadRecord(job: JobRow): Promise<JobOutcome> {
  const companyId = job.companyId!;
  const eventId = String(job.payload.eventId);
  const loaded = await withSystemCompanyDb(companyId, "ads: load lead event", async (tx) => {
    const [ev] = await tx.select().from(adLeadEvents).where(eq(adLeadEvents.id, eventId));
    if (!ev) return null;
    const [src] = await tx.select().from(adLeadSources).where(eq(adLeadSources.id, ev.leadSourceId));
    return { ev, src: src! };
  });
  if (!loaded) return { status: "cancelled", result: "Event not found" };
  const { ev, src } = loaded;
  if (ev.status === "recorded" || ev.status === "test" || ev.status === "rejected") return { status: "succeeded", result: `Already ${ev.status}` };

  let lead: LeadData;
  try {
    if (ev.payload) lead = ev.payload as unknown as LeadData;
    else {
      lead = await clientFor(src.platform as "meta" | "google", src.mode).fetchLead(src.pageTokenEnc ? decrypt(src.pageTokenEnc) : null, ev.externalLeadId);
      lead = { ...lead, pageId: lead.pageId ?? src.externalId };
    }
  } catch (e) {
    await withSystemCompanyDb(companyId, "ads: lead fetch failed", async (tx) => {
      await tx.update(adLeadEvents).set({ attempts: ev.attempts + 1, error: (e as Error).message.slice(0, 300), status: job.attempts >= job.maxAttempts ? "failed" : "received" }).where(eq(adLeadEvents.id, ev.id));
      if (e instanceof AdsAuthError && src.connectionId) await recordConnectionProblem(tx, src.connectionId, e, true);
    });
    if (e instanceof AdsRateLimitError) return { status: "reschedule", runAt: new Date(Date.now() + e.retryAfterMs), result: "Rate limited" };
    return { status: "retry", error: (e as Error).message };
  }

  return withSystemCompanyDb(companyId, "ads: record lead", async (tx) => {
    const [cur] = await tx.select().from(adLeadEvents).where(eq(adLeadEvents.id, ev.id)).for("update");
    if (cur!.status === "recorded") return { status: "succeeded", result: "Already recorded" } as JobOutcome;
    const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
    const policy = accountPolicy(company!);
    if (policy.intake === "reject") {
      await tx.update(adLeadEvents).set({ status: "rejected", error: "The account's service has ended", payload: null, processedAt: new Date() }).where(eq(adLeadEvents.id, ev.id));
      return { status: "cancelled", result: "Account closed" } as JobOutcome;
    }
    const input = leadToInquiryInput(lead);
    const v = validateInquiry(input);
    if (!v.ok) {
      await tx.update(adLeadEvents).set({ status: "failed", error: v.problems.join(" ").slice(0, 300), payload: null, processedAt: new Date() }).where(eq(adLeadEvents.id, ev.id));
      return { status: "cancelled", result: "Lead had no usable contact details" } as JobOutcome;
    }
    const simulated = src.mode === "simulated" || ev.via === "simulated";
    const label = `${lead.formName ?? (src.platform === "meta" ? "Facebook/Instagram lead form" : "Google lead form")}${simulated && !/simulated/i.test(lead.formName ?? "") ? " (simulated)" : ""}`;
    const res = await recordInquiry(tx, input, {
      companyId, source: src.platform === "meta" ? "meta_lead_form" : "google_lead_form", sourceLabel: label.slice(0, 200),
      automationOrigin: policy.intake === "process" ? "eligible" : "held", actorType: "system",
    });
    await enqueueNewLeadWork(tx, companyId, res.inquiry.id, res.inquiry.automationOrigin);
    await tx.update(adLeadEvents).set({ status: "recorded", inquiryId: res.inquiry.id, payload: null, error: null, attempts: ev.attempts + 1, processedAt: new Date() }).where(eq(adLeadEvents.id, ev.id));
    await tx.update(adLeadSources).set({ lastLeadAt: new Date(), lastError: null }).where(eq(adLeadSources.id, src.id));
    return { status: "succeeded", result: "Recorded" } as JobOutcome;
  });
}

/* ---------------- Missed-lead reconciliation (Meta) ---------------- */

/** Job: ask Meta for leads created since the last check on each receiving Page; record any we missed. */
export async function handleAdLeadReconcile(job: JobRow): Promise<JobOutcome> {
  const companyId = job.companyId!;
  const sources = await withSystemCompanyDb(companyId, "ads: load pages for reconcile", (tx) =>
    tx.select().from(adLeadSources).where(and(eq(adLeadSources.kind, "meta_page"), eq(adLeadSources.active, true))));
  let found = 0;
  for (const src of sources) {
    const since = new Date((src.lastCheckedAt ?? new Date(Date.now() - 7 * 86_400_000)).getTime() - 60 * 60_000); // 1 h overlap
    const started = new Date();
    try {
      const leads = await clientFor("meta", src.mode).listRecentLeads(src.pageTokenEnc ? decrypt(src.pageTokenEnc) : null, src.externalId!, since);
      for (const l of leads) if (await registerLeadEvent(src, l.externalLeadId, { formId: l.formId, via: "reconcile" })) found++;
      await withSystemCompanyDb(companyId, "ads: reconcile checked", (tx) => tx.update(adLeadSources).set({ lastCheckedAt: started }).where(eq(adLeadSources.id, src.id)));
    } catch (e) {
      await withSystemCompanyDb(companyId, "ads: reconcile failed", async (tx) => {
        await tx.update(adLeadSources).set({ lastError: (e as Error).message.slice(0, 300) }).where(eq(adLeadSources.id, src.id));
        if (e instanceof AdsAuthError && src.connectionId) await recordConnectionProblem(tx, src.connectionId, e, true);
      });
      if (e instanceof AdsRateLimitError) return { status: "reschedule", runAt: new Date(Date.now() + e.retryAfterMs), result: "Rate limited" };
    }
  }
  return { status: "succeeded", result: `${found} missed lead(s) found` };
}

/* ---------------- Simulator ---------------- */

/** Development/test/demo only: a fake lead arrives on a Page or the Google webhook, through the same path. */
export async function sendSimulatedAdLead(ctx: CompanyContext, sourceId: string) {
  if (!roleCan(ctx.role, "integration.manage")) throw new UserError("You don't have permission to do that.");
  if (!isSimulatedEnvironment() && ctx.companyKind === "customer") throw new UserError("Simulation isn't available here.");
  const src = await withCompanyDb(ctx, async (tx) => (await tx.select().from(adLeadSources).where(and(eq(adLeadSources.id, sourceId), eq(adLeadSources.active, true))))[0] ?? null);
  if (!src) throw new UserError("Turn on this lead source first.");
  const id = `sim_${crypto.randomUUID()}`;
  const lead = simulatedLead(src.platform as "meta" | "google", id, src.externalId);
  await registerLeadEvent(src, id, { formId: lead.formId, via: "simulated", payload: lead as unknown as Record<string, unknown> });
  return id;
}
