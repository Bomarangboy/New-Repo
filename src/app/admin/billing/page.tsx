import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card, LIFECYCLE_TONES, PageHeader } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/authz/guard";
import { PACKAGE_LABELS, type PackageTier } from "@/lib/authz/entitlements";
import type { LifecycleStatus } from "@/lib/authz/account-policy";
import { lifecycleReport, usageReport } from "@/server/billing";
import { saveUnitPricesAction } from "../actions";

export const metadata = { title: "Usage & Billing" };
export const dynamic = "force-dynamic";

const usd = (n: number | null, digits = 2) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }));
function months(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return out;
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await requirePlatformAdmin();
  const list = months(6);
  const sp = await searchParams;
  const month = list.includes(sp.month ?? "") ? sp.month! : list[0]!;
  const [u, life] = await Promise.all([usageReport(ctx, month), lifecycleReport(ctx, 6)]);
  const customers = u.rows.filter((r) => r.kind === "customer");
  const others = u.rows.filter((r) => r.kind !== "customer");
  const totalPrice = customers.reduce((a, r) => a + (r.monthly_price_cents ?? 0), 0);
  const costKnown = customers.every((r) => r.estimatedCostUsd != null);
  const totalCost = customers.reduce((a, r) => a + (r.estimatedCostUsd ?? 0), 0);

  return (
    <>
      <PageHeader title="Usage & Billing" subtitle="What each client used, an estimate of what it cost Bluewater, and the prices you charge. Nothing here charges anyone."
        actions={<nav className="flex flex-wrap rounded-xl border border-line bg-white p-1" aria-label="Month">{list.map((m) => (
          <Link key={m} href={`/admin/billing?month=${m}`} aria-current={m === month ? "true" : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${m === month ? "bg-navy-900 text-white" : "text-muted hover:text-ink"}`}>{m}</Link>))}</nav>} />

      {u.prices.smsSegmentUsd == null && <p className="mb-6 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Unit prices aren&apos;t set yet, so provider cost estimates show “—”. Enter your Twilio and Postmark prices below once you&apos;ve confirmed them.</p>}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="card p-5"><p className="text-sm text-muted">Monthly prices (paying customers)</p><p className="mt-1 text-2xl font-bold">{usd(totalPrice / 100, 0)}</p><p className="text-xs text-muted">As entered on each company</p></div>
        <div className="card p-5"><p className="text-sm text-muted">Estimated provider costs ({month})</p><p className="mt-1 text-2xl font-bold">{costKnown ? usd(totalCost) : "—"}</p><p className="text-xs text-muted">Real texts and emails only; simulated ones cost nothing</p></div>
        <div className="card p-5"><p className="text-sm text-muted">Customers</p><p className="mt-1 text-2xl font-bold">{customers.length}</p><p className="text-xs text-muted">{others.length} demo/test workspaces excluded</p></div>
      </div>

      <Card title={`Usage by client · ${month}`} className="mb-6">
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-muted"><tr>
              <th className="px-2 py-2 font-medium">Company</th><th className="px-2 py-2 font-medium">Package</th><th className="px-2 py-2 text-right font-medium">Leads</th>
              <th className="px-2 py-2 text-right font-medium">Text segments</th><th className="px-2 py-2 text-right font-medium">Emails</th><th className="px-2 py-2 text-right font-medium">Ad imports</th>
              <th className="px-2 py-2 text-right font-medium">Est. cost</th><th className="px-2 py-2 text-right font-medium">Price</th><th className="px-2 py-2 font-medium">Billing</th>
            </tr></thead>
            <tbody className="divide-y divide-line tabular-nums">
              {[...customers, ...others].map((r) => {
                const over = r.sms_monthly_limit != null && r.sms_live + r.sms_sim >= r.sms_monthly_limit;
                return (
                  <tr key={r.id} className={r.kind !== "customer" ? "text-muted" : ""}>
                    <td className="px-2 py-2.5"><Link href={`/admin/companies/${r.id}`} className="font-medium hover:text-brand-600">{r.name}</Link>{r.kind !== "customer" && <span className="ml-1"><Badge>{r.kind.replace("_", " ")}</Badge></span>}
                      <span className="ml-1"><Badge tone={LIFECYCLE_TONES[r.lifecycle_status as LifecycleStatus]}>{r.lifecycle_status}</Badge></span></td>
                    <td className="px-2 py-2.5">{PACKAGE_LABELS[r.package as PackageTier].split(" — ")[1]}</td>
                    <td className="px-2 py-2.5 text-right">{r.leads}</td>
                    <td className="px-2 py-2.5 text-right">{r.sms_live}{r.sms_sim ? <span className="block text-[11px] text-muted">+{r.sms_sim} simulated</span> : null}
                      {r.sms_monthly_limit != null && <span className={`block text-[11px] ${over ? "text-red-700" : "text-muted"}`}>limit {r.sms_monthly_limit} ({r.limit_mode === "pause_automatic" ? "pauses auto texts" : "alert only"})</span>}</td>
                    <td className="px-2 py-2.5 text-right">{r.email_live}{r.email_sim ? <span className="block text-[11px] text-muted">+{r.email_sim} simulated</span> : null}</td>
                    <td className="px-2 py-2.5 text-right">{r.ad_syncs}</td>
                    <td className="px-2 py-2.5 text-right">{r.estimatedCostUsd == null ? "—" : usd(r.estimatedCostUsd)}</td>
                    <td className="px-2 py-2.5 text-right">{r.monthly_price_cents == null ? "—" : usd(r.monthly_price_cents / 100, 0)}</td>
                    <td className="px-2 py-2.5">{r.billing_status.replaceAll("_", " ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">Text segments count toward limits whether real or simulated, so limits can be tried in the demo. Estimated cost uses only real usage × the unit prices below, plus the monthly number fee for clients with a verified texting number. Estimates are not bills.</p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Unit prices for estimates">
          <ActionForm action={saveUnitPricesAction} className="space-y-3">
            <Field label="Per text segment, including carrier fees (USD)" name="smsSegmentUsd" inputMode="decimal" defaultValue={u.prices.smsSegmentUsd ?? ""} placeholder="e.g. 0.0110" hint="From Twilio's US pricing page + carrier fees. Leave empty if unknown." />
            <Field label="Per email (USD)" name="emailUsd" inputMode="decimal" defaultValue={u.prices.emailUsd ?? ""} placeholder="e.g. 0.0015" />
            <Field label="Per texting number per month: number + A2P campaign fee (USD)" name="smsNumberMonthlyUsd" inputMode="decimal" defaultValue={u.prices.smsNumberMonthlyUsd ?? ""} placeholder="e.g. 3.15" />
            <SubmitButton variant="secondary">Save prices</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Customers by month (demo and test workspaces excluded)">
          <table className="w-full text-left text-sm">
            <thead className="text-muted"><tr><th className="py-1 font-medium">Month</th><th className="py-1 text-right font-medium">New</th><th className="py-1 text-right font-medium">Activated</th><th className="py-1 text-right font-medium">Churned</th><th className="py-1 text-right font-medium">Reactivated</th><th className="py-1 text-right font-medium">Active at end</th></tr></thead>
            <tbody className="tabular-nums">{life.map((r) => <tr key={r.month} className="border-t border-line"><td className="py-1.5">{r.month}</td><td className="py-1.5 text-right">{r.created}</td><td className="py-1.5 text-right">{r.activated}</td><td className="py-1.5 text-right">{r.churned}</td><td className="py-1.5 text-right">{r.reactivated}</td><td className="py-1.5 text-right">{r.active_end}</td></tr>)}</tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
