import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/authz/guard";
import { PACKAGE_LABELS, PACKAGES } from "@/lib/authz/entitlements";
import { US_TIMEZONES } from "@/lib/timezones";
import { createCompanyAction } from "../../actions";

export const metadata = { title: "New company" };

export default async function NewCompanyPage() {
  await requirePlatformAdmin();
  return (
    <>
      <PageHeader title="New company" subtitle="Creates a private workspace. It starts in Onboarding: leads are stored, but nothing is sent until you activate it." />
      <Card className="max-w-2xl">
        <ActionForm action={createCompanyAction}>
          <Field label="Business name" name="name" required maxLength={120} />
          <div>
            <label htmlFor="timezone" className="label">Timezone</label>
            <select id="timezone" name="timezone" className="input" defaultValue="America/New_York">{US_TIMEZONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          </div>
          <div>
            <label htmlFor="package" className="label">Package</label>
            <select id="package" name="package" className="input">{PACKAGES.map((p) => <option key={p} value={p}>{PACKAGE_LABELS[p]}</option>)}</select>
          </div>
          <div>
            <label htmlFor="kind" className="label">Type</label>
            <select id="kind" name="kind" className="input"><option value="customer">Paying customer</option><option value="internal_test">Internal test (excluded from customer reports)</option></select>
          </div>
          <SubmitButton>Create company</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
