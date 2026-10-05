import Link from "next/link";
import { BarChart3, FlaskConical } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { DailyChart } from "@/components/daily-chart";
import { money, sourceName } from "@/components/lead-bits";
import { pageContext } from "@/lib/authz/guard";
import { roleCan } from "@/lib/authz/permissions";
import { PERIOD_OPTIONS, parsePeriod } from "@/lib/periods";
import { formatInZone, timezoneLabel } from "@/lib/timezones";
import { adReport, STALE_AFTER_HOURS } from "@/server/ads/reports";
import { studioForCompany } from "@/server/studio/runtime";

export const metadata = { title: "Reports" };

const cur = (micros: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: micros >= 1e8 ? 0 : 2 }).format(micros / 1e6);
const num = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
const PLATFORM: Record<string, string> = { meta: "Meta", google: "Google Ads" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx = await pageContext("report.view", "ad_reporting");
  const ui = await studioForCompany(ctx);
  const days = parsePeriod((await searchParams).days);
  const r = await adReport(ctx, days);
  const tz = ctx.timezone;
  const connected = r.connections.length > 0;
  const stale = r.connections.filter((c) => c.stale);

  return (
    <>
      <PageHeader title={ui.t("page.reports.title")} subtitle={ui.t("page.reports.subtitle")}
        actions={
          <nav className="flex rounded-xl border border-line bg-white p-1" aria-label="Date range">
            {PERIOD_OPTIONS.map((d) => (
              <Link key={d} href={`/app/reports?days=${d}`} aria-current={d === days ? "true" : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${d === days ? "bg-navy-900 text-white" : "text-muted hover:text-ink"}`}>Last {d} days</Link>
            ))}
          </nav>
        } />

      {r.simulated && (
        <p className="mb-4 flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <FlaskConical className="mt-0.5 size-4 shrink-0" /> <span><b>Sample numbers.</b> Spend and clicks below come from <b>simulated</b> ad accounts, not your real Meta or Google accounts.</span>
        </p>
      )}
      {!connected && (
        <p className="mb-4 rounded-2xl bg-canvas px-4 py-3 text-sm">
          No ad account is connected, so spend can&apos;t be shown.{" "}
          {roleCan(ctx.role, "integration.view") && <Link href="/app/connected-accounts" className="font-medium text-brand-600 underline">Connect Meta or Google Ads</Link>}
          {" "}Leads and sales by source are below.
        </p>
      )}
      {stale.map((c) => (
        <p key={c.platform} className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {PLATFORM[c.platform]} numbers were last updated {c.lastSyncOkAt ? formatInZone(c.lastSyncOkAt, tz) : "never"} (more than {STALE_AFTER_HOURS} hours ago), so they may be out of date.{c.lastError ? ` Last problem: ${c.lastError}` : ""}
        </p>
      ))}

      {connected && r.totals.length === 0 && (
        <EmptyState icon={BarChart3} title="No ad spend in this period">Either the selected ad accounts didn&apos;t run ads, or no account is selected for reports (Connected Accounts).</EmptyState>
      )}

      {r.totals.map((t) => {
        const cpl = t.leads > 0 ? t.spendMicros / t.leads : null;
        const series = r.daily.filter((d) => d.currency === t.currency);
        const dayMap = new Map(series.map((d) => [d.day, d.spendMicros / 1e6]));
        const span: string[] = [];
        for (let d = new Date(`${r.period.fromDay}T12:00:00Z`); d <= new Date(`${r.period.toDay}T12:00:00Z`); d = new Date(d.getTime() + 86_400_000)) span.push(d.toISOString().slice(0, 10));
        return (
          <section key={t.currency} className="mb-6 space-y-6" aria-label={`Advertising in ${t.currency}`}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <Tile label="Ad spend" value={cur(t.spendMicros, t.currency)} note={r.totals.length > 1 ? `${t.currency} accounts only` : "As reported by the platforms"} />
              <Tile label="Clicks" value={num(t.clicks)} note={`${num(t.impressions)} impressions`} />
              <Tile label="Leads credited to campaigns" value={num(t.leads)} note={t.platformLeads == null ? "Recorded in Bluewater with a campaign id" : `Platforms counted ${num(t.platformLeads)} (their own definition)`} />
              <Tile label="Cost per credited lead" value={cpl == null ? "—" : cur(cpl, t.currency)} note={cpl == null ? "No credited leads yet" : "Spend ÷ credited leads"} />
              <Tile label="Sales from credited leads" value={t.currency === "USD" ? money(t.salesCents) : "—"} note={t.currency === "USD" ? `${t.won} won` : "Sales are in USD; not combined with other currencies"} />
            </div>
            <Card title={`Daily ad spend${r.totals.length > 1 ? ` (${t.currency})` : ""}`} actions={<span className="text-xs text-muted">Ad account days · {t.currency}</span>}>
              <DailyChart data={span.map((d) => ({ date: d, count: dayMap.get(d) ?? 0 }))} label={`Spend (${t.currency})`} unit={["spent", "spent"]} currency={t.currency} />
            </Card>
          </section>
        );
      })}

      {r.campaigns.length > 0 && (
        <Card title="Campaigns" className="mb-6">
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-muted"><tr>
                <th className="px-2 py-2 font-medium">Campaign</th><th className="px-2 py-2 text-right font-medium">Spend</th><th className="px-2 py-2 text-right font-medium">Clicks</th>
                <th className="px-2 py-2 text-right font-medium" title="The platform's own count">Platform leads</th><th className="px-2 py-2 text-right font-medium">Bluewater leads</th>
                <th className="px-2 py-2 text-right font-medium">Cost / lead</th><th className="px-2 py-2 text-right font-medium">Booked</th><th className="px-2 py-2 text-right font-medium">Won</th><th className="px-2 py-2 text-right font-medium">Sales</th>
              </tr></thead>
              <tbody className="divide-y divide-line tabular-nums">
                {r.campaigns.map((c) => (
                  <tr key={`${c.platform}:${c.campaignId}`}>
                    <td className="px-2 py-2.5"><span className="font-medium">{c.name}</span><span className="block text-xs text-muted">{PLATFORM[c.platform]} · {c.accountName}</span></td>
                    <td className="px-2 py-2.5 text-right">{cur(c.spendMicros, c.currency)}</td>
                    <td className="px-2 py-2.5 text-right">{num(c.clicks)}</td>
                    <td className="px-2 py-2.5 text-right">{num(c.platformLeads ?? c.platformConversions)}{c.platformLeads == null && c.platformConversions != null ? <span className="block text-[11px] text-muted">conversions</span> : null}</td>
                    <td className="px-2 py-2.5 text-right">{c.leads}</td>
                    <td className="px-2 py-2.5 text-right">{c.leads ? cur(c.spendMicros / c.leads, c.currency) : "—"}</td>
                    <td className="px-2 py-2.5 text-right">{c.booked}</td>
                    <td className="px-2 py-2.5 text-right">{c.won}</td>
                    <td className="px-2 py-2.5 text-right">{c.won ? money(c.salesCents) : "—"}{c.wonWithoutValue ? <span className="block text-[11px] text-amber-800">{c.wonWithoutValue} without value</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-4 space-y-1 text-xs text-muted">
            <li>Leads are credited to a campaign only when the campaign id arrived with the lead (Facebook/Instagram and Google lead forms).</li>
            {r.adFormNoCampaign > 0 && <li>{r.adFormNoCampaign} lead-form {r.adFormNoCampaign === 1 ? "lead" : "leads"} arrived without a campaign id (e.g. organic or test) and {r.adFormNoCampaign === 1 ? "isn't" : "aren't"} credited.</li>}
            {r.adUnknownCampaign > 0 && <li>{r.adUnknownCampaign} website {r.adUnknownCampaign === 1 ? "lead" : "leads"} came from an ad click (click id or paid campaign tag) but can&apos;t be linked to a specific campaign.</li>}
            {r.unmatched.length > 0 && <li>{r.unmatched.reduce((a, u) => a + u.leads, 0)} credited lead(s) belong to campaigns in accounts not selected for reports, so their spend isn&apos;t shown.</li>}
            <li>Platform numbers can change for a few days after the fact; Bluewater re-imports the last 7 days every 6 hours.</li>
          </ul>
        </Card>
      )}

      <Card title={`Leads and results by source · last ${days} days`}>
        {r.sources.length === 0 ? <p className="text-sm text-muted">No leads in this period.</p> : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-muted"><tr><th className="px-2 py-2 font-medium">Source</th><th className="px-2 py-2 text-right font-medium">Leads</th><th className="px-2 py-2 text-right font-medium">Booked</th><th className="px-2 py-2 text-right font-medium">Won</th><th className="px-2 py-2 text-right font-medium">Recorded sales</th></tr></thead>
              <tbody className="divide-y divide-line tabular-nums">
                {r.sources.map((s) => (
                  <tr key={s.source}>
                    <td className="px-2 py-2.5">{sourceName(s.source)}</td><td className="px-2 py-2.5 text-right">{s.leads}</td>
                    <td className="px-2 py-2.5 text-right">{s.booked} <span className="text-xs text-muted">({Math.round((s.booked / s.leads) * 100)}%)</span></td>
                    <td className="px-2 py-2.5 text-right">{s.won} <span className="text-xs text-muted">({Math.round((s.won / s.leads) * 100)}%)</span></td>
                    <td className="px-2 py-2.5 text-right">{s.won ? money(s.salesCents) : "—"}{s.wonWithoutValue ? <span className="block text-[11px] text-amber-800">{s.wonWithoutValue} won without value — incomplete</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">Leads received in the period and where they stand today (an acquisition cohort). Booked includes leads now Won. Sales are values your team recorded on Won leads, in USD.</p>
      </Card>

      <p className="mt-6 text-xs text-muted">
        Period: {r.period.fromDay} to {r.period.toDay} ({timezoneLabel(tz)} days for leads; each ad account&apos;s own days for spend).
        Weekly emailed summaries are coming in a later stage. <Badge tone="blue">Definitions: Help → How numbers are calculated</Badge>
      </p>
    </>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}
