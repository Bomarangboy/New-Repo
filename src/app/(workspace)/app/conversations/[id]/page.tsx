import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, CheckCheck, Clock, FlaskConical, Mail, MessageSquare, ShieldOff, X } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card } from "@/components/ui";
import { StageBadge } from "@/components/lead-bits";
import { pageContext } from "@/lib/authz/guard";
import { roleCan } from "@/lib/authz/permissions";
import { isSimulatedEnvironment } from "@/lib/env";
import { formatInZone } from "@/lib/timezones";
import { getConversation } from "@/server/messaging/inbox";
import { liftOptOutAction, markReadAction, optOutAction, simulateReplyAction } from "../actions";
import { Composer } from "./composer";

export const metadata = { title: "Conversation" };

const STATUS: Record<string, { label: string; icon: typeof Check; tone: string }> = {
  queued: { label: "Queued", icon: Clock, tone: "text-white/80" },
  sending: { label: "Sending", icon: Clock, tone: "text-white/80" },
  submitted: { label: "Sent", icon: Check, tone: "text-white/90" },
  delivered: { label: "Delivered", icon: CheckCheck, tone: "text-white" },
  failed: { label: "Not delivered", icon: X, tone: "text-red-100" },
  unknown: { label: "Unconfirmed — being checked", icon: AlertTriangle, tone: "text-amber-100" },
};
const KIND: Record<string, string> = { acknowledgment: "Automatic acknowledgment", manual: "", auto_reply: "Automatic reply", follow_up: "Automatic follow-up", booking_confirmation: "Booking confirmation", booking_reminder: "Appointment reminder" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("conversation.view", "inbox");
  const { id } = await params;
  const data = await getConversation(ctx, id);
  if (!data) notFound();
  const { conversation: c, contact, thread, leads, suppressions, smsAllowed } = data;
  const tz = ctx.timezone;
  const smsBlocked = suppressions.find((s) => s.channel === "sms");
  const emailBlocked = suppressions.find((s) => s.channel === "email");
  const canSend = roleCan(ctx.role, "message.send_manual") && ctx.policy.manualSending;
  const canSms = Boolean(contact.phoneE164) && !smsBlocked && smsAllowed;
  const canEmail = Boolean(contact.email) && !emailBlocked;
  const simulated = isSimulatedEnvironment() || ctx.companyKind !== "customer";

  return (
    <>
      <Link href="/app/conversations" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> Conversations</Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{contact.fullName || contact.phone || contact.email || "Unknown"}</h1>
        {c.needsReply && <Badge tone="blue">Needs reply</Badge>}
        {c.needsReply && <form action={markReadAction}><input type="hidden" name="conversationId" value={c.id} /><button className="text-sm text-brand-600 hover:underline">Mark as handled</button></form>}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            {thread.length === 0 ? <p className="py-6 text-center text-sm text-muted">No messages yet.</p> : (
              <ol className="space-y-4">
                {thread.map(({ m, senderName }) => {
                  const out = m.direction === "outbound";
                  const st = STATUS[m.status];
                  const Icon = m.channel === "email" ? Mail : MessageSquare;
                  return (
                    <li key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${out ? "rounded-br-md bg-brand-500 text-white" : "rounded-bl-md bg-canvas text-ink"}`}>
                        <p className={`mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${out ? "text-white/80" : "text-muted"}`}>
                          <Icon className="size-3.5" />{m.channel === "email" ? "Email" : "Text"}
                          {out && (KIND[m.kind] || senderName) && <span>· {KIND[m.kind] || senderName}</span>}
                          {m.transport === "simulated" && <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold ${out ? "bg-white/20" : "bg-amber-100 text-amber-900"}`}><FlaskConical className="size-3" />Simulated</span>}
                        </p>
                        {m.subject && <p className="font-semibold">{m.subject}</p>}
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p className={`mt-1 flex items-center justify-end gap-1 text-[11px] ${out ? "text-white/80" : "text-muted"}`}>
                          {formatInZone(m.createdAt, tz, { dateStyle: "medium", timeStyle: "short" })}
                          {out && st && <span className={`inline-flex items-center gap-0.5 ${st.tone}`}>· <st.icon className="size-3" />{st.label}</span>}
                          {m.statusReason && m.direction === "inbound" && <span>· {m.statusReason === "opt_out" ? "opt-out" : m.statusReason === "opt_in" ? "opt-in" : m.statusReason}</span>}
                        </p>
                        {out && m.status === "failed" && m.statusReason && <p className="mt-1 text-xs text-red-100">{m.statusReason}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
          {canSend ? (
            <Card title="Reply">
              <Composer conversationId={c.id} canSms={canSms} canEmail={canEmail}
                smsNote={smsBlocked ? "Texts are off: this person opted out." : !contact.phoneE164 ? "No phone number on file." : !smsAllowed ? "Texting needs recorded permission, or the person texting you first." : null} />
              {simulated && <p className="mt-3 text-xs text-muted">This environment simulates delivery — nothing reaches a real phone or inbox.</p>}
            </Card>
          ) : (
            <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{ctx.policy.manualSending ? "Your role can't send messages." : "Sending is paused for this account."}</p>
          )}
          {simulated && (
            <Card title="Test tools">
              <ActionForm action={simulateReplyAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <input type="hidden" name="conversationId" value={c.id} />
                <div className="flex-1"><Field label="Simulate a reply from this person" name="body" placeholder='e.g. "Tuesday works" or "STOP"' required /></div>
                <select name="channel" className="input sm:w-28" defaultValue={contact.phoneE164 ? "sms" : "email"} aria-label="Channel"><option value="sms">Text</option><option value="email">Email</option></select>
                <SubmitButton variant="secondary">Simulate</SubmitButton>
              </ActionForm>
              <p className="mt-2 text-xs text-muted">Available only in test and demo environments.</p>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Contact">
            <dl className="space-y-2 text-sm">
              <div><dt className="text-muted">Phone</dt><dd>{contact.phone ?? "—"} {smsBlocked && <Badge tone="red">Opted out of texts</Badge>}</dd></div>
              <div><dt className="text-muted">Email</dt><dd className="break-all">{contact.email ?? "—"} {emailBlocked && <Badge tone="red">Unsubscribed</Badge>}</dd></div>
            </dl>
            {leads.length > 0 && (
              <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
                {leads.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/app/leads/${l.id}`} className="hover:text-brand-600">{l.service ?? "Inquiry"}<span className="block text-xs text-muted">{formatInZone(l.submittedAt, tz, { dateStyle: "medium" })}</span></Link>
                    <StageBadge stage={l.stage} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Opt-outs">
            {suppressions.length > 0 && (
              <ul className="mb-4 space-y-3 text-sm">
                {suppressions.map((s) => (
                  <li key={s.id} className="rounded-xl border border-line p-3">
                    <p className="flex items-center gap-2 font-medium"><ShieldOff className="size-4 text-red-600" /> {s.channel === "sms" ? "Texts" : "Email"} off</p>
                    <p className="text-xs text-muted">{({ opt_out_keyword: "Replied with an opt-out", unsubscribe_link: "Used the unsubscribe link", hard_bounce: "Email address doesn't exist", spam_complaint: "Marked an email as spam", manual: "Recorded by staff" } as Record<string, string>)[s.reason] ?? s.reason} · {formatInZone(s.createdAt, tz, { dateStyle: "medium" })}</p>
                    {roleCan(ctx.role, "settings.manage") && (
                      <details className="mt-2 text-xs"><summary className="cursor-pointer text-brand-600">Remove opt-out…</summary>
                        <ActionForm action={liftOptOutAction} className="mt-2 space-y-2">
                          <input type="hidden" name="conversationId" value={c.id} /><input type="hidden" name="suppressionId" value={s.id} />
                          <Field label="How did they give permission again?" name="reason" required minLength={10} />
                          <SubmitButton variant="secondary">Remove opt-out</SubmitButton>
                        </ActionForm>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {roleCan(ctx.role, "contact.opt_out") && (
              <ActionForm action={optOutAction} className="space-y-2">
                <input type="hidden" name="conversationId" value={c.id} />
                <p className="text-sm text-muted">If the person asks not to be contacted — by phone, in person, or in any words — record it here.</p>
                <select name="channel" className="input" aria-label="Channel"><option value="sms">Stop texts</option><option value="email">Stop emails</option></select>
                <Field label="Note (optional)" name="detail" placeholder="e.g. Asked on the phone" />
                <SubmitButton variant="secondary">Record opt-out</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
