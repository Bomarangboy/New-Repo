"use server";

import { revalidatePath } from "next/cache";
import { actionContext, requestId } from "@/lib/authz/guard";
import { userMessage } from "@/lib/user-message";
import type { FormState } from "@/components/forms";
import { saveTemplate, setEmergencyPause, updateAutomationSettings } from "@/server/messaging/settings";

const minutes = (v: FormDataEntryValue | null) => {
  const [h, m] = String(v ?? "").split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export async function saveSettingsAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await actionContext("template.manage", "acknowledgment");
    const end = String(fd.get("windowEnd") ?? "") === "24:00" ? 1440 : minutes(fd.get("windowEnd"));
    await updateAutomationSettings(ctx, {
      ackEnabled: fd.get("ackEnabled") === "on",
      windowStartMinute: minutes(fd.get("windowStart")), windowEndMinute: end,
      windowDays: fd.getAll("days").map(Number),
      notifyUserIds: fd.getAll("notify").map(String),
    }, await requestId());
    revalidatePath("/app/automations");
    return { ok: "Saved. Changes apply to messages not yet sent." };
  } catch (e) {
    return { error: userMessage(e) };
  }
}

export async function saveTemplateAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await actionContext("template.manage", "acknowledgment");
    const key = fd.get("key") === "ack_email" ? "ack_email" : "ack_sms";
    const v = await saveTemplate(ctx, key, { subject: String(fd.get("subject") ?? ""), body: String(fd.get("body") ?? "") }, await requestId());
    revalidatePath("/app/automations");
    return { ok: `Saved as version ${v}. Messages already sent keep the wording they were sent with.` };
  } catch (e) {
    return { error: userMessage(e) };
  }
}

export async function pauseAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await actionContext("automation.emergency_pause");
    const paused = fd.get("paused") === "1";
    await setEmergencyPause(ctx, paused, String(fd.get("reason") ?? ""), await requestId());
    revalidatePath("/app", "layout");
    return { ok: paused ? "All automatic messages are stopped. Pending ones were cancelled and won't be sent later." : "Automatic messages are back on for new leads." };
  } catch (e) {
    return { error: userMessage(e) };
  }
}
