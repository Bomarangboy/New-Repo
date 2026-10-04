import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge, Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/authz/guard";
import { formatInZone } from "@/lib/timezones";
import { billingForOwner } from "@/server/billing";

export const metadata = { title: "Billing" };

const usd = (cents: number | null) => (cents == null ? "—" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }));

/** Read-only for the client owner: their price, this month's usage and Bluewater's invoice records. */
export default async function BillingSettingsPage() {
  const ctx = await pageContext("billing.view");
  const b = await billingForOwner(ctx);
  return (
    <>
      <Link href="/app/settings" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> Settings</Link>
      <PageHeader title="Billing" subtitle="Your plan price, this month's usage and invoices from Bluewater. Questions? Use Help & Support." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="card p-5"><p className="text-sm text-muted">Monthly price</p><p className="mt-1 text-2xl font-bold">{usd(b.monthlyPriceCents)}</p><p className="text-xs text-muted">{b.monthlyPriceCents == null ? "Not set up yet — Bluewater will confirm your price." : "As agreed with Bluewater"}</p></div>
        <div className="card p-5"><p className="text-sm text-muted">Text segments this month</p><p className="mt-1 text-2xl font-bold">{b.usage.smsSegments.toLocaleString("en-US")}</p>
          <p className="text-xs text-muted">{b.smsMonthlyLimit == null ? "No monthly limit" : `Limit ${b.smsMonthlyLimit.toLocaleString("en-US")} — ${b.limitMode === "pause_automatic" ? "automatic texts pause at the limit (emails, replies and new leads continue)" : "Bluewater is alerted at the limit"}`}</p></div>
        <div className="card p-5"><p className="text-sm text-muted">Emails this month</p><p className="mt-1 text-2xl font-bold">{b.usage.emails.toLocaleString("en-US")}</p><p className="text-xs text-muted">Automatic and manual</p></div>
      </div>
      <Card title="Invoices">
        {b.invoices.length === 0 ? <p className="text-sm text-muted">No invoices yet.</p> : (
          <ul className="divide-y divide-line text-sm">
            {b.invoices.map((i) => (
              <li key={i.reference} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1"><span className="font-medium">{i.reference}</span> · {i.periodStart} to {i.periodEnd}{i.dueDate ? ` · due ${i.dueDate}` : ""}</span>
                <span className="tabular-nums">{usd(i.amountCents)}</span>
                <Badge tone={i.status === "paid" ? "green" : i.status === "failed" ? "red" : "neutral"}>{i.status === "sent" ? "awaiting payment" : i.status === "failed" ? "payment failed" : i.status}</Badge>
                {i.paidAt && <span className="text-xs text-muted">paid {formatInZone(i.paidAt, ctx.timezone, { dateStyle: "medium" })}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
