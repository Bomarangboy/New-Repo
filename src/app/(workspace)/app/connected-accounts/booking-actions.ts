"use server";

import { revalidatePath } from "next/cache";
import { actionContext, requestId } from "@/lib/authz/guard";
import { userMessage } from "@/lib/user-message";
import type { FormState } from "@/components/forms";
import { disconnectBooking, saveBookingPage, setUpBookingWebhook } from "@/server/booking/settings";

export async function saveBookingPageAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await actionContext("integration.manage", "booking");
    const url = await saveBookingPage(ctx, String(fd.get("bookingUrl") ?? ""), await requestId());
    revalidatePath("/app/connected-accounts");
    return { ok: url ? "Saved. New messages will include personal booking links." : "Booking page removed. Messages will use the fallback wording." };
  } catch (e) {
    return { error: userMessage(e) };
  }
}

export type WebhookState = { error?: string; url?: string; secret?: string } | null;

/** Returns the address and secret exactly once (they're never shown again). */
export async function setUpWebhookAction(_: WebhookState, _fd: FormData): Promise<WebhookState> {
  try {
    const ctx = await actionContext("integration.manage", "booking");
    const r = await setUpBookingWebhook(ctx, await requestId());
    revalidatePath("/app/connected-accounts");
    return r;
  } catch (e) {
    return { error: userMessage(e) };
  }
}

export async function disconnectBookingAction(_: FormState, _fd: FormData): Promise<FormState> {
  try {
    const ctx = await actionContext("integration.manage", "booking");
    await disconnectBooking(ctx, await requestId());
    revalidatePath("/app/connected-accounts");
    return { ok: "Disconnected. Delete the webhook in Cal.com too (Settings → Developer → Webhooks)." };
  } catch (e) {
    return { error: userMessage(e) };
  }
}
