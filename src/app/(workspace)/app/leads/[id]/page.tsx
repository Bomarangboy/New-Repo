import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckSquare, Square } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card } from "@/components/ui";
import { StageBadge, money, sourceName } from "@/components/lead-bits";
import { pageContext } from "@/lib/authz/guard";
import { roleCan } from "@/lib/authz/permissions";
import { hasFeature } from "@/lib/authz/entitlements";
import { formatInZone } from "@/lib/timezones";
import { assignableMembers, getLead, STAGES, STAGE_LABELS } from "@/server/crm/leads";
import { openConversationForLeadAction } from "../../conversations/actions";
import { acknowledgmentStatus, recentMessagesForContact } from "@/server/messaging/inbox";
import { MessageSquare } from "lucide-react";
import { addNoteAction, addTaskAction, assignAction, changeStageAction, recordSaleAction, toggleTaskAction, updateContactAction } from "../actions";
import { AppointmentsCard, FollowUpCard } from "./follow-up-cards";
import { STOP_LABELS, type StopCode } from "@/server/sequences/stop";

export const metadata = { title: "Lead" };

const TRACKING_LABELS: Record<string, string> = {
  utm_source: "Campaign source", utm_medium: "Medium", utm_campaign: "Campaign", utm_term: "Keyword", utm_content: "Ad content",
  gclid: "Google click ID", gbraid: "Google click ID (iOS)", wbraid: "Google click ID (web-to-app)", fbclid: "Facebook click ID", msclkid: "Microsoft click ID",
  landing_page: "Page", referrer: "Came from",
};

function describe(type: string, d: Record<string, unknown>, names: Map<string, string>): string {
  const who = (id: unknown) => (id ? names.get(String(id)) ?? "a former team member" : "no one");
  switch (type) {
    case "created": {
      const dedupe = d.dedupe === "new_contact" ? "new contact" : "matched an existing contact";
      return `Inquiry received (${dedupe}${d.repeat ? ", repeat inquiry" : ""})`;
    }
    case "stage_changed": return `Stage changed from ${STAGE_LABELS[d.from as keyof typeof STAGE_LABELS] ?? d.from} to ${STAGE_LABELS[d.to as keyof typeof STAGE_LABELS] ?? d.to}${d.lostReason ? ` — ${d.lostReason}` : ""}`;
    case "sale_recorded": {
      if (d.toCents == null) return "Sale value cleared";
      const moved = d.stageFrom && d.stageFrom !== "won" ? ` — stage changed from ${STAGE_LABELS[d.stageFrom as keyof typeof STAGE_LABELS] ?? d.stageFrom} to Won` : "";
      return `Sale recorded: ${money(d.toCents as number)}${moved}`;
    }
    case "assigned": return `Assigned to ${who(d.to)}${d.reason === "member_removed" ? " (previous assignee left the team)" : ""}`;
    case "note_added": return "Note added";
    case "task_added": return `Task added: ${d.title}`;
    case "task_completed": return `Task completed: ${d.title}`;
    case "task_reopened": return `Task reopened: ${d.title}`;
    case "contact_updated": return "Contact details edited";
    case "follow_up_started": return `Follow-up started${d.origin === "manual" ? " by hand" : " automatically"}${d.confirmedPersonAsked ? " (team member confirmed the person asked to be contacted)" : ""}`;
    case "follow_up_not_started": return `Follow-up not started: ${d.reason}`;
    case "follow_up_stopped": return `Follow-up stopped: ${STOP_LABELS[d.code as StopCode] ?? d.reason}`;
    case "follow_up_paused": return "Follow-up paused";
    case "follow_up_resumed": return "Follow-up resumed";
    case "follow_up_completed": return "Follow-up finished — all steps handled";
    case "follow_up_step_skipped": return String(d.reason ?? "A follow-up step was skipped");
    case "appointment_booked": return `Appointment booked${d.source === "simulated" ? " (simulated)" : d.source === "calcom" ? " through Cal.com" : " by the team"}${d.via && d.via !== "entered by team" ? ` — linked by ${d.via}` : ""}`;
    case "appointment_rescheduled": return "Appointment moved to a new time";
    case "appointment_cancelled": return `Appointment cancelled${d.reason ? ` — ${d.reason}` : ""}`;
    case "appointment_outcome": return d.outcome === "no_show" ? "Marked as no-show" : "Appointment marked completed";
    default: return type.replaceAll("_", " ");
  }
}

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await pageContext("lead.view", "leads");
  const { id } = await params;
  const lead = await getLead(ctx, id);
  if (!lead) notFound();
  const { created } = await searchParams;
  const members = await assignableMembers(ctx);
  const [recentMsgs, ack] = await Promise.all([recentMessagesForContact(ctx, lead.contact.id), acknowledgmentStatus(ctx, lead.inquiry.id)]);
  const names = new Map(members.map((m) => [m.userId, m.name || m.email]));
  const { inquiry: q, contact: c } = lead;
  const canEdit = roleCan(ctx.role, "lead.edit") && ctx.policy.login === "full";
  const canAssign = roleCan(ctx.role, "lead.assign") && ctx.policy.login === "full";
  const tasksOn = hasFeature(ctx.package, "tasks");
  const tz = ctx.timezone;
  const title = c.fullName || c.email || c.phone || "Unnamed lead";
  const trackingEntries = Object.entries(q.tracking);
  const externalEntries = Object.entries(q.externalIds);

  return (
    <>
      <Link href="/app/leads" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> Leads</Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        <StageBadge stage={q.stage} />
        {q.isRepeat && <Badge tone="purple">Repeat inquiry</Badge>}
      </div>
      {created && <p className="mb-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Lead added.</p>}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <Card title="Inquiry">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">Service requested</dt><dd className="font-medium">{q.serviceRequested ?? "—"}</dd></div>
              <div><dt className="text-muted">Source</dt><dd className="font-medium">{sourceName(q.source, q.sourceLabel)}</dd></div>
              <div><dt className="text-muted">Submitted</dt><dd>{formatInZone(q.submittedAt, tz)}</dd></div>
              <div><dt className="text-muted">Recorded by Bluewater</dt><dd>{formatInZone(q.receivedAt, tz)}</dd></div>
            </dl>
            {q.message && <p className="mt-4 whitespace-pre-wrap rounded-xl bg-canvas p-3 text-sm">{q.message}</p>}
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Where it came from</p>
              {trackingEntries.length + externalEntries.length === 0 ? (
                <p className="text-sm text-muted">No campaign or tracking details were included with this inquiry, so it can&apos;t be linked to a specific ad.</p>
              ) : (
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  {trackingEntries.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-muted">{TRACKING_LABELS[k] ?? k}</dt><dd className="truncate" title={v}>{v}</dd></div>)}
                  {externalEntries.map(([k, v]) => <div key={k}><dt className="text-muted">{k.replaceAll("_", " ")}</dt><dd className="truncate">{v}</dd></div>)}
                </dl>
              )}
            </div>
            <p className="mt-4 text-xs text-muted">
              {q.automationOrigin === "eligible" ? "Arrived through a connected form; eligible for automatic messages."
                : q.automationOrigin === "held" ? "Arrived while automatic messages were off for this account; it won't be messaged automatically."
                : "Added by hand, imported or created from a booking; it won't receive automatic messages unless a team member starts a follow-up."}
            </p>
          </Card>

          <Card title="Messages" actions={roleCan(ctx.role, "conversation.view") ? (
            <form action={openConversationForLeadAction}><input type="hidden" name="inquiryId" value={q.id} /><button className="btn-secondary px-3 py-1.5 text-sm"><MessageSquare className="size-4" /> Open conversation</button></form>
          ) : undefined}>
            {ack && (
              <p className="mb-3 rounded-xl bg-canvas px-3 py-2 text-sm">
                <span className="font-medium">Automatic acknowledgment: </span>
                {ack.status === "succeeded" ? "sent" : ack.status === "queued" ? (ack.result ? `waiting — ${ack.result.toLowerCase()} (next try ${formatInZone(ack.runAt, tz, { timeStyle: "short", dateStyle: "medium" })})` : "about to send") : ack.status === "cancelled" ? `not sent — ${ack.result ?? "no longer needed"}` : ack.status === "dead" ? "failed after several tries — Bluewater has been alerted" : ack.status}
              </p>
            )}
            {recentMsgs.length === 0 ? <p className="text-sm text-muted">No messages with this person yet.</p> : (
              <ul className="space-y-2 text-sm">
                {recentMsgs.map((m) => (
                  <li key={m.id} className="flex items-start gap-2">
                    <Badge tone={m.direction === "inbound" ? "purple" : "blue"}>{m.direction === "inbound" ? "They wrote" : m.kind === "manual" ? "You" : m.kind === "follow_up" ? "Follow-up" : m.kind.startsWith("booking_") ? "Booking" : "Auto"}</Badge>
                    <span className="min-w-0 flex-1 truncate">{m.body.split("\n")[0]}</span>
                    <span className="shrink-0 text-xs text-muted">{m.transport === "simulated" ? "simulated · " : ""}{m.direction === "outbound" ? m.status : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Notes">
            {canEdit && (
              <ActionForm action={addNoteAction} className="mb-4 space-y-2">
                <input type="hidden" name="inquiryId" value={q.id} />
                <label htmlFor="body" className="sr-only">New note</label>
                <textarea id="body" name="body" rows={3} required className="input" placeholder="Add a note for your team…" />
                <SubmitButton variant="secondary">Add note</SubmitButton>
              </ActionForm>
            )}
            {lead.notes.length === 0 ? <p className="text-sm text-muted">No notes yet.</p> : (
              <ul className="space-y-3">
                {lead.notes.map(({ n, authorName, authorEmail }) => (
                  <li key={n.id} className="rounded-xl border border-line p-3">
                    <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                    <p className="mt-2 text-xs text-muted">{authorName || authorEmail || "Bluewater support"} · {formatInZone(n.createdAt, tz)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="History">
            <ol className="relative space-y-4 border-l border-line pl-5">
              {lead.history.map(({ e, actorName, actorEmail }) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[1.62rem] top-1.5 size-2.5 rounded-full border-2 border-white bg-brand-500" />
                  <p className="text-sm">{describe(e.type, e.details, names)}</p>
                  <p className="text-xs text-muted">{formatInZone(e.createdAt, tz)} · {e.actorType === "system" ? "Automatically" : e.actorType === "support" ? "Bluewater support" : actorName || actorEmail || "Former team member"}</p>
                  {Array.isArray(e.details.notes) && (e.details.notes as string[]).length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-xs text-amber-800">{(e.details.notes as string[]).map((n) => <li key={n}>{n}</li>)}</ul>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <FollowUpCard ctx={ctx} lead={q} />
          <AppointmentsCard ctx={ctx} lead={q} contact={c} />

          <Card title="Contact">
            <ActionForm action={updateContactAction}>
              <fieldset disabled={!canEdit} className="space-y-3">
                <input type="hidden" name="inquiryId" value={q.id} />
                <Field label="Name" name="fullName" defaultValue={c.fullName} />
                <Field label="Email" name="email" type="email" defaultValue={c.email ?? ""} />
                <Field label="Phone" name="phone" type="tel" defaultValue={c.phone ?? ""} />
                {canEdit && <SubmitButton variant="secondary">Save contact</SubmitButton>}
              </fieldset>
            </ActionForm>
          </Card>

          <Card title="Stage & assignment">
            <ActionForm action={changeStageAction} className="space-y-3">
              <fieldset disabled={!canEdit} className="space-y-3">
                <input type="hidden" name="inquiryId" value={q.id} />
                <label className="label" htmlFor="stage">Stage</label>
                <select id="stage" name="stage" defaultValue={q.stage} className="input">{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</select>
                <Field label="If lost, why? (optional)" name="lostReason" defaultValue={q.lostReason ?? ""} />
                {canEdit && <SubmitButton variant="secondary">Update stage</SubmitButton>}
              </fieldset>
            </ActionForm>
            <hr className="my-5 border-line" />
            <ActionForm action={assignAction} className="space-y-3">
              <fieldset disabled={!canAssign} className="space-y-3">
                <input type="hidden" name="inquiryId" value={q.id} />
                <label className="label" htmlFor="userId">Assigned to</label>
                <select id="userId" name="userId" defaultValue={q.assignedUserId ?? ""} className="input"><option value="">Unassigned</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name || m.email}</option>)}</select>
                {canAssign && <SubmitButton variant="secondary">Save assignment</SubmitButton>}
              </fieldset>
            </ActionForm>
          </Card>

          <Card title="Sale">
            <p className="mb-3 text-sm">Recorded value: <span className="font-semibold">{q.saleValueCents == null ? "not recorded" : money(q.saleValueCents)}</span></p>
            {canEdit && (
              <ActionForm action={recordSaleAction} className="space-y-3">
                <input type="hidden" name="inquiryId" value={q.id} />
                <Field label="Sale amount (USD)" name="amount" inputMode="decimal" placeholder="e.g. 1250" defaultValue={q.saleValueCents == null ? "" : (q.saleValueCents / 100).toFixed(2)} hint="Saving an amount marks the lead Won. Leave empty and save to clear it." />
                <SubmitButton variant="secondary">Save sale</SubmitButton>
              </ActionForm>
            )}
          </Card>

          {tasksOn && (
            <Card title="Follow-up tasks">
              {lead.tasks.length === 0 ? <p className="mb-3 text-sm text-muted">No tasks.</p> : (
                <ul className="mb-4 space-y-2">
                  {lead.tasks.map(({ t, assigneeName }) => (
                    <li key={t.id} className="flex items-start gap-2 text-sm">
                      <form action={toggleTaskAction}>
                        <input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="inquiryId" value={q.id} /><input type="hidden" name="done" value={t.completedAt ? "0" : "1"} />
                        <button disabled={!canEdit} aria-label={t.completedAt ? "Mark not done" : "Mark done"} className="mt-0.5 text-brand-600 disabled:opacity-50">{t.completedAt ? <CheckSquare className="size-4" /> : <Square className="size-4" />}</button>
                      </form>
                      <span className={t.completedAt ? "text-muted line-through" : ""}>{t.title}<span className="block text-xs text-muted">{t.dueAt ? `Due ${formatInZone(t.dueAt, "UTC", { dateStyle: "medium" })}` : "No due date"}{assigneeName ? ` · ${assigneeName}` : ""}</span></span>
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && (
                <ActionForm action={addTaskAction} className="space-y-3">
                  <input type="hidden" name="inquiryId" value={q.id} />
                  <Field label="New task" name="title" placeholder="e.g. Call back with a quote" required />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Due" name="dueAt" type="date" />
                    <div><label className="label" htmlFor="assignTo">For</label><select id="assignTo" name="assignTo" className="input" defaultValue={ctx.userId}><option value="">Anyone</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name || m.email}</option>)}</select></div>
                  </div>
                  <SubmitButton variant="secondary">Add task</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}

          <Card title="Contact permission">
            {lead.consent.length === 0 ? (
              <p className="text-sm text-muted">No permission evidence recorded. Automatic texts need recorded permission; check before contacting this person by text.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {lead.consent.map((r) => (
                  <li key={r.id} className="rounded-xl border border-line p-3">
                    <p className="font-medium">{r.channel === "sms" ? "Text messages" : "Email"}: {r.granted ? <Badge tone="green">Agreed</Badge> : <Badge>Declined</Badge>}</p>
                    {r.statement && <p className="mt-1 text-xs text-muted">“{r.statement}”</p>}
                    <p className="mt-1 text-xs text-muted">{r.method.replaceAll("_", " ")} · {formatInZone(r.capturedAt, tz)}{r.pageUrl ? ` · ${r.pageUrl}` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {lead.otherInquiries.length > 0 && (
            <Card title="Other inquiries from this person">
              <ul className="divide-y divide-line text-sm">
                {lead.otherInquiries.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/app/leads/${o.id}`} className="hover:text-brand-600">{o.serviceRequested ?? sourceName(o.source)}<span className="block text-xs text-muted">{formatInZone(o.submittedAt, tz, { dateStyle: "medium" })}</span></Link>
                    <StageBadge stage={o.stage} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
