import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { StepList, type StepView } from "@/components/library-steps";
import { requirePlatformAdmin } from "@/lib/authz/guard";
import { PACKAGES, PACKAGE_NAMES } from "@/lib/authz/entitlements";
import { emergencyPausePreview, getTemplateAdmin } from "@/server/library/admin";
import { MIN_EVIDENCE } from "@/server/library/customer";
import { ENTRY, INTEGRATIONS, checkDefinition, type Definition } from "@/server/library/format";
import { manageTemplateAction, publishTemplateAction, saveDraftFormAction, saveDraftJsonAction, startDraftAction } from "../actions";

export const metadata = { title: "Library template" };
export const dynamic = "force-dynamic";

const CHANNEL_OPTS = [["sms_or_email", "Text if permitted, else email"], ["sms", "Text only"], ["email", "Email only"]] as const;

function Op({ id, op, label, variant = "secondary", children }: { id: string; op: string; label: string; variant?: "primary" | "secondary" | "danger"; children?: React.ReactNode }) {
  return (
    <ActionForm action={manageTemplateAction} className="space-y-2">
      <input type="hidden" name="templateId" value={id} /><input type="hidden" name="op" value={op} />
      {children}
      <SubmitButton variant={variant}>{label}</SubmitButton>
    </ActionForm>
  );
}

export default async function AdminTemplate({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ imported?: string }> }) {
  const ctx = await requirePlatformAdmin();
  const id = (await params).id;
  const r = await getTemplateAdmin(ctx, id);
  if (!r) notFound();
  const sp = await searchParams;
  const { template: t, draft, versions, adoption, evidence } = r;
  const live = versions[0]?.definition as Definition | undefined;
  const def = (draft?.definition ?? live) as Definition;
  const check = draft ? checkDefinition(draft.definition) : null;
  const pause = t.status === "published" || t.status === "paused" ? await emergencyPausePreview(ctx, id) : null;
  const steps: StepView[] = def.kind === "sequence" ? def.steps : [{ delayMinutes: 0, channel: "ack", ...def.acknowledgment }];
  const slots = def.kind === "sequence" ? [...def.steps, ...(def.steps.length < 8 ? [{ delayMinutes: 1440, channel: "sms_or_email" as const, smsBody: "", emailSubject: "", emailBody: "" }] : [])] : [];

  return (
    <>
      <Link href="/admin/library" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> Sequence Library</Link>
      <PageHeader title={t.name} subtitle={`${t.kind === "sequence" ? "Follow-up sequence" : "Instant reply"} · ${t.industry} · ${t.objective}`}
        actions={<span className="flex flex-wrap gap-1"><Badge tone={t.status === "published" ? "green" : t.status === "paused" ? "red" : t.status === "draft" ? "amber" : "neutral"}>{t.status}{t.latestVersion ? ` · live v${t.latestVersion}` : ""}</Badge>{t.recommended && <Badge tone="blue">Recommended</Badge>}</span>} />
      {sp.imported && <p className="mb-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Imported and checked. It&apos;s a draft — clients can&apos;t see it until you publish.</p>}
      {t.status === "paused" && <p className="mb-6 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800">Emergency pause active{t.statusReason ? `: ${t.statusReason}` : ""}.</p>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          {draft ? (
            <Card title={`Draft (revision ${draft.revision}) — not visible to clients`}>
              {check && !check.ok && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">Needs fixing before publishing: {check.errors.join(" ")}</p>}
              <ActionForm action={saveDraftFormAction} className="space-y-4">
                <input type="hidden" name="templateId" value={t.id} /><input type="hidden" name="revision" value={draft.revision} /><input type="hidden" name="kind" value={def.kind} />
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Name" name="name" defaultValue={def.name} maxLength={80} />
                  <Field label="Category" name="category" defaultValue={def.category ?? ""} maxLength={60} />
                  <Field label="Industry" name="industry" defaultValue={def.industry} maxLength={60} />
                  <Field label="Goal" name="objective" defaultValue={def.objective} maxLength={80} />
                </div>
                <div><label htmlFor="desc" className="label">Description</label><textarea id="desc" name="description" rows={2} defaultValue={def.description} maxLength={500} className="input" /></div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div><label htmlFor="pkg" className="label">Required package</label><select id="pkg" name="requiredPackage" defaultValue={def.requiredPackage} className="input">{PACKAGES.map((p) => <option key={p} value={p}>{PACKAGE_NAMES[p]}</option>)}</select></div>
                  {def.kind === "sequence" && <div><label htmlFor="entry" className="label">Who can start it</label><select id="entry" name="entry" defaultValue={def.entry} className="input">{Object.entries(ENTRY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>}
                </div>
                <fieldset><legend className="label">Required connections</legend>
                  <div className="flex flex-wrap gap-4">{Object.entries(INTEGRATIONS).map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name={`integration.${k}`} defaultChecked={def.requiredIntegrations.includes(k as never)} /> {l}</label>)}</div>
                </fieldset>
                {def.kind === "sequence" ? (
                  <>
                    <div className="flex flex-wrap gap-4 text-sm">
                      <label className="flex items-center gap-2"><input type="checkbox" name="stopOnManualMessage" defaultChecked={def.stopOnManualMessage} /> Stop when a team member messages the lead</label>
                      <label className="flex items-center gap-2"><input type="checkbox" name="handoffTask" defaultChecked={def.handoffTask} /> Create a call-back task when it finishes</label>
                    </div>
                    {slots.map((st, i) => (
                      <fieldset key={i} className="rounded-2xl border border-line p-4">
                        <legend className="px-1 text-sm font-semibold">{i < def.steps.length ? `Step ${i + 1}` : "Add a step (leave empty to skip)"}</legend>
                        <div className="grid gap-3 sm:grid-cols-4">
                          <Field label="Wait (days)" name={`step.${i}.days`} type="number" min={0} max={30} defaultValue={String(Math.floor(st.delayMinutes / 1440))} />
                          <Field label="+ hours" name={`step.${i}.hours`} type="number" min={0} max={23} defaultValue={String(Math.floor((st.delayMinutes % 1440) / 60))} />
                          <div className="sm:col-span-2"><label htmlFor={`ch-${i}`} className="label">Channel</label><select id={`ch-${i}`} name={`step.${i}.channel`} defaultValue={st.channel} className="input">{CHANNEL_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                        </div>
                        <div className="mt-3 space-y-2">
                          <div><label htmlFor={`sms-${i}`} className="label">Text</label><textarea id={`sms-${i}`} name={`step.${i}.sms`} rows={2} defaultValue={st.smsBody ?? ""} className="input" /></div>
                          <Field label="Email subject" name={`step.${i}.emailSubject`} defaultValue={st.emailSubject ?? ""} />
                          <div><label htmlFor={`em-${i}`} className="label">Email</label><textarea id={`em-${i}`} name={`step.${i}.emailBody`} rows={4} defaultValue={st.emailBody ?? ""} className="input" /></div>
                          {i < def.steps.length && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={`step.${i}.remove`} /> Remove this step</label>}
                        </div>
                      </fieldset>
                    ))}
                  </>
                ) : (
                  <>
                    <div><label htmlFor="sms" className="label">Text</label><textarea id="sms" name="smsBody" rows={3} defaultValue={def.acknowledgment.smsBody ?? ""} className="input" /></div>
                    <Field label="Email subject" name="emailSubject" defaultValue={def.acknowledgment.emailSubject ?? ""} />
                    <div><label htmlFor="eb" className="label">Email</label><textarea id="eb" name="emailBody" rows={5} defaultValue={def.acknowledgment.emailBody ?? ""} className="input" /></div>
                  </>
                )}
                <p className="text-xs text-muted">Use {"{{first_name|there}}"}, {"{{company_name}}"}, {"{{service|your project}}"}, {"{{booking_link|fallback}}"}. Put parts each business must write themselves in [[double brackets]]. No links, phone numbers, emails or personal details — they&apos;re rejected.</p>
                <SubmitButton>Check and save draft</SubmitButton>
              </ActionForm>
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-brand-600">Advanced: edit as a file (JSON)</summary>
                <ActionForm action={saveDraftJsonAction} className="mt-3 space-y-2">
                  <input type="hidden" name="templateId" value={t.id} /><input type="hidden" name="revision" value={draft.revision} />
                  <label htmlFor="json" className="sr-only">Template JSON</label>
                  <textarea id="json" name="json" rows={14} defaultValue={JSON.stringify(draft.definition, null, 2)} className="input font-mono text-xs" />
                  <SubmitButton variant="secondary">Check and save</SubmitButton>
                </ActionForm>
              </details>
            </Card>
          ) : (
            <Card title="Draft">
              <p className="mb-3 text-sm text-muted">No draft. To prepare an update, start a draft from the live version. Clients keep seeing the live version until you publish.</p>
              <ActionForm action={startDraftAction}><input type="hidden" name="templateId" value={t.id} /><SubmitButton variant="secondary">Start a draft from version {t.latestVersion}</SubmitButton></ActionForm>
            </Card>
          )}

          <Card title={draft ? "Preview of the draft (as clients will see it)" : `Live version ${t.latestVersion}`}>
            <StepList kind={def.kind} steps={steps} />
          </Card>
        </div>

        <div className="space-y-6">
          {draft && (
            <Card title="Publish">
              <ActionForm action={publishTemplateAction} className="space-y-3">
                <input type="hidden" name="templateId" value={t.id} /><input type="hidden" name="revision" value={draft.revision} />
                <Field label="What changed (shown to businesses with a copy)" name="changelog" maxLength={500} placeholder="e.g. Shorter second step" />
                <p className="text-xs text-muted">Publishing creates version {(t.latestVersion ?? 0) + 1}. Existing copies and people already in a follow-up are not changed — businesses see an update preview and decide.</p>
                <SubmitButton>Publish</SubmitButton>
              </ActionForm>
            </Card>
          )}

          <Card title="Status">
            <div className="flex flex-wrap gap-2">
              {t.status !== "draft" && <Op id={t.id} op={t.recommended ? "unrecommend" : "recommend"} label={t.recommended ? "Remove recommendation" : "Mark as recommended"} />}
              {t.status === "retired" && <Op id={t.id} op="unretire" label="Make available again" />}
              {t.status === "paused" && <Op id={t.id} op="lift" label="Lift the pause" />}
            </div>
            {t.status === "published" && (
              <div className="mt-4 border-t border-line pt-4">
                <Op id={t.id} op="retire" label="Retire (no new copies)">
                  <Field label="Reason (optional, internal)" name="reason" maxLength={300} />
                  <p className="text-xs text-muted">Existing copies keep working unchanged.</p>
                </Op>
              </div>
            )}
          </Card>

          {pause && t.status === "published" && (
            <Card title="Emergency pause (harmful or wrong content)">
              <p className="mb-2 text-sm">Would affect <b>{pause.rows.length}</b> cop{pause.rows.length === 1 ? "y" : "ies"} at <b>{pause.companies}</b> business(es): <b>{pause.running}</b> running follow-up(s) would be paused, <b>{pause.activeAcks}</b> active acknowledgment(s) put back to their previous wording.</p>
              {pause.rows.length > 0 && <ul className="mb-3 max-h-40 overflow-y-auto text-xs text-muted">{pause.rows.map((x) => <li key={x.copyId}>{x.company} — {x.kind}{x.sequenceOn ? ", on" : ""}{x.running ? `, ${x.running} running` : ""}</li>)}</ul>}
              <Op id={t.id} op="pause" label={`Pause for ${pause.companies} business(es)`} variant="danger">
                <input type="hidden" name="confirmedCopies" value={pause.rows.length} />
                <Field label="Reason (shown to affected businesses)" name="reason" required minLength={5} maxLength={300} />
              </Op>
              <p className="mt-2 text-xs text-muted">Recorded in each business&apos;s activity log. Nobody is stopped for good — owners resume paused follow-ups themselves.</p>
            </Card>
          )}

          <Card title="Adoption">
            {adoption.length === 0 ? <p className="text-sm text-muted">No copies yet.</p> : (
              <ul className="space-y-1 text-sm">{adoption.map((a, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{a.company}{a.kind !== "customer" ? <span className="text-xs text-muted"> ({a.kind.replace("_", " ")})</span> : null}</span><span className="text-muted">v{a.version} · {a.status}</span></li>)}</ul>
            )}
            <p className="mt-2 text-xs text-muted">Company names are visible to Bluewater administrators only.</p>
          </Card>

          {t.kind === "sequence" && t.status !== "draft" && (
            <Card title="Results evidence">
              <p className="mb-3 text-xs text-muted">Counts real customers only (simulated messages, demo and test workspaces excluded). Shown to clients only if you publish it and it has at least {MIN_EVIDENCE.enrolled} people across {MIN_EVIDENCE.companies} businesses. Observed outcomes — not proof of cause.</p>
              <Op id={t.id} op="evidence" label="Compute last 90 days"><input type="hidden" name="days" value="90" /></Op>
              <ul className="mt-3 space-y-2 text-sm">
                {evidence.map((e) => (
                  <li key={e.id} className="rounded-xl border border-line p-3">
                    <p>{e.periodStart} → {e.periodEnd}: <b>{e.enrolled}</b> enrolled at {e.companies} business(es); replied {e.replied}, booked {e.booked}, opted out {e.optedOut}; delivered {e.delivered}/{e.messagesSent}.</p>
                    <div className="mt-2">{e.published
                      ? <Op id={t.id} op="hide_evidence" label="Hide from clients"><input type="hidden" name="evidenceId" value={e.id} /></Op>
                      : <Op id={t.id} op="publish_evidence" label="Show to clients"><input type="hidden" name="evidenceId" value={e.id} /></Op>}</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Versions">
            {versions.length === 0 ? <p className="text-sm text-muted">Not published yet.</p> : (
              <ul className="space-y-1 text-sm">{versions.map((v) => <li key={v.id}>v{v.version} · {v.publishedAt.toISOString().slice(0, 10)}{v.changelog ? ` · ${v.changelog}` : ""}</li>)}</ul>
            )}
            {live && <p className="mt-2 text-xs text-muted">Live version uses: {live.kind === "sequence" ? `${live.steps.length} steps` : "one message"}.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
