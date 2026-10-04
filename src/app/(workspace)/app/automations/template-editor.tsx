"use client";

import { useActionState, useMemo, useState } from "react";
import { FormMessage, SubmitButton, type FormState } from "@/components/forms";
import { renderTemplate, smsSegments, TEMPLATE_FIELDS, validateTemplate, type TemplateKey } from "@/server/messaging/templates";
import { saveTemplateAction } from "./actions";

export function TemplateEditor({ templateKey, subject, body, companyName, canEdit }: { templateKey: TemplateKey; subject: string | null; body: string; companyName: string; canEdit: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(saveTemplateAction, null);
  const [text, setText] = useState(body);
  const [subj, setSubj] = useState(subject ?? "");
  const sample = { first_name: "Jordan", full_name: "Jordan Lee", company_name: companyName, service: "roof repair" };
  const check = useMemo(() => validateTemplate(templateKey, text, templateKey === "ack_email" ? subj : null), [templateKey, text, subj]);
  const preview = renderTemplate(text, sample);
  const seg = templateKey === "ack_sms" ? smsSegments(preview) : null;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="key" value={templateKey} />
      <fieldset disabled={!canEdit} className="space-y-3">
        {templateKey === "ack_email" && (
          <div><label className="label" htmlFor={`${templateKey}-subject`}>Subject</label><input id={`${templateKey}-subject`} name="subject" className="input" value={subj} onChange={(e) => setSubj(e.target.value)} maxLength={200} /></div>
        )}
        <div>
          <label className="label" htmlFor={`${templateKey}-body`}>Message</label>
          <textarea id={`${templateKey}-body`} name="body" rows={templateKey === "ack_sms" ? 4 : 8} className="input font-mono text-[13px]" value={text} onChange={(e) => setText(e.target.value)} />
          <p className="mt-1 text-xs text-muted">Fields: {Object.entries(TEMPLATE_FIELDS).map(([k, v]) => <code key={k} title={v} className="mr-1.5 rounded bg-canvas px-1">{`{{${k}}}`}</code>)} · add a fallback like <code className="rounded bg-canvas px-1">{"{{first_name|there}}"}</code></p>
        </div>
      </fieldset>
      <div className="rounded-xl bg-canvas p-3 text-sm">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Preview (sample lead: Jordan, roof repair)</p>
        {templateKey === "ack_email" && <p className="font-semibold">{renderTemplate(subj, sample)}</p>}
        <p className="whitespace-pre-wrap">{preview}</p>
        {templateKey === "ack_email" && <p className="mt-2 text-xs text-muted">An unsubscribe link is added automatically at the bottom.</p>}
        {seg && <p className="mt-2 text-xs text-muted">{seg.segments} text segment{seg.segments > 1 ? "s" : ""} ({seg.encoding}) with this sample. Longer names can add a segment.</p>}
      </div>
      {check.errors.length > 0 && <ul className="list-disc space-y-0.5 rounded-xl bg-red-50 py-2 pl-7 pr-3 text-sm text-red-700">{check.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {check.warnings.length > 0 && <ul className="list-disc space-y-0.5 rounded-xl bg-amber-50 py-2 pl-7 pr-3 text-sm text-amber-900">{check.warnings.map((e) => <li key={e}>{e}</li>)}</ul>}
      {canEdit && <div className="flex items-center gap-3"><SubmitButton variant="secondary">Save new version</SubmitButton><FormMessage state={state} /></div>}
    </form>
  );
}
