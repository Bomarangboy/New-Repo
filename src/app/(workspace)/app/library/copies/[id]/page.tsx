import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Circle, Pencil } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { StepList } from "@/components/library-steps";
import { pageContext } from "@/lib/authz/guard";
import { roleCan } from "@/lib/authz/permissions";
import { getCopy, updatePreview } from "@/server/library/customer";
import { CONFIRMATIONS } from "@/server/library/readiness";
import { activateAction, archiveCopyAction, confirmSetupAction, saveAckDraftAction, updateAction } from "../../actions";

export const metadata = { title: "Set up your copy" };

const DIFF_LABEL = { same: ["No change", "neutral"], updated: ["Bluewater updated this", "blue"], conflict: ["Both changed — your version is kept in a merge", "amber"], yours: ["Only you changed this — kept", "green"], added: ["New step", "blue"], removed: ["Step removed", "amber"] } as const;

export default async function CopyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ copied?: string; activated?: string }> }) {
  const ctx = await pageContext("library.view", "acknowledgment");
  const id = (await params).id;
  const r = await getCopy(ctx, id);
  if (!r) notFound();
  const sp = await searchParams;
  const { copy: c, template: t, content, items, blockers } = r;
  const canEdit = roleCan(ctx.role, "library.adopt") && ctx.policy.login === "full";
  const isOn = c.kind === "sequence" ? content.seq?.status === "active" : c.status === "active";
  const update = r.updateAvailable ? await updatePreview(ctx, id) : null;
  const ack = c.draft as { smsBody?: string; emailSubject?: string; emailBody?: string };
  const setup = c.setup as Record<string, boolean>;
  return (
    <>
      <Link href="/app/library" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> Sequence Library</Link>
      <PageHeader title={c.kind === "sequence" ? content.seq?.name ?? t.name : `${t.name} (your copy)`}
        subtitle={`Your private copy of “${t.name}”, version ${c.templateVersion}. Editing it never changes the library original or anyone else's copy.`}
        actions={isOn ? <Badge tone="green" dot>On</Badge> : <Badge tone="amber" dot>Draft — not in use</Badge>} />
      {sp.copied && <p role="status" className="mb-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Copied. Nothing has been sent and nobody has been added. Work through the steps below, then turn it on.</p>}
      {sp.activated && <p role="status" className="mb-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{sp.activated === "ack" ? "This is now your automatic acknowledgment for new leads." : `Turned on. ${sp.activated === "auto" ? "New eligible leads from your live forms will start it automatically from now on." : "It runs only for people you add from their lead page."} Nobody already in Bluewater was added.`}</p>}
      {t.status === "paused" && <p className="mb-6 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800">Bluewater paused this template for review{t.statusReason ? `: ${t.statusReason}` : ""}. Anyone who was receiving it has been paused; resume them from their lead page once you&apos;re comfortable.</p>}
      {t.status === "retired" && <p className="mb-6 rounded-2xl bg-canvas px-4 py-3 text-sm">Bluewater retired this template for new users. Your copy keeps working exactly as you set it up.</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <Card title="1 · Customize the messages" actions={c.kind === "sequence" && content.seq ? <Link href={`/app/automations/sequences/${content.seq.id}`} className="btn-secondary"><Pencil className="size-4" /> Edit in the sequence editor</Link> : undefined}>
            {c.kind === "sequence" ? (
              <>
                <StepList kind="sequence" steps={content.steps} />
                <p className="mt-3 text-xs text-muted">Edit wording, waits and channels in the normal sequence editor (every save is versioned). Come back here to finish setup.</p>
              </>
            ) : canEdit ? (
              <ActionForm action={saveAckDraftAction} className="space-y-3">
                <input type="hidden" name="copyId" value={c.id} />
                <div><label htmlFor="sms" className="label">Text message (sent only to people who gave text permission)</label><textarea id="sms" name="smsBody" rows={3} defaultValue={ack.smsBody ?? ""} className="input" /></div>
                <div><label htmlFor="subj" className="label">Email subject</label><input id="subj" name="emailSubject" defaultValue={ack.emailSubject ?? ""} className="input" /></div>
                <div><label htmlFor="body" className="label">Email</label><textarea id="body" name="emailBody" rows={6} defaultValue={ack.emailBody ?? ""} className="input" /></div>
                <p className="text-xs text-muted">Fields like {"{{first_name|there}}"} are filled in for each lead. Replace any [[highlighted]] placeholders.</p>
                <SubmitButton variant="secondary">Save draft wording</SubmitButton>
              </ActionForm>
            ) : <StepList kind="acknowledgment" steps={[{ delayMinutes: 0, channel: "ack", ...ack }]} />}
          </Card>

          {update?.available && (
            <Card title={`Update available: version ${update.from} → ${update.to}`}>
              {update.changelog && <p className="mb-3 text-sm">What changed: {update.changelog}</p>}
              <ul className="mb-4 space-y-2 text-sm">
                {update.diffs.map((d) => {
                  const [label, tone] = DIFF_LABEL[d.status];
                  return <li key={d.position} className="flex flex-wrap items-center gap-2">{c.kind === "sequence" ? `Step ${d.position + 1}` : "Message"}: <Badge tone={tone}>{label}</Badge></li>;
                })}
              </ul>
              {c.kind === "sequence" && <p className="mb-3 text-xs text-muted">{update.openEnrollments} person(s) currently in this follow-up will finish the version they started; only new enrollments use the updated steps.</p>}
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  {update.sameLength && <ActionForm action={updateAction}><input type="hidden" name="copyId" value={c.id} /><input type="hidden" name="mode" value="merge" /><SubmitButton>Take Bluewater&apos;s changes, keep my edits</SubmitButton></ActionForm>}
                  <ActionForm action={updateAction}><input type="hidden" name="copyId" value={c.id} /><input type="hidden" name="mode" value="replace" /><SubmitButton variant="secondary">Replace with the new version</SubmitButton></ActionForm>
                  <ActionForm action={updateAction}><input type="hidden" name="copyId" value={c.id} /><input type="hidden" name="mode" value="dismiss" /><SubmitButton variant="secondary">Keep my version</SubmitButton></ActionForm>
                </div>
              )}
              <p className="mt-3 text-xs text-muted">Nothing changes in your copy unless you choose. Your setup checklist is re-checked before anything new can be turned on.</p>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="2 · Check the setup">
            <ul className="space-y-3">
              {items.map((i) => (
                <li key={i.key} className="flex gap-3 text-sm">
                  {i.status === "ok" ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" /> : i.status === "warn" ? <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" /> : <Circle className="mt-0.5 size-5 shrink-0 text-slate-400" />}
                  <span><b>{i.label}</b>{i.blocking && i.status !== "ok" ? <span className="ml-1 text-xs text-amber-700">(required)</span> : null}<span className="block text-muted">{i.detail}</span></span>
                </li>
              ))}
            </ul>
            {canEdit && (
              <ActionForm action={confirmSetupAction} className="mt-4 space-y-2 border-t border-line pt-4">
                <input type="hidden" name="copyId" value={c.id} />
                <p className="text-sm font-medium">Confirm</p>
                {(Object.entries(CONFIRMATIONS) as [keyof typeof CONFIRMATIONS, string][]).filter(([k]) => c.kind === "sequence" || k !== "handoff").map(([k, text]) => (
                  <label key={k} className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" value={k} defaultChecked={!!setup[k]} className="mt-1" /> {text}</label>
                ))}
                <SubmitButton variant="secondary">Save confirmations</SubmitButton>
              </ActionForm>
            )}
          </Card>

          <Card title="3 · Turn it on">
            {isOn ? <p className="text-sm">This is on.{c.kind === "sequence" ? <> Manage it under <Link href={`/app/automations/sequences/${content.seq!.id}`} className="text-brand-600 hover:underline">Automations</Link>; turning it off there stops everyone in it.</> : " New leads receive this wording."}</p>
              : !canEdit ? <p className="text-sm text-muted">Ask your account owner to turn this on.</p>
              : (
                <ActionForm action={activateAction} className="space-y-3">
                  <input type="hidden" name="copyId" value={c.id} /><input type="hidden" name="kind" value={c.kind} />
                  {c.kind === "sequence" && (
                    <>
                      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="autoEnroll" className="mt-1" /> Also start it automatically for <b>new</b> eligible leads from my live forms, from now on</label>
                      <p className="text-xs text-muted">Turning on never adds anyone already in Bluewater. To add an existing or imported lead, open the lead and choose “Start follow-up” — you&apos;ll confirm they asked to be contacted, and the usual checks (opt-outs, other follow-ups, permissions) apply.</p>
                    </>
                  )}
                  {c.kind === "acknowledgment" && <p className="text-xs text-muted">This replaces your current automatic acknowledgment wording for new leads (your previous wording is kept in Automations → Wording history).</p>}
                  {blockers.length > 0 && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">Still needed: {blockers.map((b) => b.label).join(", ")}.</p>}
                  <SubmitButton>{c.kind === "sequence" ? "Turn on" : "Use as my acknowledgment"}</SubmitButton>
                </ActionForm>
              )}
          </Card>

          {canEdit && !isOn && (
            <ActionForm action={archiveCopyAction}><input type="hidden" name="copyId" value={c.id} /><SubmitButton variant="secondary">Remove this copy</SubmitButton></ActionForm>
          )}
        </div>
      </div>
    </>
  );
}
