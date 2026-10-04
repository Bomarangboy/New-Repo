"use client";

import { useActionState } from "react";
import { ActionForm, Field, FormMessage, SubmitButton } from "@/components/forms";
import { disconnectBookingAction, saveBookingPageAction, setUpWebhookAction, type WebhookState } from "./booking-actions";

/** Shows the Cal.com webhook address + signing secret once, with the steps to paste them into Cal.com. */
export function WebhookSetup({ configured }: { configured: boolean }) {
  const [state, action] = useActionState<WebhookState, FormData>(setUpWebhookAction, null);
  if (state?.secret) {
    return (
      <div className="space-y-3 rounded-xl bg-amber-50 p-4 text-sm">
        <p className="font-semibold text-amber-900">Copy these into Cal.com now — they won&apos;t be shown again.</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>In Cal.com open <b>Settings → Developer → Webhooks → New</b>.</li>
          <li>Subscriber URL:<code className="mt-1 block break-all rounded-lg bg-white p-2 font-mono text-xs">{state.url}</code></li>
          <li>Secret:<code className="mt-1 block break-all rounded-lg bg-white p-2 font-mono text-xs">{state.secret}</code></li>
          <li>Event triggers: <b>Booking created</b>, <b>Booking rescheduled</b>, <b>Booking cancelled</b>. Leave the payload template empty.</li>
          <li>Press <b>Ping test</b>, then save. This page will show <b>Connected</b> once Bluewater receives the test.</li>
        </ol>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-2">
      <SubmitButton variant="secondary">{configured ? "Create a new webhook address (replaces the old one)" : "Set up automatic booking updates"}</SubmitButton>
      {state?.error && <FormMessage state={{ error: state.error }} />}
    </form>
  );
}

export function BookingPageForm({ url, canManage }: { url: string | null; canManage: boolean }) {
  return (
    <ActionForm action={saveBookingPageAction} className="space-y-3">
      <fieldset disabled={!canManage} className="space-y-3">
        <Field label="Booking page address" name="bookingUrl" type="url" defaultValue={url ?? ""} placeholder="https://cal.com/your-business/estimate"
          hint="The public Cal.com page where customers pick a time. Bluewater adds a personal reference to each link so the booking attaches to the right lead." />
        {canManage && <SubmitButton variant="secondary">Save booking page</SubmitButton>}
      </fieldset>
    </ActionForm>
  );
}

export function DisconnectBooking() {
  return (
    <ActionForm action={disconnectBookingAction} className="space-y-2">
      <SubmitButton variant="secondary">Disconnect</SubmitButton>
    </ActionForm>
  );
}
