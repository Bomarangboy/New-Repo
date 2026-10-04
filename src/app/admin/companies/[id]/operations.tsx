import { Download } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card } from "@/components/ui";
import type { PlatformContext } from "@/lib/authz/context-types";
import { getCompanyBillingAdmin } from "@/server/billing";
import { deletionPreview, KEPT_AFTER_DELETION } from "@/server/retention";
import { deleteCompanyDataAction } from "../../support-actions";
import { adminPauseAction, invoiceStatusAction, recordInvoiceAction, saveCompanyBillingAction } from "../../actions";

const usd = (cents: number | null) => (cents == null ? "—" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }));

/** Billing terms, limits, invoice records and operational controls for one company (administrators only). */
export async function CompanyOperations({ ctx, companyId }: { ctx: PlatformContext; companyId: string }) {
  const [{ billing: b, invoices, usage, automation }, del] = await Promise.all([getCompanyBillingAdmin(ctx, companyId), deletionPreview(ctx, companyId)]);
  return (
    <>
      <Card title="Billing & usage limits" className="xl:col-span-2">
        <p className="-mt-2 mb-4 text-sm text-muted">Bluewater bills outside the app. These are your terms and records; nothing here charges the client. This month so far: <b>{usage.smsSegments}</b> text segments, <b>{usage.emails}</b> emails.</p>
        <ActionForm action={saveCompanyBillingAction} className="grid gap-4 md:grid-cols-3">
          <input type="hidden" name="companyId" value={companyId} />
          <Field label="Monthly price (USD)" name="monthlyPrice" inputMode="decimal" defaultValue={b?.monthlyPriceCents != null ? (b.monthlyPriceCents / 100).toFixed(2) : ""} />
          <Field label="Billing email" name="billingEmail" type="email" defaultValue={b?.billingEmail ?? ""} />
          <Field label="Grace period after a failed payment (days)" name="graceDays" type="number" min={0} max={90} defaultValue={String(b?.graceDays ?? 14)} />
          <Field label="Monthly text limit (segments)" name="smsMonthlyLimit" type="number" min={1} defaultValue={b?.smsMonthlyLimit != null ? String(b.smsMonthlyLimit) : ""} hint="Empty = no limit." />
          <Field label="Monthly email limit" name="emailMonthlyLimit" type="number" min={1} defaultValue={b?.emailMonthlyLimit != null ? String(b.emailMonthlyLimit) : ""} hint="Alert only." />
          <div>
            <label className="label" htmlFor="limitMode">At the text limit</label>
            <select id="limitMode" name="limitMode" defaultValue={b?.limitMode ?? "warn"} className="input">
              <option value="warn">Alert Bluewater only</option>
              <option value="pause_automatic">Pause automatic texts (emails, replies and lead capture continue)</option>
            </select>
          </div>
          <div className="md:col-span-3"><Field label="Notes (contract, discounts…)" name="notes" defaultValue={b?.notes ?? ""} /></div>
          <div><SubmitButton variant="secondary">Save billing terms</SubmitButton></div>
        </ActionForm>

        <h3 className="mb-2 mt-6 font-semibold">Invoices</h3>
        {invoices.length === 0 ? <p className="mb-4 text-sm text-muted">No invoices recorded.</p> : (
          <ul className="mb-4 divide-y divide-line rounded-xl border border-line text-sm">
            {invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1"><span className="font-medium">{i.reference}</span> · {i.periodStart} to {i.periodEnd} · {usd(i.amountCents)}{i.dueDate ? ` · due ${i.dueDate}` : ""}</span>
                <Badge tone={i.status === "paid" ? "green" : i.status === "failed" ? "red" : i.status === "void" ? "neutral" : "blue"}>{i.status}</Badge>
                {i.status !== "void" && i.status !== "paid" && (["paid", "failed", "void"] as const).filter((s) => s !== i.status).map((s) => (
                  <form key={s} action={invoiceStatusAction}><input type="hidden" name="invoiceId" value={i.id} /><input type="hidden" name="companyId" value={companyId} /><input type="hidden" name="status" value={s} />
                    <button className="btn-secondary px-2.5 py-1 text-xs">{s === "paid" ? "Mark paid" : s === "failed" ? "Payment failed" : "Void"}</button></form>
                ))}
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={recordInvoiceAction} className="grid gap-3 md:grid-cols-5 md:items-end">
          <input type="hidden" name="companyId" value={companyId} />
          <Field label="Period start" name="periodStart" type="date" required />
          <Field label="Period end" name="periodEnd" type="date" required />
          <Field label="Amount (USD)" name="amount" inputMode="decimal" required />
          <Field label="Due" name="dueDate" type="date" />
          <SubmitButton variant="secondary">Record invoice</SubmitButton>
        </ActionForm>
        <p className="mt-2 text-xs text-muted">A failed payment marks billing “past due” and alerts Bluewater after the grace period. Service is never paused automatically for payment — that is your decision (Account status → Suspend).</p>
      </Card>

      <Card title="Operations" className="xl:col-span-2">
        <div className="grid gap-6 md:grid-cols-2">
          <ActionForm action={adminPauseAction} className="space-y-3">
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="paused" value={automation.paused ? "0" : "1"} />
            <p className="text-sm font-medium">Automatic messages {automation.paused ? <Badge tone="red">Stopped</Badge> : <Badge tone="green">On</Badge>}</p>
            {automation.paused ? (
              <><p className="text-xs text-muted">{automation.reason}</p><SubmitButton variant="secondary">Turn automatic messages back on</SubmitButton></>
            ) : (
              <><p className="text-xs text-muted">Use during a provider incident or a wording problem. Pending automatic messages are cancelled and follow-ups stop for good; leads are still captured. The client sees the reason.</p>
                <Field label="Reason (shown to the client)" name="reason" required minLength={3} />
                <SubmitButton variant="danger">Stop automatic messages</SubmitButton></>
            )}
          </ActionForm>
          <div className="space-y-2 text-sm">
            <p className="font-medium">Diagnostics</p>
            <p className="text-xs text-muted">A redacted file (counts, statuses and error messages — no names, contact details or message text) to share with a developer or provider support.</p>
            <a href={`/admin/companies/${companyId}/diagnostics`} className="btn-secondary inline-flex"><Download className="size-4" /> Download diagnostics</a>
          </div>
        </div>
      </Card>

      {del && (
        <Card title="Delete this company's data" className="xl:col-span-2">
          {del.previous.map((p) => <p key={p.id} className="mb-3 rounded-xl bg-canvas px-3 py-2 text-sm">Data deleted on {p.deletedAt.toISOString().slice(0, 10)} — {p.reason}</p>)}
          {!del.allowed ? (
            <p className="text-sm text-muted">Only possible for <b>archived</b> companies (Account status → Archived), after any export the client asked for. Data is otherwise kept as described in the retention policy.</p>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2 text-sm">
                <p><b>Permanently deletes</b> {del.counts.leads} lead(s), {del.counts.contacts} contact(s), {del.counts.messages} message(s), {del.counts.appointments} appointment(s), all notes, tasks, follow-ups, ad data, settings and team access ({del.counts.members} member(s)).</p>
                <p><b>Keeps</b> {KEPT_AFTER_DELETION.join(", ")}.</p>
                <p className="text-amber-800"><b>Backups</b> still contain this data until they age out (up to 7 days on Supabase Pro daily backups; longer if you keep manual backups). It cannot be undone from the app.</p>
              </div>
              <ActionForm action={deleteCompanyDataAction} className="space-y-3">
                <input type="hidden" name="companyId" value={companyId} />
                <Field label="Why (e.g. “written request from owner, 3 May”)" name="reason" required minLength={5} />
                <Field label={`Type the company name exactly: ${del.company.name}`} name="confirmName" required autoComplete="off" />
                <SubmitButton variant="danger">Permanently delete data</SubmitButton>
              </ActionForm>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
