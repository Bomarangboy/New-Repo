import { and, eq, gt, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { contacts, conversations, inquiries, inquiryEvents, intakeSources, messages, notes, suppressions, tasks } from "@/lib/db/schema";
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
