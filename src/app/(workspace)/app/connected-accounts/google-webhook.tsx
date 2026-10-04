"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/forms";
import { googleWebhookAction, type GoogleHookState } from "./ads-actions";

/** Shows the Google lead-form webhook address and key exactly once, with where to paste them. */
export function GoogleWebhookSetup({ configured }: { configured: boolean }) {
  const [state, action] = useActionState<GoogleHookState, FormData>(googleWebhookAction, null);
  if (state?.key) {
    return (
      <div className="space-y-3 rounded-xl bg-amber-50 p-4 text-sm">
        <p className="font-semibold text-amber-900">Copy these into Google Ads now — they won&apos;t be shown again.</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>In Google Ads, edit the lead form and open its <b>webhook integration</b> setting (Google&apos;s guide: “How to set up a webhook integration for a lead form”).</li>
          <li>Webhook URL:<code className="mt-1 block break-all rounded-lg bg-white p-2 font-mono text-xs">{state.url}</code></li>
          <li>Key:<code className="mt-1 block break-all rounded-lg bg-white p-2 font-mono text-xs">{state.key}</code></li>
          <li>Press <b>Send test data</b>. This page will show <b>Test received</b>. Then save the form.</li>
        </ol>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-2">
      <SubmitButton variant="secondary">{configured ? "Create a new webhook address (replaces the old one)" : "Set up Google lead-form webhook"}</SubmitButton>
      {state?.error && <FormMessage state={{ error: state.error }} />}
    </form>
  );
}
