import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { adAccounts, adCampaigns, adConnections, adDailyMetrics, adLeadSources, adSyncRuns, appointments, companies, contacts, conversations, inquiries, inquiryEvents, intakeSources, messages, notes, sequenceEnrollments, sequenceSteps, sequences, suppressions, tasks } from "@/lib/db/schema";
import { hasFeature } from "@/lib/authz/entitlements";
import { enqueue } from "@/server/jobs/queue";
import { DEFAULT_SEQUENCE_STEPS, renderTemplate } from "@/server/messaging/templates";
import { encrypt } from "@/lib/crypto";
import { localDateKey } from "@/lib/periods";
import { SIM_CAMPAIGNS, simulatedClient } from "@/server/ads/clients/simulated";
import { newToken } from "@/lib/crypto";
import { recordInquiry, type InquirySource } from "@/server/crm/record-inquiry";

/**
 * FICTIONAL sample data for development and the sales demo. Every record goes through the
 * same recordInquiry() path as real leads, so dashboards computed from these records are
 * internally consistent by construction. Deterministic: the same seed gives the same data.
 * Names use reserved example domains/numbers (example.com, 555-01xx) and belong to no one.
 */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Jordan", "Taylor", "Morgan", "Casey", "Riley", "Avery", "Quinn", "Jamie", "Drew", "Reese", "Sam", "Alex", "Cameron", "Dakota", "Emerson", "Finley", "Harper", "Kai", "Logan", "Parker", "Rowan", "Sage", "Skyler", "Blake"];
const LAST = ["Lee", "Reed", "Diaz", "Nguyen", "Patel", "Garcia", "Kim", "Brooks", "Foster", "Hughes", "Ortiz", "Price", "Ramirez", "Sullivan", "Turner", "Walsh", "Young", "Bennett", "Coleman", "Hayes"];
const SERVICES = ["Roof repair", "Gutter cleaning", "Water heater install", "AC tune-up", "Drain cleaning", "Kitchen remodel quote", "Window replacement", "Furnace repair"];
const MESSAGES = ["Looking for a quote this week.", "Is someone available Saturday?", "Noticed a leak after the storm.", "How soon could you come out?", "Need an estimate for my rental property.", ""];
const LOST = ["Chose another company", "Price too high", "No response after 3 attempts", "Project postponed"];

interface Mix { source: InquirySource; label: string; weight: number; tracking?: () => Record<string, string> }

export interface DatasetOptions {
  companyId: string;
  memberIds: string[];
  days?: number;
  perDayBase?: number;
  seed?: number;
  now?: Date;
}

export async function generateDemoDataset(tx: Tx, o: DatasetOptions) {
  const rand = rng(o.seed ?? 42);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const now = o.now ?? new Date();
  const days = o.days ?? 90;

  const [form] = await tx.insert(intakeSources).values({ companyId: o.companyId, name: "Website contact form", publicKey: newToken(18), allowedOrigins: [], lastReceivedAt: now }).returning();
  const mix: Mix[] = [
    { source: "website_form", label: form!.name, weight: 0.45, tracking: (): Record<string, string> => (rand() < 0.5 ? { utm_source: "google", utm_medium: "cpc", utm_campaign: pick(["spring-roofing", "emergency-repairs", "brand"]), gclid: `demo-${Math.floor(rand() * 1e9)}` } : rand() < 0.5 ? { utm_source: "facebook", utm_medium: "paid_social", utm_campaign: "spring-offer", fbclid: `demo-${Math.floor(rand() * 1e9)}` } : {}) },
    { source: "meta_lead_form", label: "Facebook/Instagram (sample)", weight: 0.3, tracking: () => ({ utm_source: "facebook", utm_campaign: "spring-offer" }) },
    { source: "google_lead_form", label: "Google lead form (sample)", weight: 0.15 },
    { source: "manual", label: "Entered manually", weight: 0.1 },
  ];
  const chooseSource = () => { let r = rand(); for (const m of mix) { if ((r -= m.weight) <= 0) return m; } return mix[0]!; };

  // Fictional people. Phones use the reserved 555-0100…0199 range, so at most 100 people get one.
  const people: { name: string; email?: string; phone?: string }[] = [];
  const newPerson = () => {
    const i = people.length;
    const first = pick(FIRST), last = pick(LAST);
    const phone = i < 100 && rand() < 0.85 ? `415-555-01${String(i).padStart(2, "0")}` : undefined;
    const p = { name: `${first} ${last}`, email: !phone || rand() < 0.9 ? `${first}.${last}.${i}@example.com`.toLowerCase() : undefined, phone };
    people.push(p);
    return p;
  };

  let created = 0;
  for (let d = days - 1; d >= 0; d--) {
    // Gentle upward trend with weekday rhythm.
    const trend = 1 + (days - d) / days * 0.6;
    const weekday = new Date(now.getTime() - d * 86400_000).getUTCDay();
    const n = Math.max(0, Math.round((o.perDayBase ?? 1.2) * trend * (weekday === 0 ? 0.4 : weekday === 6 ? 0.7 : 1) + (rand() - 0.5) * 2));
    for (let i = 0; i < n; i++) {
      // ~12% of inquiries come back from someone already in the records (a genuine repeat).
      const person = people.length > 5 && rand() < 0.12 ? pick(people) : newPerson();
      const submittedAt = new Date(now.getTime() - d * 86400_000 - Math.floor(rand() * 10 * 3600_000));
      if (submittedAt > now) continue;
      const m = chooseSource();
      const res = await recordInquiry(tx, {
        fullName: person.name, email: person.email, phone: person.phone,
        serviceRequested: pick(SERVICES), message: pick(MESSAGES), submittedAt, tracking: m.tracking?.() ?? {},
        consent: m.source === "manual" || !person.phone ? [] : [{ channel: "sms", purpose: "inquiry_response", granted: rand() < 0.8, method: m.source === "website_form" ? "web_form_checkbox" : "lead_form", statement: "Text me about my request. Reply STOP to opt out. (sample)" }],
      }, { companyId: o.companyId, source: m.source, sourceLabel: m.label, intakeSourceId: m.source === "website_form" ? form!.id : null, automationOrigin: "none", actorType: "system", assignedUserId: o.memberIds.length ? pick(o.memberIds) : null });
      created++;
      // Sample leads are "received" when they were submitted (a few seconds later), not when the seed ran.
      await tx.update(inquiries).set({ receivedAt: new Date(submittedAt.getTime() + 2000 + Math.floor(rand() * 8000)) }).where(eq(inquiries.id, res.inquiry.id));

      // Older leads are further along the pipeline.
      const age = d / days;
      const r = rand();
      const stage = d < 2 ? (r < 0.7 ? "new" : "contacted")
        : r < 0.1 * (1 - age) ? "new" : r < 0.35 ? "contacted" : r < 0.55 ? "booked" : r < 0.55 + 0.25 * (0.4 + age) ? "won" : "lost";
      if (stage !== "new") {
        const changedAt = new Date(Math.min(now.getTime(), submittedAt.getTime() + (1 + rand() * 5) * 86400_000));
        const sale = stage === "won" && rand() < 0.9 ? Math.round((300 + rand() * 4700) / 25) * 2500 : null;
        await tx.update(inquiries).set({
          stage, stageChangedAt: changedAt, wonAt: stage === "won" ? changedAt : null, saleValueCents: sale,
          lostReason: stage === "lost" ? pick(LOST) : null,
        }).where(eq(inquiries.id, res.inquiry.id));
        await tx.insert(inquiryEvents).values({ companyId: o.companyId, inquiryId: res.inquiry.id, type: "stage_changed", actorType: "system", details: { from: "new", to: stage, sample: true }, createdAt: changedAt });
      }
      if (rand() < 0.25) await tx.insert(notes).values({ companyId: o.companyId, inquiryId: res.inquiry.id, body: pick(["Left a voicemail.", "Customer prefers texts.", "Sent quote by email.", "Wants a weekend appointment."]), createdAt: new Date(submittedAt.getTime() + 3600_000) });
      if ((stage === "new" || stage === "contacted") && rand() < 0.5) {
        await tx.insert(tasks).values({ companyId: o.companyId, inquiryId: res.inquiry.id, title: pick(["Call back", "Send quote", "Confirm address"]), dueAt: new Date(now.getTime() + Math.floor(rand() * 4) * 86400_000), assignedUserId: o.memberIds.length ? pick(o.memberIds) : null });
      }
    }
  }
  await sampleConversations(tx, o.companyId, now, rand, pick);
  const [co] = await tx.select({ package: companies.package, name: companies.name }).from(companies).where(eq(companies.id, o.companyId));
  if (co && hasFeature(co.package, "sequences")) await sampleFollowUpsAndBookings(tx, o.companyId, co.name, now, rand);
  if (co) await sampleAds(tx, o.companyId, hasFeature(co.package, "ad_reporting"), now, rand);
  return { created };
}

/**
 * Fictional, SIMULATED message history for recent leads: automatic acknowledgments, some replies,
 * team answers, a few conversations waiting for a reply, and one opt-out. Every row is marked
 * transport = "simulated" so it can never be mistaken for a real delivery.
 */
async function sampleConversations(tx: Tx, companyId: string, now: Date, rand: () => number, pick: <T>(xs: readonly T[]) => T) {
  const recent = await tx.select({ i: inquiries, c: { id: contacts.id, name: contacts.fullName, email: contacts.email, phone: contacts.phoneE164 } })
    .from(inquiries).innerJoin(contacts, eq(contacts.id, inquiries.contactId))
    .where(and(eq(inquiries.companyId, companyId), gt(inquiries.submittedAt, new Date(now.getTime() - 21 * 86400_000)), sql`${inquiries.source} <> 'manual'`));
  const REPLIES = ["Thanks! Is Thursday morning possible?", "Great, what does a visit cost?", "Can you send a quote by email?", "Yes please call me after 5pm."];
  const ANSWERS = ["Thursday at 9am works — see you then!", "Our visit fee is $89, credited toward the job.", "Absolutely, sending it over today.", "Will do — talk this evening."];
  let optedOut = false;
  for (const { i, c } of recent) {
    const to = c.phone ?? c.email;
    if (!to) continue;
    const channel = c.phone ? "sms" : "email";
    const t0 = new Date(i.receivedAt.getTime() + 20_000 + Math.floor(rand() * 40_000));
    const [conv] = await tx.insert(conversations).values({ companyId, contactId: c.id }).onConflictDoNothing().returning();
    if (!conv) continue;
    const first = (c.name.split(" ")[0] || "there");
    const ins = (v: Partial<typeof messages.$inferInsert> & { createdAt: Date; body: string; direction: string; kind: string; status: string }) =>
      tx.insert(messages).values({ companyId, conversationId: conv.id, contactId: c.id, inquiryId: i.id, channel, toAddress: to, transport: "simulated", ...v,
        providerMessageId: `sim_seed_${crypto.randomUUID()}`, statusUpdatedAt: v.createdAt });
    await ins({ direction: "outbound", kind: "acknowledgment", status: "delivered", createdAt: t0, submittedAt: t0, deliveredAt: t0,
      body: channel === "sms" ? `Hi ${first}, thanks for contacting us! We received your request about ${i.serviceRequested ?? "your project"} and will be in touch shortly. Reply STOP to opt out.` : `Hi ${first},\n\nThanks for reaching out — we received your request and will get back to you shortly.`,
      subject: channel === "email" ? "We received your request" : null, templateKey: channel === "sms" ? "ack_sms" : "ack_email", templateVersion: 0 });
    let last = t0, needsReply = false, lastInbound: Date | null = null, lastHuman: Date | null = null;
    if (!optedOut && channel === "sms" && rand() < 0.08) {
      const t = new Date(t0.getTime() + 600_000);
      await ins({ direction: "inbound", kind: "inbound", status: "received", createdAt: t, body: "STOP", statusReason: "opt_out", toAddress: "" });
      await tx.insert(suppressions).values({ companyId, channel: "sms", address: to, reason: "opt_out_keyword", detail: "STOP (sample)", createdAt: t }).onConflictDoNothing();
      optedOut = true; last = t; lastInbound = t;
    } else if (rand() < 0.4) {
      const k = Math.floor(rand() * REPLIES.length);
      const tIn = new Date(t0.getTime() + (10 + rand() * 300) * 60_000);
      if (tIn < now) {
        await ins({ direction: "inbound", kind: "inbound", status: "received", createdAt: tIn, body: REPLIES[k]!, toAddress: "" });
        last = tIn; lastInbound = tIn;
        const tOut = new Date(tIn.getTime() + (5 + rand() * 90) * 60_000);
        if (rand() < 0.75 && tOut < now) {
          await ins({ direction: "outbound", kind: "manual", status: "delivered", createdAt: tOut, submittedAt: tOut, deliveredAt: tOut, body: ANSWERS[k]! });
          last = tOut; lastHuman = tOut;
        } else needsReply = true;
      }
    }
    await tx.update(conversations).set({ lastMessageAt: last, lastInboundAt: lastInbound, lastHumanOutboundAt: lastHuman, needsReply }).where(eq(conversations.id, conv.id));
  }
  void pick;
}

/**
 * Package 2+ sample data: one follow-up sequence (on, automatic), follow-ups at every stage (running,
 * finished, stopped because the person replied or booked), and SIMULATED appointments for booked and
 * won leads. No booking tool is connected — appointments are labeled "simulated" everywhere.
 */
async function sampleFollowUpsAndBookings(tx: Tx, companyId: string, companyName: string, now: Date, rand: () => number) {
  const DAY = 86_400_000, MIN = 60_000;
  const [seq] = await tx.insert(sequences).values({ companyId, name: "New lead follow-up", status: "active", autoEnroll: true, currentVersion: 1 }).returning();
  await tx.insert(sequenceSteps).values(DEFAULT_SEQUENCE_STEPS.map((st, position) => ({ companyId, sequenceId: seq!.id, version: 1, position, ...st })));
  const delays = DEFAULT_SEQUENCE_STEPS.map((x) => x.delayMinutes * MIN);

  const leads = await tx.select({ i: inquiries, c: contacts }).from(inquiries).innerJoin(contacts, eq(contacts.id, inquiries.contactId))
    .where(and(eq(inquiries.companyId, companyId), gt(inquiries.submittedAt, new Date(now.getTime() - 20 * DAY)), inArray(inquiries.source, ["website_form", "meta_lead_form", "google_lead_form"])))
    .orderBy(asc(inquiries.submittedAt));
  const seen = new Set<string>();
  for (const { i, c } of leads) {
    if (seen.has(c.id)) continue; // one follow-up per person
    seen.add(c.id);
    const start = new Date(i.receivedAt.getTime() + 60_000);
    const [conv] = await tx.select().from(conversations).where(eq(conversations.contactId, c.id));
    const [reply] = await tx.select({ at: messages.createdAt }).from(messages).where(and(eq(messages.contactId, c.id), eq(messages.direction, "inbound"))).limit(1);
    const channel = c.phoneE164 ? "sms" : c.email ? "email" : null;
    if (!conv || !channel) continue;
    const vars = { first_name: c.fullName.split(" ")[0] ?? "", company_name: companyName, service: i.serviceRequested ?? "" };
    const sendStep = async (k: number, at: Date) => {
      const st = DEFAULT_SEQUENCE_STEPS[k]!;
      await tx.insert(messages).values({
        companyId, conversationId: conv.id, contactId: c.id, inquiryId: i.id, direction: "outbound", channel, kind: "follow_up", status: "delivered",
        toAddress: channel === "sms" ? c.phoneE164! : c.email!, transport: "simulated", providerMessageId: `sim_seed_${crypto.randomUUID()}`,
        subject: channel === "email" ? renderTemplate(st.emailSubject, vars) : null, body: renderTemplate(channel === "sms" ? st.smsBody : st.emailBody, vars),
        idempotencyKey: `seq:sample:${i.id}:${k}`, templateKey: `sequence:${seq!.id}:step${k + 1}`, templateVersion: 1, createdAt: at, submittedAt: at, deliveredAt: at, statusUpdatedAt: at,
      });
    };
    const base = { companyId, sequenceId: seq!.id, version: 1, inquiryId: i.id, contactId: c.id, origin: "auto", enrolledAt: start, createdAt: start };
    // When each step would have gone out.
    const at: Date[] = [];
    delays.reduce((t, d) => { const x = new Date(t.getTime() + d); at.push(x); return x; }, start);
    const sentBefore = (limit: Date) => at.filter((x) => x < limit && x < now).length;

    if (reply || i.stage === "booked" || i.stage === "won" || i.stage === "lost") {
      const end = reply ? reply.at : i.stageChangedAt;
      const k = sentBefore(end);
      for (let s = 0; s < k; s++) await sendStep(s, at[s]!);
      const code = reply ? "replied" : i.stage === "booked" ? "booked" : "closed";
      await tx.insert(sequenceEnrollments).values({ ...base, status: "stopped", nextStep: k, stopCode: code, endedAt: end,
        stopReason: code === "replied" ? "They replied" : code === "booked" ? "They booked an appointment" : `The lead was marked ${i.stage}` });
    } else if (at[at.length - 1]! < now) {
      for (let s = 0; s < at.length; s++) await sendStep(s, at[s]!);
      await tx.insert(sequenceEnrollments).values({ ...base, status: "completed", nextStep: at.length, endedAt: at[at.length - 1]! });
    } else {
      const next = sentBefore(now);
      for (let s = 0; s < next; s++) await sendStep(s, at[s]!);
      const runAt = at[next]!;
      const paused = rand() < 0.1;
      const [e] = await tx.insert(sequenceEnrollments).values({ ...base, status: paused ? "paused" : "active", nextStep: next, nextRunAt: runAt, pausedAt: paused ? new Date(now.getTime() - 3600_000) : null }).returning();
      if (!paused) await enqueue(tx, { companyId, kind: "sequence_step", key: `seq:${e!.id}:${next}`, payload: { enrollmentId: e!.id, step: next }, runAt });
    }
  }

  // Simulated appointments: booked leads get one (mostly upcoming); some won leads had one in the past.
  const booked = await tx.select().from(inquiries).where(and(eq(inquiries.companyId, companyId), inArray(inquiries.stage, ["booked", "won"]), gt(inquiries.stageChangedAt, new Date(now.getTime() - 30 * DAY))));
  for (const i of booked) {
    if (i.stage === "won" && rand() < 0.5) continue;
    let startsAt = new Date(i.stageChangedAt.getTime() + (1 + Math.floor(rand() * 6)) * DAY);
    startsAt.setUTCHours(13 + Math.floor(rand() * 8), rand() < 0.5 ? 0 : 30, 0, 0);
    if (i.stage === "booked" && startsAt < now) startsAt = new Date(now.getTime() + (1 + Math.floor(rand() * 9)) * DAY), startsAt.setUTCHours(13 + Math.floor(rand() * 8), 0, 0, 0);
    const status = startsAt > now ? "scheduled" : i.stage === "won" ? "completed" : rand() < 0.8 ? "completed" : "no_show";
    const [a] = await tx.insert(appointments).values({
      companyId, inquiryId: i.id, contactId: i.contactId, source: "simulated", externalId: `sim_seed_${crypto.randomUUID()}`, status, startsAt,
      endsAt: new Date(startsAt.getTime() + 3600_000), title: i.serviceRequested ? `Estimate: ${i.serviceRequested}` : "Estimate visit", lastEventAt: i.stageChangedAt, createdAt: i.stageChangedAt,
    }).returning();
    await tx.insert(inquiryEvents).values({ companyId, inquiryId: i.id, type: "appointment_booked", actorType: "system", details: { appointmentId: a!.id, startsAt: startsAt.toISOString(), source: "simulated", sample: true }, createdAt: i.stageChangedAt });
    if (status === "scheduled") {
      for (const off of [1440, 120]) {
        const runAt = new Date(startsAt.getTime() - off * MIN);
        if (runAt > now) await enqueue(tx, { companyId, kind: "booking_message", key: `bremind:${a!.id}:${off}:${startsAt.getTime()}`, payload: { appointmentId: a!.id, startsAt: startsAt.toISOString(), type: "reminder", offsetMinutes: off }, runAt });
      }
    }
  }
}

/**
 * SIMULATED ad connections. Every company with sample data gets a simulated Meta Page receiving lead-form leads;
 * Package 3 companies also get simulated Meta + Google ad accounts with 90 days of sample numbers. The sample
 * lead-form leads are linked to the sample campaigns, so Reports can credit them. All labeled "simulated".
 */
async function sampleAds(tx: Tx, companyId: string, reporting: boolean, now: Date, rand: () => number) {
  for (const platform of reporting ? (["meta", "google"] as const) : (["meta"] as const)) {
    const client = simulatedClient(platform, companyId);
    const [conn] = await tx.insert(adConnections).values({
      companyId, platform, mode: "simulated", status: "connected", accountLabel: "Sample account (simulated)", accessTokenEnc: encrypt(`sim_token_${platform}`),
      scopes: ["simulated"], connectedAt: new Date(now.getTime() - 95 * 86_400_000), lastSyncAt: now, lastSyncOkAt: now,
    }).returning();
    for (const pg of await client.listPages({ accessToken: "x" })) {
      await tx.insert(adLeadSources).values({ companyId, connectionId: conn!.id, platform, kind: "meta_page", externalId: pg.externalId, name: pg.name, mode: "simulated", pageTokenEnc: encrypt("sim"), active: true, verifiedAt: conn!.connectedAt, lastCheckedAt: now });
    }
    if (!reporting) continue;
    const [acct] = await client.listAdAccounts({ accessToken: "x" });
    const [a] = await tx.insert(adAccounts).values({ companyId, connectionId: conn!.id, platform, externalId: acct!.externalId, name: acct!.name, currency: acct!.currency, timezone: acct!.timezone, selected: true }).returning();
    const to = localDateKey(now, acct!.timezone ?? "UTC");
    const from = new Date(Date.parse(`${to}T12:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10);
    const rows = await client.fetchDailyCampaignMetrics({ accessToken: "x" }, { externalId: acct!.externalId, currency: acct!.currency }, from, to);
    for (const r of rows) {
      await tx.insert(adDailyMetrics).values({ companyId, adAccountId: a!.id, platform, campaignExternalId: r.campaignId, day: r.day, currency: "USD", spendMicros: r.spendMicros, impressions: r.impressions, clicks: r.clicks, platformLeads: r.platformLeads, platformConversions: r.platformConversions, mode: "simulated", fetchedAt: now });
    }
    for (const c of SIM_CAMPAIGNS[platform]) await tx.insert(adCampaigns).values({ companyId, adAccountId: a!.id, platform, externalId: c.id, name: c.name, status: "ENABLED" });
    await tx.insert(adSyncRuns).values({ companyId, connectionId: conn!.id, kind: "metrics", status: "succeeded", rangeFrom: from, rangeTo: to, rows: rows.length, startedAt: now, finishedAt: now });
  }
  // Link sample lead-form leads to sample campaigns (most of them; some arrive without a campaign id, as in real life).
  const formLeads = await tx.select({ id: inquiries.id, source: inquiries.source, ext: inquiries.externalIds }).from(inquiries)
    .where(and(eq(inquiries.companyId, companyId), inArray(inquiries.source, ["meta_lead_form", "google_lead_form"])));
  for (const l of formLeads) {
    if (rand() < 0.1) continue;
    const list = SIM_CAMPAIGNS[l.source === "meta_lead_form" ? "meta" : "google"];
    const camp = list[rand() < 0.7 ? 0 : 1]!;
    await tx.update(inquiries).set({ externalIds: { ...l.ext, campaign_id: camp.id, lead_id: `sample_${l.id.slice(0, 8)}` } }).where(eq(inquiries.id, l.id));
  }
}
