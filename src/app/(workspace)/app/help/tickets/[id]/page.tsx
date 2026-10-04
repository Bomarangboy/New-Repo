import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/authz/guard";
import { formatInZone } from "@/lib/timezones";
import { CATEGORIES, getMyTicket, STATUS_LABELS } from "@/server/support";
import { replyTicketAction } from "../../../actions";
import { TICKET_TONES } from "../../ticket-bits";

export const metadata = { title: "Support request" };

export default async function TicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await pageContext("support.request");
  const { id } = await params;
  const created = (await searchParams).created === "1";
  const r = await getMyTicket(ctx, id);
  if (!r) notFound();
  const t = r.ticket;
  return (
    <>
      <PageHeader title={`${t.reference}: ${t.subject}`} subtitle={CATEGORIES[t.category as keyof typeof CATEGORIES] ?? t.category}
        actions={<Badge tone={TICKET_TONES[t.status]}>{STATUS_LABELS[t.status] ?? t.status}</Badge>} />
      {created && <p role="status" className="mb-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Request {t.reference} sent. Bluewater has been notified and will reply here and by email.</p>}
      <Card title="Conversation" className="mb-6">
        <ol className="space-y-4">
          {r.messages.map(({ m, name }) => (
            <li key={m.id} className={`rounded-2xl px-4 py-3 text-sm ${m.authorType === "bluewater" ? "bg-brand-50" : "bg-canvas"}`}>
              <p className="mb-1 text-xs text-muted"><span className="font-medium text-ink">{m.authorType === "bluewater" ? "Bluewater" : (name ?? "Your team")}</span> · {formatInZone(m.createdAt, ctx.timezone)}</p>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ol>
      </Card>
      {t.status === "closed" ? <p className="text-sm text-muted">This request is closed. <Link href="/app/help" className="text-brand-600 hover:underline">Open a new one</Link> and mention {t.reference}.</p> : (
        <Card title="Reply">
          <ActionForm action={replyTicketAction} className="space-y-3">
            <input type="hidden" name="ticketId" value={t.id} />
            <label htmlFor="reply" className="sr-only">Your reply</label>
            <textarea id="reply" name="body" rows={4} required maxLength={5000} className="input" />
            <SubmitButton>Send reply</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
