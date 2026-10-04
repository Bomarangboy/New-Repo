import { and, eq, sql } from "drizzle-orm";
import { withCompanyDb } from "@/lib/db/context";
import { adLeadSources, bookingSettings, companies, companySenders, intakeSources, memberships, messageTemplates, messagingSettings, notifications, sequences } from "@/lib/db/schema";
import { hasFeature } from "@/lib/authz/entitlements";
import type { CompanyContext } from "@/lib/authz/context-types";
import { timezoneLabel } from "@/lib/timezones";

export type StepStatus = "ready" | "pending" | "attention" | "na";
export interface OnboardingStep { key: string; title: string; detail: string; status: StepStatus; owner: "you" | "bluewater" }

/**
 * Onboarding checklist computed from real records. Steps whose features are not built
 * yet stay "pending" with an honest explanation — never marked ready by default.
 */
export async function onboardingChecklist(ctx: CompanyContext): Promise<OnboardingStep[]> {
  const { company, teamSize, sources, senders, reviewed, alerts, seqs, booking } = await withCompanyDb(ctx, async (tx) => {
    const [company] = await tx.select().from(companies).where(eq(companies.id, ctx.companyId));
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(memberships)
      .where(and(eq(memberships.companyId, ctx.companyId), eq(memberships.status, "active")))) as [{ n: number }];
    const sources = [
      ...(await tx.select({ active: intakeSources.active, last: intakeSources.lastReceivedAt }).from(intakeSources)),
      ...(await tx.select({ active: adLeadSources.active, last: adLeadSources.lastLeadAt }).from(adLeadSources)),
    ];
    const senders = await tx.select({ channel: companySenders.channel, status: companySenders.status }).from(companySenders);
    const [settings] = await tx.select().from(messagingSettings).where(eq(messagingSettings.companyId, ctx.companyId));
    const [{ t }] = (await tx.select({ t: sql<number>`count(*)::int` }).from(messageTemplates)) as [{ t: number }];
    const [{ alerts }] = (await tx.select({ alerts: sql<number>`count(*) filter (where ${notifications.emailStatus} = 'sent')::int` }).from(notifications)) as [{ alerts: number }];
    const seqs = await tx.select({ status: sequences.status, autoEnroll: sequences.autoEnroll }).from(sequences);
    const [booking] = await tx.select().from(bookingSettings).where(eq(bookingSettings.companyId, ctx.companyId));
    return { company: company!, teamSize: n, sources, senders, reviewed: Boolean(settings && (t > 0 || settings.updatedAt.getTime() - settings.createdAt.getTime() > 1000)), alerts, seqs, booking: booking ?? null };
  });
  const p2 = hasFeature(company.package, "booking");
  return [
    { key: "details", title: "Company details & timezone", detail: `Timezone: ${timezoneLabel(company.timezone)}`, status: "ready", owner: "you" },
    { key: "team", title: "Invite your team", detail: teamSize > 1 ? `${teamSize} people have access` : "Invite the people who will answer leads", status: teamSize > 1 ? "ready" : "pending", owner: "you" },
    { key: "crm", title: "Choose where customer records live", detail: company.crmMode === "unselected" ? "Built-in CRM or a supported external CRM" : company.crmMode === "built_in" ? "Using the built-in CRM" : "External CRM", status: company.crmMode === "unselected" ? "attention" : "ready", owner: "you" },
    sourceStep(sources),
    senderStep(senders),
    { key: "permissions", title: "Contact permissions & opt-outs", detail: "Confirm how leads agree to be contacted", status: "pending", owner: "you" },
    { key: "templates", title: "Acknowledgment message & timing", detail: reviewed ? "Reviewed under Automations" : "Review the first reply new leads receive (Automations)", status: reviewed ? "ready" : "pending", owner: "you" },
    followUpStep(p2, seqs),
    bookingStep(p2, booking),
    { key: "notifications", title: "Team notifications", detail: alerts > 0 ? "Your team is receiving lead alerts" : "Who is alerted about new leads and replies (Automations)", status: alerts > 0 ? "ready" : "pending", owner: "you" },
    { key: "test", title: "Controlled end-to-end test", detail: "A test lead, verified before anything reaches real customers", status: "pending", owner: "bluewater" },
    { key: "activation", title: "Activation", detail: company.lifecycleStatus === "active" ? "Your service is active" : "Bluewater activates automation after the test passes", status: company.lifecycleStatus === "active" ? "ready" : "pending", owner: "bluewater" },
  ];
}

function sourceStep(sources: { active: boolean; last: Date | null }[]): OnboardingStep {
  const active = sources.filter((x) => x.active);
  const base = { key: "sources", title: "Connect lead sources", owner: "you" as const };
  if (active.some((x) => x.last)) return { ...base, detail: `${active.filter((x) => x.last).length} of ${active.length} lead source${active.length > 1 ? "s" : ""} receiving leads`, status: "ready" };
  if (active.length) return { ...base, detail: "Connected — send a test submission or test lead to confirm it works", status: "attention" };
  return { ...base, detail: "Connect your website form and Facebook/Instagram or Google lead forms under Connected Accounts", status: "pending" };
}

function senderStep(senders: { channel: string; status: string }[]): OnboardingStep {
  const base = { key: "senders", title: "Set up text & email senders", owner: "bluewater" as const };
  const verified = senders.filter((x) => x.status === "verified").map((x) => (x.channel === "sms" ? "texts" : "email"));
  if (verified.length === 2) return { ...base, detail: "Text number and email domain verified", status: "ready" };
  if (verified.length === 1) return { ...base, detail: `Verified for ${verified[0]}; the other channel is still being set up`, status: "ready" };
  if (senders.some((x) => x.status === "pending_verification")) return { ...base, detail: "Registration submitted; waiting for carrier/domain approval (often days to weeks)", status: "pending" };
  return { ...base, detail: "Bluewater registers your texting number and verifies your email domain", status: "pending" };
}

function followUpStep(included: boolean, seqs: { status: string; autoEnroll: boolean }[]): OnboardingStep {
  const base = { key: "follow_up", title: "Follow-up messages", owner: "you" as const };
  if (!included) return { ...base, detail: "Included in Bluewater Engage", status: "na" };
  if (seqs.some((x) => x.status === "active" && x.autoEnroll)) return { ...base, detail: "A follow-up sequence starts automatically for new website leads", status: "ready" };
  if (seqs.length) return { ...base, detail: "A sequence exists — review it and turn it on (Automations)", status: "attention" };
  return { ...base, detail: "Create the messages new leads receive over the following days (Automations)", status: "pending" };
}

function bookingStep(included: boolean, b: { bookingUrl: string | null; status: string; lastError: string | null } | null): OnboardingStep {
  const base = { key: "booking", title: "Booking link & reminders", owner: "you" as const };
  if (!included) return { ...base, detail: "Included in Bluewater Engage", status: "na" };
  if (b?.status === "connected") return { ...base, detail: b.bookingUrl ? "Cal.com connected; bookings update leads automatically" : "Cal.com connected — add your booking page address too", status: b.bookingUrl ? "ready" : "attention" };
  if (b?.status === "waiting_for_test") return { ...base, detail: b.lastError ? `Waiting for Cal.com's test message. Last problem: ${b.lastError}` : "Waiting for Cal.com's test message (press Ping test in Cal.com)", status: "attention" };
  return { ...base, detail: b?.bookingUrl ? "Booking page saved — connect automatic updates (Connected Accounts)" : "Add your Cal.com booking page and connect it (Connected Accounts)", status: "pending" };
}
