import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/authz/guard";
import { assignableMembers } from "@/server/crm/leads";
import { createLeadAction } from "../actions";

export const metadata = { title: "Add lead" };

export default async function NewLeadPage() {
  const ctx = await pageContext("lead.create", "leads");
  const members = await assignableMembers(ctx);
  return (
    <>
      <Link href="/app/leads" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> Leads</Link>
      <PageHeader title="Add a lead" subtitle="For inquiries that came in by phone, in person or by email." />
      <Card className="max-w-2xl">
        <ActionForm action={createLeadAction}>
          <Field label="Name" name="fullName" autoComplete="off" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" name="email" type="email" autoComplete="off" />
            <Field label="Phone" name="phone" type="tel" autoComplete="off" />
          </div>
          <p className="-mt-2 text-xs text-muted">Enter an email, a phone number, or both. If this person is already in your records, the inquiry is added to their history.</p>
          <Field label="Service requested" name="serviceRequested" />
          <div><label className="label" htmlFor="message">What did they ask about?</label><textarea id="message" name="message" rows={4} className="input" /></div>
          <div><label className="label" htmlFor="assignTo">Assign to</label>
            <select id="assignTo" name="assignTo" className="input" defaultValue={ctx.userId}><option value="">Unassigned</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name || m.email}</option>)}</select>
          </div>
          <p className="rounded-xl bg-canvas px-3 py-2 text-xs text-muted">Leads added by hand don&apos;t receive automatic messages.</p>
          <SubmitButton>Add lead</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
