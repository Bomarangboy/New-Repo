import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/authz/guard";
import { listCompanies } from "@/server/companies";
import { listNotices, noticeRecipients } from "@/server/support";
import { cancelNoticeAction, createNoticeAction, sendNoticeAction } from "../support-actions";

export const metadata = { title: "Service notices" };
export const dynamic = "force-dynamic";

const when = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(d) + " ET" : "—");
const TONES = { draft: "amber", sent: "green", cancelled: "neutral" } as const;

export default async function NoticesPage({ searchParams }: { searchParams: Promise<{ review?: string; sent?: string }> }) {
  const ctx = await requirePlatformAdmin();
  const sp = await searchParams;
  const reviewId = sp.review;
  const sent = Number(sp.sent);
  const [notices, companies] = await Promise.all([listNotices(ctx), listCompanies(ctx)]);
  const review = reviewId && notices.some((n) => n.id === reviewId && n.status === "draft") ? await noticeRecipients(ctx, reviewId) : null;
  return (
    <>
      <PageHeader title="Service notices" subtitle="Tell client owners about outages, maintenance or changes. Drafts are never sent until you review the exact recipient list and confirm." />
      {sent > 0 && <p role="status" className="mb-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Sent to {sent} owner(s).</p>}
      {review && (
        <Card title={`Review before sending: “${review.notice.title}”`} className="mb-6">
          <p className="mb-3 whitespace-pre-wrap rounded-2xl bg-canvas px-4 py-3 text-sm">{review.notice.body}</p>
          <p className="mb-2 text-sm font-medium">{review.recipients.length} recipient(s) — the owner of each company:</p>
          <ul className="mb-4 max-h-64 overflow-y-auto text-sm text-muted">{review.recipients.map((r) => <li key={`${r.companyId}:${r.email}`}>{r.company} — {r.email}{r.kind !== "customer" ? ` (${r.kind.replace("_", " ")})` : ""}</li>)}</ul>
          <div className="flex flex-wrap items-start gap-3">
            <ActionForm action={sendNoticeAction} className="space-y-2">
              <input type="hidden" name="noticeId" value={review.notice.id} />
              <input type="hidden" name="confirmedCount" value={review.recipients.length} />
              <SubmitButton variant="danger">Send real email to {review.recipients.length} owner(s)</SubmitButton>
            </ActionForm>
            <form action={cancelNoticeAction}><input type="hidden" name="noticeId" value={review.notice.id} /><button className="btn-secondary">Cancel draft</button></form>
          </div>
          <p className="mt-3 text-xs text-muted">These are real emails from the Bluewater system address. If the list changes before you press send, sending is refused and you&apos;ll be asked to review again. Remember to update the public status page too (docs/MONITORING.md).</p>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="New notice">
          <ActionForm action={createNoticeAction} className="space-y-3">
            <Field label="Subject" name="title" required maxLength={150} placeholder="e.g. Text messages delayed this morning" />
            <div><label htmlFor="nbody" className="label">Message</label><textarea id="nbody" name="body" rows={6} required maxLength={5000} className="input" placeholder="What happened, who is affected, what you're doing, and when you'll update them next." /></div>
            <fieldset>
              <legend className="label">Send to</legend>
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="audience" value="all_active" defaultChecked /> Owners of all current customers (onboarding, active, paused)</label>
              <label className="mt-1 flex items-center gap-2 text-sm"><input type="radio" name="audience" value="selected" /> Only the companies ticked below</label>
              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-line p-3">
                {companies.map((c) => <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="companyIds" value={c.id} /> {c.name} <span className="text-xs text-muted">({c.lifecycleStatus})</span></label>)}
              </div>
            </fieldset>
            <SubmitButton>Save draft and review recipients</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Recent notices">
          {notices.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
            <ul className="divide-y divide-line text-sm">
              {notices.map((n) => (
                <li key={n.id} className="flex items-start gap-3 py-3">
                  <span className="min-w-0 flex-1"><span className="block font-medium">{n.title}</span>
                    <span className="text-xs text-muted">{n.status === "sent" ? `Sent ${when(n.sentAt)} to ${n.recipientCount} owner(s)` : `Created ${when(n.createdAt)}`}</span></span>
                  <Badge tone={TONES[n.status as keyof typeof TONES] ?? "neutral"}>{n.status}</Badge>
                  {n.status === "draft" && <Link href={`/admin/notices?review=${n.id}`} className="text-sm font-medium text-brand-600 hover:underline">Review</Link>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
