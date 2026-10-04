"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton, type FormState } from "@/components/forms";
import { sendReplyAction } from "../actions";

/** Reply box. A fresh random key per send makes double-clicks harmless (one message). */
export function Composer({ conversationId, canSms, canEmail, smsNote }: { conversationId: string; canSms: boolean; canEmail: boolean; smsNote: string | null }) {
  const [state, action] = useActionState<FormState, FormData>(sendReplyAction, null);
  const [channel, setChannel] = useState<"sms" | "email">(canSms ? "sms" : "email");
  // One key per message: retries/double-clicks of the same message reuse it; it changes after a successful send.
  const [base] = useState(() => crypto.randomUUID());
  const [sent, setSent] = useState(0);
  const [seen, setSeen] = useState<FormState>(null);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setSent((n) => n + 1);
  }
  const key = `${base}-${sent}`;
  if (!canSms && !canEmail) return <p className="text-sm text-muted">This contact can&apos;t be messaged: no reachable phone or email, or they opted out.</p>;
  return (
    <form key={sent} action={action} className="space-y-3">
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="clientKey" value={key} />
      <div className="flex gap-2" role="radiogroup" aria-label="Send as">
        {(["sms", "email"] as const).map((c) => (
          <label key={c} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${channel === c ? "border-brand-500 bg-brand-50 font-medium" : "border-line"} ${(c === "sms" ? canSms : canEmail) ? "" : "cursor-not-allowed opacity-50"}`}>
            <input type="radio" name="channel" value={c} checked={channel === c} disabled={!(c === "sms" ? canSms : canEmail)} onChange={() => setChannel(c)} className="accent-brand-500" />
            {c === "sms" ? "Text" : "Email"}
          </label>
        ))}
      </div>
      {!canSms && smsNote && <p className="text-xs text-muted">{smsNote}</p>}
      {channel === "email" && <input name="subject" placeholder="Subject" className="input" maxLength={200} />}
      <label htmlFor="reply" className="sr-only">Message</label>
      <textarea id="reply" name="body" rows={3} required className="input" placeholder={channel === "sms" ? "Write a text…" : "Write an email…"} maxLength={channel === "sms" ? 1600 : 10000} />
      <div className="flex items-center gap-3"><SubmitButton>Send</SubmitButton><FormMessage state={state} /></div>
    </form>
  );
}
