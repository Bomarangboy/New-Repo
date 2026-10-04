"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/forms";
import { rotateSecretAction, type SecretState } from "./actions";

/** Shows a newly created signing secret exactly once. */
export function SecretForm({ sourceId, hasSecret }: { sourceId: string; hasSecret: boolean }) {
  const [state, action] = useActionState<SecretState, FormData>(rotateSecretAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="sourceId" value={sourceId} />
      {state?.secret ? (
        <div className="rounded-xl bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">Copy this secret into your website&apos;s server settings now. It won&apos;t be shown again.</p>
          <code className="mt-2 block break-all rounded-lg bg-white p-2 font-mono text-xs">{state.secret}</code>
        </div>
      ) : (
        <SubmitButton variant="secondary">{hasSecret ? "Replace signing secret" : "Require signed submissions"}</SubmitButton>
      )}
      <FormMessage state={state?.secret ? null : state} />
    </form>
  );
}
