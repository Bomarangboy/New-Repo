import Link from "next/link";
import { LifeBuoy, MessageSquare } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/authz/guard";
import { roleCan } from "@/lib/authz/permissions";
import { formatInZone } from "@/lib/timezones";
import { CATEGORIES, listMyTickets, STATUS_LABELS } from "@/server/support";
import { createTicketAction } from "../actions";
import { TICKET_TONES } from "./ticket-bits";

export const metadata = { title: "Help & Support" };

export default async function HelpPage() {
  const ctx = await pageContext("support.request");
  const tickets = await listMyTickets(ctx);
  const canPause = roleCan(ctx.role, "automation.emergency_pause");
  return (
    <>
      <PageHeader title="Help & Support" subtitle="Ask Bluewater a question or report a problem. Support hours: 7am–1am Eastern, every day." />
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card title="New support request">
          <ActionForm action={createTicketAction} className="space-y-3">
            <Field label="Subject" name="subject" required maxLength={150} placeholder="e.g. Texts aren't going out" />
            <div>
              <label htmlFor="category" className="label">What kind of request?</label>
              <select id="category" name="category" className="input" defaultValue="question">
                {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div><label htmlFor="body" className="label">Details</label><textarea id="body" name="body" rows={5} required maxLength={5000} className="input" placeholder="What happened, which lead or message, and when." /></div>
            <p className="text-xs text-muted">Don&apos;t include passwords or card numbers. You&apos;ll get a reference (like BW-1042) and replies by email and here.</p>
            <SubmitButton>Send to Bluewater</SubmitButton>
          </ActionForm>
        </Card>
        <div className="space-y-6">
          <Card title="Urgent: stop all automatic messages">
            <p className="flex items-start gap-3 text-sm text-muted"><LifeBuoy className="mt-0.5 size-5 shrink-0 text-brand-500" />
              <span>If messages are going out that shouldn&apos;t, {canPause ? <>use <Link href="/app/automations" className="font-medium text-brand-600 hover:underline">Automations → Emergency pause</Link> right away — it stops everything immediately — then</> : "ask your account owner to use the emergency pause in Automations, and"} open an <strong>Urgent</strong> request here.</span></p>
          </Card>
          <Card title="Your requests">
            {tickets.length === 0 ? <p className="text-sm text-muted">No requests yet.</p> : (
              <ul className="divide-y divide-line">
                {tickets.map((t) => (
                  <li key={t.id}>
                    <Link href={`/app/help/tickets/${t.id}`} className="flex items-start gap-3 py-3 hover:text-brand-600">
                      <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1"><span className="block truncate font-medium">{t.subject}</span>
                        <span className="text-xs text-muted">{t.reference} · {formatInZone(t.lastActivityAt, ctx.timezone, { dateStyle: "medium", timeStyle: "short" })}</span></span>
                      <Badge tone={TICKET_TONES[t.status]}>{STATUS_LABELS[t.status] ?? t.status}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <Card title="How numbers are calculated" className="mt-6">
        <dl className="space-y-3 text-sm">
          <div><dt className="font-medium">Periods</dt><dd className="text-muted">“Last 30 days” runs from midnight at the start of the first day until now, in your company&apos;s timezone (Settings). The previous period is the same number of days just before.</dd></div>
          <div><dt className="font-medium">New inquiries</dt><dd className="text-muted">Every inquiry submitted in the period, from all sources. A returning customer&apos;s new request counts again. Imported history counts on its original date.</dd></div>
          <div><dt className="font-medium">Lead sources</dt><dd className="text-muted">The same inquiries grouped by where they came from; the parts always add up to the total.</dd></div>
          <div><dt className="font-medium">Pipeline</dt><dd className="text-muted">Where the inquiries received in the period are now (New, Contacted, Booked, Won, Lost).</dd></div>
          <div><dt className="font-medium">Recorded sales</dt><dd className="text-muted">Sale values you entered on leads marked Won during the period. If a won lead has no value, we tell you the total is incomplete. This is not the same as revenue caused by advertising.</dd></div>
          <div><dt className="font-medium">“No data yet”</dt><dd className="text-muted">We show this — never a zero — when a number can&apos;t be calculated yet, for example before automatic replies are set up.</dd></div>
          <div><dt className="font-medium">Ad tracking</dt><dd className="text-muted">A lead shows campaign details only when they arrived with the inquiry. Many inquiries can&apos;t be linked to a specific ad; that&apos;s normal.</dd></div>
          <div><dt className="font-medium">Weekly summary</dt><dd className="text-muted">Bluewater Insight owners get last week&apos;s numbers (Monday to Sunday, your timezone) every Monday morning, using exactly these definitions.</dd></div>
        </dl>
      </Card>
    </>
  );
}
