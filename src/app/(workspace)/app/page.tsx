import Link from "next/link";
import {
  AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Circle, DollarSign, Inbox, MailCheck, MailX, MessageSquareReply, MinusCircle, UserX,
} from "lucide-react";
import { Badge, Card, PageHeader, StatCard } from "@/components/ui";
import { DailyChart } from "@/components/daily-chart";
import { StageBadge, money, sourceName } from "@/components/lead-bits";
import { pageContext } from "@/lib/authz/guard";
import { hasFeature } from "@/lib/authz/entitlements";
import { roleCan } from "@/lib/authz/permissions";
import { PERIOD_OPTIONS, parsePeriod } from "@/lib/periods";
import { formatInZone, timezoneLabel } from "@/lib/timezones";
import { overviewMetrics } from "@/server/metrics";
import { onboardingChecklist, type StepStatus } from "@/server/onboarding";
import { STAGES } from "@/server/crm/leads";

export const metadata = { title: "Overview" };

function duration(sec: number): string {
  if (sec < 90) return `${Math.max(1, Math.round(sec))} sec`;
  if (sec < 90 * 60) return `${Math.round(sec / 60)} min`;
  if (sec < 36 * 3600) return `${Math.round(sec / 3600)} hr`;
  return `${Math.round(sec / 86400)} days`;
}

const STATUS: Record<StepStatus, { label: string; tone: "green" | "neutral" | "amber" | "blue"; icon: typeof Circle }> = {
  ready: { label: "Ready", tone: "green", icon: CheckCircle2 },
  pending: { label: "Pending", tone: "blue", icon: Circle },
  attention: { label: "Needs attention", tone: "amber", icon: AlertTriangle },
  na: { label: "Not applicable", tone: "neutral", icon: MinusCircle },
};

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ welcome?: string; days?: string }> }) {
  const ctx = await pageContext("workspace.view");
  const sp = await searchParams;
  const days = parsePeriod(sp.days);
  const [m, steps] = await Promise.all([overviewMetrics(ctx, days), onboardingChecklist(ctx)]);
  const done = steps.filter((s) => s.status === "ready" || s.status === "na").length;
  const change = m.inquiries.changePct;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Your leads, follow-up and advertising in one place."
        actions={
          <nav className="flex rounded-xl border border-line bg-white p-1" aria-label="Date range">
            {PERIOD_OPTIONS.map((d) => (
              <Link key={d} href={`/app?days=${d}`} aria-current={d === days ? "true" : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${d === days ? "bg-navy-900 text-white" : "text-muted hover:text-ink"}`}>Last {d} days</Link>
            ))}
          </nav>
        }
      />
      {sp.welcome && <p className="mb-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Welcome to {ctx.companyName}! You&apos;re all set up.</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card flex items-start gap-4 p-5">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-500"><Inbox className="size-6" /></span>
          <div>
            <p className="text-sm text-muted">New inquiries</p>
            <p className="mt-1 text-3xl font-bold tracking-tight">{m.inquiries.current.toLocaleString("en-US")}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted">
              {change == null ? <>No earlier data to compare</> : (
                <><span className={`inline-flex items-center font-semibold ${change >= 0 ? "text-emerald-700" : "text-amber-700"}`}>{change >= 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}{Math.abs(change)}%</span> vs previous {days} days</>
              )}
            </p>
          </div>
        </div>
        <StatCard icon={MailCheck} label="Acknowledgments sent" value={m.messaging.acksSent.toLocaleString("en-US")} tone="green"
          note={m.messaging.medianAckSeconds == null ? (m.messaging.acksSimulated ? "Simulated in this environment" : "Automatic replies to leads in this period") : `Typically ${duration(m.messaging.medianAckSeconds)} after the inquiry${m.messaging.acksSimulated ? " · simulated" : ""}`} />
        <StatCard icon={MailX} label="Failed acknowledgments" value={(m.messaging.acksFailed + m.messaging.acksUncertain).toLocaleString("en-US")} tone="amber"
          note={m.messaging.acksUncertain ? `${m.messaging.acksUncertain} unconfirmed, being checked` : "Couldn't be delivered"} />
        <Link href="/app/conversations?filter=needs_reply" className="block"><StatCard icon={MessageSquareReply} label="Waiting for your reply" value={m.messaging.needsReply.toLocaleString("en-US")} tone="purple"
          note={m.messaging.medianFirstHumanSeconds == null ? "Conversations where the lead wrote last" : `Team's first reply typically ${duration(m.messaging.medianFirstHumanSeconds)} after an inquiry`} /></Link>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title="Lead activity" actions={<span className="text-xs text-muted">Inquiries per day</span>}>
          {m.inquiries.current === 0 && m.recent.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">No inquiries yet. They&apos;ll appear here as soon as your first lead arrives.</p>
          ) : <DailyChart data={m.daily} label="Inquiries" />}
        </Card>
        <Card title="Lead sources" actions={roleCan(ctx.role, "integration.view") ? <Link href="/app/connected-accounts" className="text-sm font-medium text-brand-600 hover:underline">Manage</Link> : undefined}>
          {m.bySource.length === 0 ? <p className="text-sm text-muted">No inquiries in this period.</p> : (
            <ul className="space-y-3">
              {m.bySource.map((s) => {
                const pct = Math.round((s.count / m.inquiries.current) * 100);
                return (
                  <li key={`${s.source}-${s.label}`}>
                    <div className="mb-1 flex justify-between text-sm"><span>{sourceName(s.source, s.label)}</span><span className="tabular-nums text-muted">{s.count} · {pct}%</span></div>
                    <div className="h-2 rounded-full bg-canvas"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${Math.max(pct, 2)}%` }} /></div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-5 border-t border-line pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Connected forms</p>
            {m.sources.length === 0 ? <p className="text-sm text-muted">None connected yet.</p> : (
              <ul className="space-y-1.5 text-sm">
                {m.sources.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{s.name}</span>
                    {!s.active ? <Badge>Off</Badge> : s.lastReceivedAt ? <span className="text-xs text-muted">Last lead {formatInZone(s.lastReceivedAt, ctx.timezone, { dateStyle: "medium" })}</span> : <Badge tone="amber">Waiting for first lead</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title="Recent leads" actions={<Link href="/app/leads" className="text-sm font-medium text-brand-600 hover:underline">View all leads →</Link>}>
          {m.recent.length === 0 ? <p className="text-sm text-muted">No leads yet.</p> : (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="text-muted"><tr><th className="px-2 py-2 font-medium">Name</th><th className="px-2 py-2 font-medium">Source</th><th className="px-2 py-2 font-medium">Stage</th><th className="px-2 py-2 font-medium">Assigned to</th><th className="px-2 py-2 font-medium">Received</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {m.recent.map((r) => (
                    <tr key={r.id}>
                      <td className="px-2 py-2.5"><Link href={`/app/leads/${r.id}`} className="font-medium hover:text-brand-600">{r.name}</Link></td>
                      <td className="px-2 py-2.5 text-muted">{sourceName(r.source, r.sourceLabel)}</td>
                      <td className="px-2 py-2.5"><StageBadge stage={r.stage} /></td>
                      <td className="px-2 py-2.5 text-muted">{r.assigned || "Unassigned"}</td>
                      <td className="px-2 py-2.5 text-muted">{formatInZone(r.submittedAt, ctx.timezone, { dateStyle: "medium" })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Team alerts">
            <p className="text-sm text-muted">{m.messaging.lastAlertAt ? `Last alert sent ${formatInZone(m.messaging.lastAlertAt, ctx.timezone)}.` : "No alerts sent yet. Your team is emailed when a lead arrives or replies."}</p>
            {m.messaging.failedAlerts > 0 && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{m.messaging.failedAlerts} alert email(s) failed in this period. Bluewater retries automatically.</p>}
          </Card>
          {m.unassignedOpen > 0 && (
            <Link href="/app/leads?assigned=unassigned" className="card flex items-center gap-4 p-5 hover:border-brand-200">
              <span className="grid size-12 place-items-center rounded-full bg-amber-50 text-amber-600"><UserX className="size-6" /></span>
              <span><span className="block text-2xl font-bold">{m.unassignedOpen}</span><span className="text-sm text-muted">open {m.unassignedOpen === 1 ? "lead has" : "leads have"} no one assigned</span></span>
            </Link>
          )}
          {m.pipeline && (
            <Card title="Pipeline" actions={<Link href="/app/leads/pipeline" className="text-sm font-medium text-brand-600 hover:underline">Open board</Link>}>
              <p className="-mt-2 mb-3 text-xs text-muted">Current stage of inquiries received in the last {days} days</p>
              <ul className="space-y-2">
                {STAGES.map((s) => (
                  <li key={s} className="flex items-center justify-between text-sm"><StageBadge stage={s} /><span className="font-semibold tabular-nums">{m.pipeline![s]}</span></li>
                ))}
              </ul>
            </Card>
          )}
          {m.sales && (
            <Card title="Recorded sales">
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-full bg-emerald-50 text-emerald-600"><DollarSign className="size-5" /></span>
                <div><p className="text-2xl font-bold">{money(m.sales.recordedCents)}</p><p className="text-xs text-muted">{m.sales.wonCount} won in the last {days} days</p></div>
              </div>
              {m.sales.wonWithoutValue > 0 && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{m.sales.wonWithoutValue} won {m.sales.wonWithoutValue === 1 ? "lead has" : "leads have"} no sale value recorded, so the total is incomplete.</p>}
              <p className="mt-3 text-xs text-muted">Sales recorded in Bluewater. Advertising attribution comes with ad reporting.</p>
            </Card>
          )}
        </div>
      </div>

      <Card className="mt-6" title="Getting started" actions={<Badge tone="blue">{`${done} of ${steps.length} complete`}</Badge>}>
        <div className="mb-4 h-2 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuenow={done} aria-valuemax={steps.length} aria-label="Setup progress">
          <div className="h-full rounded-full bg-brand-500" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <ul className="divide-y divide-line">
          {steps.map((s) => {
            const st = STATUS[s.status];
            const Icon = st.icon;
            return (
              <li key={s.key} className="flex items-start gap-3 py-3">
                <Icon className={`mt-0.5 size-5 shrink-0 ${s.status === "ready" ? "text-emerald-600" : s.status === "attention" ? "text-amber-600" : "text-slate-400"}`} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{s.title}</p>
                  <p className="text-sm text-muted">{s.detail}{s.owner === "bluewater" && s.status === "pending" ? " · Bluewater handles this step" : ""}</p>
                </div>
                <Badge tone={st.tone}>{st.label}</Badge>
              </li>
            );
          })}
        </ul>
      </Card>

      <p className="mt-6 text-xs text-muted">
        Figures calculated {formatInZone(m.computedAt, ctx.timezone)} from your records · days are counted in {timezoneLabel(ctx.timezone)} time · see “How numbers are calculated” in Help.
        {!hasFeature(ctx.package, "ad_reporting") && " Advertising spend is part of Package 3."}
      </p>
    </>
  );
}
