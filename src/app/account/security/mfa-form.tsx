"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/forms";
import { mfaEnrollAction, type MfaState } from "../actions";

export function MfaEnrollForm({ enrolled }: { enrolled: boolean }) {
  const [state, action] = useActionState<MfaState, FormData>(mfaEnrollAction, null);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="space-y-4">
      {!state?.factorId ? (
        <>
          <p className="text-sm text-muted">
            {enrolled ? "Two-step verification is on. You can move it to a new phone by setting it up again; the old code keeps working until the new one is confirmed."
              : "Add a second step at sign-in using a free authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy)."}
          </p>
          <SubmitButton variant={enrolled ? "secondary" : "primary"}>{enrolled ? "Set up on a new device" : "Turn on two-step verification"}</SubmitButton>
        </>
      ) : (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>Open your authenticator app and scan this code.</li>
            <li>Enter the 6-digit code it shows.</li>
          </ol>
          {/* QR is generated on our server from a value we created; it contains no user-supplied markup. */}
          <div className="w-48 rounded-xl border border-line p-2" dangerouslySetInnerHTML={{ __html: state.qrSvg ?? "" }} />
          <details className="text-xs text-muted"><summary className="cursor-pointer">Can&apos;t scan? Enter this key instead</summary><code className="mt-1 block break-all font-mono">{state.secret}</code></details>
          <div>
            <label htmlFor="code" className="label">6-digit code</label>
            <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} className="input max-w-40" required autoFocus />
          </div>
          <SubmitButton>Confirm</SubmitButton>
          <FormMessage state={state} />
        </>
      )}
    </form>
  );
}
