import Link from "next/link";
import { Presentation } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/authz/guard";
import { env } from "@/lib/env";
import { PACKAGE_NAMES, PACKAGE_LABELS, PACKAGES } from "@/lib/authz/entitlements";
import { US_TIMEZONES } from "@/lib/timezones";
import { DEMO_GRACE_DAYS, listProspects } from "@/server/demo/prospects";
import { createProspectAction, prospectAction } from "../support-actions";

export const metadata = { title: "Sales demo" };
export const dynamic = "force-dynamic";

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

function Op({ id, op, label, variant = "secondary", children }: { id: string; op: string; label: string; variant?: "primary" | "secondary" | "danger"; children?: React.ReactNode }) {
  return (
    <ActionForm action={prospectAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="companyId" value={id} />
      <input type="hidden" name="op" value={op} />
      {children}
      <SubmitButton variant={variant}>{label}</SubmitButton>
    </ActionForm>
  );
}

export default async function DemoPage() {
  const ctx = await requirePlatformAdmin();
  const prod = env().APP_ENV === "production";
  const rows = await listProspects(ctx);
  const now = new Date();
  return (
    <>
      <PageHeader title="Sales demo" subtitle="Private, expiring workspaces with fictional sample data for each prospect. Nothing in them can send real messages or connect real accounts." />
      {prod ? (
        <p className="mb-6 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">This is the production site. Prospect workspaces are created on the separate demo site (its own address and database) so prospects never share a system with client data. See docs/DEMO.md.</p>
      ) : (
        <Card title="New prospect workspace" className="mb-6">
          <ActionForm action={createProspectAction} className="grid gap-4 md:grid-cols-3">
            <Field label="Prospect's business name" name="name" required maxLength={100} placeholder="e.g. Coastal Roofing" />
            <div><label htmlFor="pkg" className="label">Package to show</label>
              <select id="pkg" name="package" className="input" defaultValue="follow_up_booking">{PACKAGES.map((p) => <option key={p} value={p}>{PACKAGE_LABELS[p]}</option>)}</select></div>
            <div><label htmlFor="tz" className="label">Timezone</label>
              <select id="tz" name="timezone" className="input" defaultValue="America/New_York">{US_TIMEZONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
            <Field label="Available for (days)" name="days" type="number" min={1} max={30} defaultValue="14" />
            <Field label="Invite the prospect (optional)" name="email" type="email" hint="They get an owner invitation to this demo workspace only." />
            <div className="flex items-end"><SubmitButton>Create with sample data</SubmitButton></div>
          </ActionForm>
        </Card>
      )}
      {rows.length === 0 ? <EmptyState icon={Presentation} title="No prospect workspaces">Create one above before a presentation. Use the presentation script in docs/DEMO.md.</EmptyState> : (
        <div className="space-y-4">
          {rows.map(({ c, owner }) => {
            const expired = !!c.demoExpiresAt && c.demoExpiresAt <= now;
            const deleted = c.lifecycleStatus === "archived";
            return (
              <Card key={c.id} title={c.name}>
                <p className="-mt-2 mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
                  <Badge tone="amber">Demo — Sample Data</Badge>
                  {deleted ? <Badge>Expired · data deleted</Badge> : expired ? <Badge tone="red">Expired · deleted after {DEMO_GRACE_DAYS} days</Badge> : <Badge tone="green">Open until {day(c.demoExpiresAt)}</Badge>}
                  <span>{PACKAGE_LABELS[c.package]}</span> · <span>Owner: {owner ?? "not invited"}</span> · <Link href={`/admin/companies/${c.id}`} className="text-brand-600 hover:underline">Company page</Link> · <Link href={`/admin/studio/edit?scope=company:${c.id}&tab=dashboard`} className="text-brand-600 hover:underline">Customize its look (Studio)</Link>
                </p>
                {!deleted && (
                  <div className="space-y-4">
                    {!expired && !prod && (
                      <div>
                        <p className="mb-2 text-sm font-medium">Presentation controls</p>
                        <div className="flex flex-wrap gap-2">
                          <Op id={c.id} op="lead" label="Simulate a new lead" variant="primary" />
                          <Op id={c.id} op="reply" label="Simulate a reply" />
                          <Op id={c.id} op="booking" label="Simulate a booking" />
                          <Op id={c.id} op="advance" label="Run next follow-up now" />
                          <Op id={c.id} op="package" label="Switch package">
                            <label htmlFor={`p-${c.id}`} className="sr-only">Package</label>
                            <select id={`p-${c.id}`} name="package" className="input w-auto" defaultValue={c.package}>{PACKAGES.map((p) => <option key={p} value={p}>{PACKAGE_NAMES[p]}</option>)}</select>
                          </Op>
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                      {!prod && <Op id={c.id} op="reset" label="Reset sample data" />}
                      <Op id={c.id} op="extend" label="Extend">
                        <label htmlFor={`d-${c.id}`} className="sr-only">Days</label>
                        <input id={`d-${c.id}`} name="days" type="number" min={1} max={30} defaultValue={7} className="input w-20" />
                      </Op>
                      {!expired && <Op id={c.id} op="revoke" label="End access now" variant="danger" />}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
