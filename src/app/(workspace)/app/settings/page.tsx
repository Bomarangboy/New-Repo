import Link from "next/link";
import { ChevronRight, Database, Mail, Receipt, ScrollText, Users } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/authz/guard";
import { roleCan } from "@/lib/authz/permissions";
import { FEATURES, hasFeature, type Feature } from "@/lib/authz/entitlements";
import { US_TIMEZONES } from "@/lib/timezones";
import { getCompanySummary } from "@/server/team";
import { chooseCrmModeAction, updateSettingsAction, weeklySummaryAction } from "../actions";
import { weeklySummaryEnabled } from "@/server/reports/weekly-summary";
import { studioForCompany } from "@/server/studio/runtime";

export const metadata = { title: "Settings" };

const FEATURE_NAMES: Partial<Record<Feature, string>> = {
  leads: "Lead capture & records", acknowledgment: "Automatic acknowledgment", notifications: "Team notifications",
  inbox: "Two-way inbox", ad_lead_forms: "Facebook, Instagram & Google lead forms", sequences: "Multi-day follow-up",
  booking: "Booking links & reminders", pipeline_board: "Pipeline & tasks", ad_reporting: "Advertising performance",
  outcome_reporting: "Booking & sales reporting", scheduled_summaries: "Scheduled summaries",
};

export default async function SettingsPage() {
  const ctx = await pageContext("settings.view");
  const ui = await studioForCompany(ctx);
  const weekly = await weeklySummaryEnabled(ctx);
  const company = await getCompanySummary(ctx);
  const canEdit = roleCan(ctx.role, "settings.manage") && ctx.policy.login === "full";

  return (
    <>
      <PageHeader title={ui.t("page.settings.title")} subtitle={ui.t("page.settings.subtitle")} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <Card title="Company details">
            <ActionForm action={updateSettingsAction}>
              <fieldset disabled={!canEdit} className="space-y-4">
                <Field label="Business name" name="name" defaultValue={company.name} required maxLength={120} />
                <div>
                  <label htmlFor="timezone" className="label">Timezone</label>
                  <select id="timezone" name="timezone" defaultValue={company.timezone} className="input">
                    {!US_TIMEZONES.some((t) => t.id === company.timezone) && <option value={company.timezone}>{company.timezone}</option>}
                    {US_TIMEZONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  <p className="mt-1 text-xs text-muted">Used for sending windows, reminders and reports.</p>
                </div>
                {canEdit ? <SubmitButton>Save changes</SubmitButton> : <p className="text-sm text-muted">Only the account owner can change these settings.</p>}
              </fieldset>
            </ActionForm>
          </Card>

          <Card title="Customer records (CRM)">
            <div id="crm" />
            <ActionForm action={chooseCrmModeAction}>
              <fieldset disabled={!canEdit} className="space-y-3">
                <label className="flex cursor-pointer gap-3 rounded-xl border border-line p-4 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
                  <input type="radio" name="mode" value="built_in" defaultChecked={company.crmMode !== "external"} className="mt-1 accent-brand-500" />
                  <span><span className="flex items-center gap-2 font-medium"><Database className="size-4" /> Bluewater built-in CRM</span>
                  <span className="text-sm text-muted">Contacts, conversations, tasks, appointments and sales in Bluewater.</span></span>
                </label>
                <label className="flex gap-3 rounded-xl border border-dashed border-line p-4 opacity-70">
                  <input type="radio" name="mode" value="external" disabled className="mt-1" />
                  <span><span className="flex items-center gap-2 font-medium">Connect an external CRM <Badge tone="neutral">Not available yet</Badge></span>
                  <span className="text-sm text-muted">Connections are added for specific CRMs on request. Ask Bluewater which systems are supported.</span></span>
                </label>
                {canEdit && <SubmitButton>{company.crmMode === "unselected" ? "Confirm choice" : "Save"}</SubmitButton>}
              </fieldset>
            </ActionForm>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Your plan">
            <p className="font-semibold">{ui.packageName(company.package)}</p>
            {ui.packageDescription(company.package) && <p className="text-sm text-muted">{ui.packageDescription(company.package)}</p>}
            {ui.packagePrice(company.package) && <p className="mt-1 text-sm">{ui.packagePrice(company.package)}</p>}
            <ul className="mt-3 space-y-1.5 text-sm">
              {(Object.keys(FEATURE_NAMES) as Feature[]).filter((f) => f in FEATURES).map((f) => (
                <li key={f} className={`flex items-center justify-between gap-2 ${hasFeature(company.package, f) ? "" : "text-slate-400"}`}>
                  {FEATURE_NAMES[f]} {hasFeature(company.package, f) ? <Badge tone="green">Included</Badge> : <Badge>Higher package</Badge>}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted">To change your plan, contact Bluewater.</p>
          </Card>
          <Card>
            <nav className="divide-y divide-line">
              <Link href="/app/settings/team" className="flex items-center gap-3 py-3 font-medium hover:text-brand-600"><Users className="size-5" /> Team & invitations <ChevronRight className="ml-auto size-4" /></Link>
              {roleCan(ctx.role, "billing.view") && <Link href="/app/settings/billing" className="flex items-center gap-3 py-3 font-medium hover:text-brand-600"><Receipt className="size-5" /> Billing & usage <ChevronRight className="ml-auto size-4" /></Link>}
              {roleCan(ctx.role, "audit.view") && <Link href="/app/settings/activity" className="flex items-center gap-3 py-3 font-medium hover:text-brand-600"><ScrollText className="size-5" /> Activity log <ChevronRight className="ml-auto size-4" /></Link>}
            </nav>
          </Card>
          {weekly != null && (
            <Card title="Weekly summary">
              <ActionForm action={weeklySummaryAction} className="space-y-3">
                <fieldset disabled={!roleCan(ctx.role, "settings.manage")} className="space-y-3">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="on" defaultChecked={weekly} className="size-4 accent-brand-500" /> <Mail className="size-4 text-brand-500" /> Email owners last week&apos;s numbers every Monday morning</label>
                  {roleCan(ctx.role, "settings.manage") && <SubmitButton variant="secondary">Save</SubmitButton>}
                </fieldset>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
