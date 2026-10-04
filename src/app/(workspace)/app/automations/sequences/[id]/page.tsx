import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card } from "@/components/ui";
import { pageContext } from "@/lib/authz/guard";
import { roleCan } from "@/lib/authz/permissions";
import { isSimulatedEnvironment } from "@/lib/env";
import { getSequence } from "@/server/sequences/manage";
import { setSequenceStateAction } from "../../sequence-actions";
import { SequenceEditor, type EditorStep } from "./sequence-editor";

export const metadata = { title: "Follow-up sequence" };

export default async function SequencePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await pageContext("sequence.view", "sequences");
  const { id } = await params;
  const { created } = await searchParams;
  const data = await getSequence(ctx, id);
  if (!data) notFound();
  const { sequence: s, steps, openEnrollments, onOlderVersion } = data;
  const canEdit = roleCan(ctx.role, "sequence.manage") && ctx.policy.login === "full";
  const simulated = isSimulatedEnvironment() || ctx.companyKind !== "customer";
  const editorSteps: EditorStep[] = steps.map((x) => ({ delayMinutes: x.delayMinutes, channel: x.channel as EditorStep["channel"], smsBody: x.smsBody ?? "", emailSubject: x.emailSubject ?? "", emailBody: x.emailBody ?? "" }));

  return (
    <>
      <Link href="/app/automations" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> Automations</Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{s.name}</h1>
        {s.status === "active" ? <Badge tone="green" dot>On</Badge> : <Badge dot>Off</Badge>}
        {s.status === "active" && s.autoEnroll && <Badge tone="blue">Starts automatically for new website leads</Badge>}
        <Badge>Version {s.currentVersion}</Badge>
      </div>
      {created && <p role="status" className="mb-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Sequence created with suggested wording. It&apos;s off until you turn it on — review the steps first.</p>}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <Card title="Steps">
          <SequenceEditor sequenceId={s.id} name={s.name} stopOnManualMessage={s.stopOnManualMessage} handoffTask={s.handoffTask} steps={editorSteps} companyName={ctx.companyName} canEdit={canEdit} />
        </Card>
        <div className="space-y-6">
          <Card title="On / off">
            <p className="mb-3 text-sm text-muted">{openEnrollments === 0 ? "Nobody is in this sequence right now." : `${openEnrollments} ${openEnrollments === 1 ? "person is" : "people are"} in this sequence now${onOlderVersion ? ` (${onOlderVersion} on an earlier version)` : ""}.`}</p>
            <ActionForm action={setSequenceStateAction} className="space-y-3">
              <fieldset disabled={!canEdit} className="space-y-3">
                <input type="hidden" name="sequenceId" value={s.id} />
                {s.status === "active" ? (
                  <>
                    <input type="hidden" name="on" value="1" />
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="autoEnroll" defaultChecked={s.autoEnroll} className="size-4 accent-brand-500" /> Start automatically for every new website lead</label>
                    {canEdit && <SubmitButton variant="secondary">Save</SubmitButton>}
                  </>
                ) : (
                  <>
                    <input type="hidden" name="on" value="1" />
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="autoEnroll" defaultChecked className="size-4 accent-brand-500" /> Start automatically for every new website lead</label>
                    {canEdit && <SubmitButton>Turn on</SubmitButton>}
                  </>
                )}
              </fieldset>
            </ActionForm>
            {s.status === "active" && canEdit && (
              <ActionForm action={setSequenceStateAction} className="mt-4 space-y-2 border-t border-line pt-4">
                <input type="hidden" name="sequenceId" value={s.id} />
                <input type="hidden" name="on" value="0" />
                <p className="text-xs text-muted">Turning it off stops everyone currently in it. Turning it back on later does not restart them.</p>
                <SubmitButton variant="danger">Turn off</SubmitButton>
              </ActionForm>
            )}
          </Card>
          <Card title="How it works">
            <ul className="list-disc space-y-1.5 pl-4 text-sm text-muted">
              <li>Each step is checked again right before it goes out; if the person replied, booked or opted out, nothing is sent.</li>
              <li>Texts need recorded text permission; a step that can&apos;t be sent is skipped, not sent another way.</li>
              <li>Editing saves a new version. People already in the sequence finish the version they started.</li>
              {simulated && <li>Messages are simulated here: nothing reaches a real phone or inbox.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
