"use client";

import { useActionState, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { FormMessage, SubmitButton, type FormState } from "@/components/forms";
import { TemplateFields } from "../../template-editor";
import { saveSequenceAction } from "../../sequence-actions";

type Channel = "sms" | "email" | "sms_or_email";
export interface EditorStep { delayMinutes: number; channel: Channel; smsBody: string; emailSubject: string; emailBody: string }

const CHANNELS: { value: Channel; label: string }[] = [
  { value: "sms_or_email", label: "Text if they allowed texts, otherwise email" },
  { value: "sms", label: "Text only (skipped without text permission)" },
  { value: "email", label: "Email only" },
];

function splitDelay(min: number) { return { days: Math.floor(min / 1440), hours: Math.floor((min % 1440) / 60) }; }

/** Steps are edited locally and saved together; saving with changed steps creates a new version. */
export function SequenceEditor({ sequenceId, name, stopOnManualMessage, handoffTask, steps: initial, companyName, canEdit }: {
  sequenceId: string; name: string; stopOnManualMessage: boolean; handoffTask: boolean; steps: EditorStep[]; companyName: string; canEdit: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(saveSequenceAction, null);
  const [steps, setSteps] = useState<EditorStep[]>(initial);
  const update = (i: number, patch: Partial<EditorStep>) => setSteps((s) => s.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) => setSteps((s) => { const c = [...s]; const [x] = c.splice(i, 1); c.splice(i + d, 0, x!); return c; });
  const remove = (i: number) => setSteps((s) => s.filter((_, k) => k !== i));
  const add = () => setSteps((s) => [...s, { delayMinutes: 2 * 1440, channel: "sms_or_email", smsBody: "Hi {{first_name|there}}, {{company_name}} here — still happy to help with {{service|your project}}. Reply STOP to opt out.", emailSubject: "Checking in — {{company_name}}", emailBody: "Hi {{first_name|there}},\n\nJust checking in about {{service|your project}}.\n\n{{company_name}}" }]);
  const payload = JSON.stringify(steps.map((s) => ({ delayMinutes: s.delayMinutes, channel: s.channel, smsBody: s.smsBody, emailSubject: s.emailSubject, emailBody: s.emailBody })));
  const cumulative = steps.reduce<number[]>((acc, s) => [...acc, (acc.at(-1) ?? 0) + s.delayMinutes], []);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="sequenceId" value={sequenceId} />
      <input type="hidden" name="steps" value={payload} />
      <fieldset disabled={!canEdit} className="space-y-4">
        <div><label className="label" htmlFor="seq-name">Name</label><input id="seq-name" name="name" defaultValue={name} className="input" maxLength={80} required /></div>
        <div className="space-y-2 text-sm">
          <p className="label">Stop rules</p>
          <p className="text-muted">Always stops when the person replies, books, opts out, or the lead is marked Booked, Won or Lost — and if the account is paused or the emergency stop is used.</p>
          <label className="flex items-center gap-2"><input type="checkbox" name="stopOnManualMessage" defaultChecked={stopOnManualMessage} className="size-4 accent-brand-500" /> Also stop when someone on the team messages them from Bluewater</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="handoffTask" defaultChecked={handoffTask} className="size-4 accent-brand-500" /> When the last step goes out with no reply, create a call-back task for the assigned person</label>
        </div>
      </fieldset>

      <ol className="space-y-4">
        {steps.map((s, i) => {
          const d = splitDelay(s.delayMinutes);
          const t = splitDelay(cumulative[i]!);
          return (
            <li key={i} className="rounded-2xl border border-line p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">Step {i + 1}</h3>
                <span className="text-xs text-muted">≈ {t.days} day{t.days === 1 ? "" : "s"}{t.hours ? ` ${t.hours} h` : ""} after the lead starts</span>
                {canEdit && (
                  <span className="ml-auto flex gap-1">
                    <button type="button" className="btn-secondary px-2 py-1" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move step ${i + 1} up`}><ArrowUp className="size-4" /></button>
                    <button type="button" className="btn-secondary px-2 py-1" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label={`Move step ${i + 1} down`}><ArrowDown className="size-4" /></button>
                    <button type="button" className="btn-secondary px-2 py-1 text-red-700" onClick={() => remove(i)} disabled={steps.length === 1} aria-label={`Remove step ${i + 1}`}><Trash2 className="size-4" /></button>
                  </span>
                )}
              </div>
              <fieldset disabled={!canEdit} className="mb-4 grid gap-3 sm:grid-cols-[auto_auto_1fr]">
                <div><label className="label" htmlFor={`d-${i}`}>Wait (days)</label><input id={`d-${i}`} type="number" min={0} max={30} className="input w-24" value={d.days} onChange={(e) => update(i, { delayMinutes: Math.max(0, Number(e.target.value)) * 1440 + d.hours * 60 })} /></div>
                <div><label className="label" htmlFor={`h-${i}`}>+ hours</label><input id={`h-${i}`} type="number" min={0} max={23} className="input w-24" value={d.hours} onChange={(e) => update(i, { delayMinutes: d.days * 1440 + Math.min(23, Math.max(0, Number(e.target.value))) * 60 })} /></div>
                <div><label className="label" htmlFor={`c-${i}`}>Send by</label><select id={`c-${i}`} className="input" value={s.channel} onChange={(e) => update(i, { channel: e.target.value as Channel })}>{CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
              </fieldset>
              <p className="-mt-2 mb-3 text-xs text-muted">{i === 0 ? "Counted from when the lead starts the sequence." : "Counted from the previous step."} Messages only go out inside your sending hours.</p>
              <div className={`grid gap-4 ${s.channel === "sms_or_email" ? "xl:grid-cols-2" : ""}`}>
                {s.channel !== "email" && <TemplateFields k="followup_sms" subject="" body={s.smsBody} onBody={(v) => update(i, { smsBody: v })} companyName={companyName} idPrefix={`s${i}-sms`} disabled={!canEdit} />}
                {s.channel !== "sms" && <TemplateFields k="followup_email" subject={s.emailSubject} body={s.emailBody} onSubject={(v) => update(i, { emailSubject: v })} onBody={(v) => update(i, { emailBody: v })} companyName={companyName} idPrefix={`s${i}-email`} disabled={!canEdit} />}
              </div>
            </li>
          );
        })}
      </ol>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          {steps.length < 8 && <button type="button" className="btn-secondary" onClick={add}><Plus className="size-4" /> Add step</button>}
          <SubmitButton>Save sequence</SubmitButton>
          <FormMessage state={state} />
        </div>
      )}
    </form>
  );
}
