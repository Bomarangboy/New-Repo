"use client";

import { useActionState, useMemo, useState } from "react";
import { FormMessage, SubmitButton, type FormState } from "@/components/forms";
import { fieldsFor, isSmsKey, SAMPLE_VARS, renderTemplate, smsSegments, TEMPLATE_FIELDS, validateTemplate, type TemplateKey, type ValidationKey } from "@/server/messaging/templates";
import { saveTemplateAction } from "./actions";

export const previewVars = (companyName: string) => ({
  first_name: "Jordan", full_name: "Jordan Lee", company_name: companyName, service: "roof repair",
  booking_link: SAMPLE_VARS.booking_link, appointment_time: "Tue, Oct 6 at 2:00 PM EDT",
});

/** Field list + live checks + preview, shared by stored templates and sequence steps. */
export function TemplateFields({ k, subject, body, onSubject, onBody, companyName, idPrefix, disabled }: {
  k: ValidationKey; subject: string; body: string; onSubject?: (v: string) => void; onBody: (v: string) => void; companyName: string; idPrefix: string; disabled?: boolean;
}) {
  const sms = isSmsKey(k);
  const check = useMemo(() => validateTemplate(k, body, sms ? null : subject), [k, body, subject, sms]);
  const sample = previewVars(companyName);
  const preview = renderTemplate(body, sample);
  const seg = sms ? smsSegments(preview) : null;
  return (
    <div className="space-y-3">
      <fieldset disabled={disabled} className="space-y-3">
        {!sms && (
          <div><label className="label" htmlFor={`${idPrefix}-subject`}>Subject</label><input id={`${idPrefix}-subject`} name="subject" className="input" value={subject} onChange={(e) => onSubject?.(e.target.value)} maxLength={200} /></div>
        )}
        <div>
          <label className="label" htmlFor={`${idPrefix}-body`}>{sms ? "Text message" : "Email message"}</label>
          <textarea id={`${idPrefix}-body`} name="body" rows={sms ? 4 : 7} className="input font-mono text-[13px]" value={body} onChange={(e) => onBody(e.target.value)} />
          <p className="mt-1 text-xs text-muted">Fields: {fieldsFor(k).map((f) => <code key={f} title={TEMPLATE_FIELDS[f]} className="mr-1.5 rounded bg-canvas px-1">{`{{${f}}}`}</code>)} · add a fallback like <code className="rounded bg-canvas px-1">{"{{first_name|there}}"}</code></p>
        </div>
      </fieldset>
      <div className="rounded-xl bg-canvas p-3 text-sm">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Preview (sample lead: Jordan, roof repair)</p>
        {!sms && <p className="font-semibold">{renderTemplate(subject, sample)}</p>}
        <p className="whitespace-pre-wrap break-words">{preview}</p>
        {!sms && <p className="mt-2 text-xs text-muted">An unsubscribe link is added automatically at the bottom.</p>}
        {seg && <p className="mt-2 text-xs text-muted">{seg.segments} text segment{seg.segments > 1 ? "s" : ""} ({seg.encoding}) with this sample. Longer names can add a segment.</p>}
      </div>
      {check.errors.length > 0 && <ul className="list-disc space-y-0.5 rounded-xl bg-red-50 py-2 pl-7 pr-3 text-sm text-red-700">{check.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {check.warnings.length > 0 && <ul className="list-disc space-y-0.5 rounded-xl bg-amber-50 py-2 pl-7 pr-3 text-sm text-amber-900">{check.warnings.map((e) => <li key={e}>{e}</li>)}</ul>}
    </div>
  );
}

export function TemplateEditor({ templateKey, subject, body, companyName, canEdit }: { templateKey: TemplateKey; subject: string | null; body: string; companyName: string; canEdit: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(saveTemplateAction, null);
  const [text, setText] = useState(body);
  const [subj, setSubj] = useState(subject ?? "");
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="key" value={templateKey} />
      <TemplateFields k={templateKey} subject={subj} body={text} onSubject={setSubj} onBody={setText} companyName={companyName} idPrefix={templateKey} disabled={!canEdit} />
      {canEdit && <div className="flex items-center gap-3"><SubmitButton variant="secondary">Save new version</SubmitButton><FormMessage state={state} /></div>}
    </form>
  );
}
