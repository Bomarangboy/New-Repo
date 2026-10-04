"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/forms";
import { saveEmailSenderAction, type WebhookState } from "../../actions";

const STATUSES = [["not_configured", "Not configured"], ["pending_verification", "Pending verification"], ["verified", "Verified (can send for real)"], ["disabled", "Disabled"]] as const;

export function EmailSenderForm({ companyId, current }: { companyId: string; current: { status?: string; fromEmail?: string | null; fromName?: string | null; replyTo?: string | null; hasPostmarkToken?: boolean; hasWebhookKey?: boolean; notes?: string | null } | null }) {
  const [state, action] = useActionState<WebhookState, FormData>(saveEmailSenderAction, null);
  return (
    <form action={action} className="space-y-3 text-sm">
      <input type="hidden" name="companyId" value={companyId} />
      <select name="status" defaultValue={current?.status ?? "not_configured"} className="input" aria-label="Email sender status">{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <input name="fromEmail" type="email" defaultValue={current?.fromEmail ?? ""} placeholder="From address (on the client's verified domain)" className="input" />
      <input name="fromName" defaultValue={current?.fromName ?? ""} placeholder="From name" className="input" />
      <input name="replyTo" type="email" defaultValue={current?.replyTo ?? ""} placeholder="Reply-to (optional)" className="input" />
      <input name="postmarkServerToken" type="password" autoComplete="off" placeholder={current?.hasPostmarkToken ? "Server token saved — leave blank to keep" : "Postmark server token"} className="input" />
      <label className="flex items-center gap-2"><input type="checkbox" name="rotateWebhook" className="accent-brand-500" /> {current?.hasWebhookKey ? "Replace the webhook address" : "Create the webhook address"}</label>
      <input name="notes" defaultValue={current?.notes ?? ""} placeholder="Notes (e.g. DNS verified on…)" className="input" />
      {state?.webhookUrl && (
        <div className="rounded-xl bg-amber-50 p-3"><p className="font-medium text-amber-900">Paste this into the client&apos;s Postmark server (inbound, delivery, bounce and spam-complaint webhooks). It won&apos;t be shown again.</p><code className="mt-1 block break-all font-mono text-xs">{state.webhookUrl}</code></div>
      )}
      <div className="flex items-center gap-3"><SubmitButton variant="secondary">Save email sender</SubmitButton><FormMessage state={state?.webhookUrl ? { ok: state.ok } : state} /></div>
    </form>
  );
}
