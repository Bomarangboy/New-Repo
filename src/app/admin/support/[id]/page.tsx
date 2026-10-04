import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/authz/guard";
import { CATEGORIES, getTicketAdmin, TICKET_STATUSES } from "@/server/support";
import { adminReplyAction } from "../../support-actions";

export const metadata = { title: "Support request" };
export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = { open: "Needs Bluewater", waiting_on_customer: "Waiting on client", resolved: "Resolved", closed: "Closed" };
const when = (d: Date) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(d) + " ET";

export default async function AdminTicket({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePlatformAdmin();
  const r = await getTicketAdmin(ctx, (await params).id);
  if (!r) notFound();
  const t = r.t;
  return (
    <>
      <PageHeader title={`${t.reference}: ${t.subject}`} subtitle={`${r.company} · ${CATEGORIES[t.category as keyof typeof CATEGORIES] ?? t.category}`}
        actions={<Link href={`/admin/companies/${t.companyId}`} className="btn-secondary">Open company</Link>} />
      <Card title="Conversation" className="mb-6">
        <ol className="space-y-4">
          {r.messages.map(({ m, name, email }) => (
            <li key={m.id} className={`rounded-2xl px-4 py-3 text-sm ${m.internal ? "border border-dashed border-amber-300 bg-amber-50" : m.authorType === "bluewater" ? "bg-brand-50" : "bg-canvas"}`}>
              <p className="mb-1 text-xs text-muted"><span className="font-medium text-ink">{m.authorType === "bluewater" ? `Bluewater (${name ?? "admin"})` : `${name ?? "Client"} <${email ?? "unknown"}>`}</span> · {when(m.createdAt)}
                {m.internal && <span className="ml-2"><Badge tone="amber">Internal note — client can&apos;t see</Badge></span>}</p>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ol>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Reply to client">
          <ActionForm action={adminReplyAction} className="space-y-3">
            <input type="hidden" name="ticketId" value={t.id} />
            <label htmlFor="reply" className="sr-only">Reply</label>
            <textarea id="reply" name="body" rows={5} required maxLength={5000} className="input" />
            <div><label htmlFor="status" className="label">Status after replying</label>
              <select id="status" name="status" className="input" defaultValue="waiting_on_customer">{TICKET_STATUSES.map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}</select></div>
            <p className="text-xs text-muted">Emailed to the person who opened the request. Never include passwords or keys.</p>
            <SubmitButton>Send reply</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Internal note or status change">
          <ActionForm action={adminReplyAction} className="space-y-3">
            <input type="hidden" name="ticketId" value={t.id} />
            <input type="hidden" name="internal" value="1" />
            <label htmlFor="note" className="sr-only">Internal note</label>
            <textarea id="note" name="body" rows={5} maxLength={5000} className="input" placeholder="Optional. Only Bluewater administrators can see this." />
            <div><label htmlFor="status2" className="label">Status</label>
              <select id="status2" name="status" className="input" defaultValue={t.status}>{TICKET_STATUSES.map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}</select></div>
            <SubmitButton variant="secondary">Save note / status</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
