import { and, eq, sql } from "drizzle-orm";
import { withCompanyDb } from "@/lib/db/context";
import { companies, intakeSources, memberships } from "@/lib/db/schema";
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
  const { company, teamSize, sources } = await withCompanyDb(ctx, async (tx) => {
    const [company] = await tx.select().from(companies).where(eq(companies.id, ctx.companyId));
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(memberships)
      .where(and(eq(memberships.companyId, ctx.companyId), eq(memberships.status, "active")))) as [{ n: number }];
    const sources = await tx.select({ active: intakeSources.active, last: intakeSources.lastReceivedAt }).from(intakeSources);
    return { company: company!, teamSize: n, sources };
  });
  const p2 = hasFeature(company.package, "booking");
  return [
    { key: "details", title: "Company details & timezone", detail: `Timezone: ${timezoneLabel(company.timezone)}`, status: "ready", owner: "you" },
    { key: "team", title: "Invite your team", detail: teamSize > 1 ? `${teamSize} people have access` : "Invite the people who will answer leads", status: teamSize > 1 ? "ready" : "pending", owner: "you" },
    { key: "crm", title: "Choose where customer records live", detail: company.crmMode === "unselected" ? "Built-in CRM or a supported external CRM" : company.crmMode === "built_in" ? "Using the built-in CRM" : "External CRM", status: company.crmMode === "unselected" ? "attention" : "ready", owner: "you" },
    sourceStep(sources),
    { key: "senders", title: "Set up text & email senders", detail: "Bluewater registers your texting number and verifies your email domain", status: "pending", owner: "bluewater" },
    { key: "permissions", title: "Contact permissions & opt-outs", detail: "Confirm how leads agree to be contacted", status: "pending", owner: "you" },
    { key: "templates", title: "Acknowledgment message & timing", detail: "Review the first reply new leads receive", status: "pending", owner: "you" },
    { key: "booking", title: "Booking link & reminders", detail: p2 ? "Connect your scheduling tool" : "Included in Package 2", status: p2 ? "pending" : "na", owner: "you" },
    { key: "notifications", title: "Team notifications", detail: "Who is alerted about new leads and replies", status: "pending", owner: "you" },
    { key: "test", title: "Controlled end-to-end test", detail: "A test lead, verified before anything reaches real customers", status: "pending", owner: "bluewater" },
    { key: "activation", title: "Activation", detail: company.lifecycleStatus === "active" ? "Your service is active" : "Bluewater activates automation after the test passes", status: company.lifecycleStatus === "active" ? "ready" : "pending", owner: "bluewater" },
  ];
}

function sourceStep(sources: { active: boolean; last: Date | null }[]): OnboardingStep {
  const active = sources.filter((x) => x.active);
  const base = { key: "sources", title: "Connect lead sources", owner: "you" as const };
  if (active.some((x) => x.last)) return { ...base, detail: `${active.length} website form connection${active.length > 1 ? "s" : ""} receiving leads`, status: "ready" };
  if (active.length) return { ...base, detail: "Form connected — send a test submission to confirm it works", status: "attention" };
  return { ...base, detail: "Connect your website form under Connected Accounts. Facebook/Instagram and Google lead forms come later.", status: "pending" };
}
