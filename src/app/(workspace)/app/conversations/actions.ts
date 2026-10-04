"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { actionContext, requestId } from "@/lib/authz/guard";
import { userMessage } from "@/lib/user-message";
import type { FormState } from "@/components/forms";
import { conversationForInquiry, liftOptOut, markConversationRead, recordOptOut, sendManualMessage, simulateIncomingReply } from "@/server/messaging/inbox";
import { runDueJobs } from "@/server/jobs/runner";

const channelOf = (fd: FormData) => (fd.get("channel") === "sms" ? "sms" : "email") as "sms" | "email";

export async function sendReplyAction(_: FormState, fd: FormData): Promise<FormState> {
  const conversationId = String(fd.get("conversationId") ?? "");
  try {
    const ctx = await actionContext("message.send_manual", "inbox");
    const status = await sendManualMessage(ctx, { conversationId, channel: channelOf(fd), subject: String(fd.get("subject") ?? ""), body: String(fd.get("body") ?? ""), clientKey: String(fd.get("clientKey") ?? "") });
    revalidatePath(`/app/conversations/${conversationId}`);
    return status === "failed" ? { error: "The message couldn't be delivered. See the details in the conversation." }
      : status === "unknown" ? { error: "We couldn't confirm the message was sent. Bluewater will check; please don't resend yet." }
      : { ok: "Sent." };
  } catch (e) {
    return { error: userMessage(e) };
  }
}

export async function markReadAction(fd: FormData): Promise<void> {
  const ctx = await actionContext("conversation.view", "inbox");
  await markConversationRead(ctx, String(fd.get("conversationId")));
  revalidatePath("/app/conversations", "layout");
}

export async function optOutAction(_: FormState, fd: FormData): Promise<FormState> {
  const conversationId = String(fd.get("conversationId") ?? "");
  try {
    const ctx = await actionContext("contact.opt_out", "inbox");
    await recordOptOut(ctx, conversationId, channelOf(fd), String(fd.get("detail") ?? ""), await requestId());
    revalidatePath(`/app/conversations/${conversationId}`);
    return { ok: "Opt-out recorded. Nobody can message this person on that channel now." };
  } catch (e) {
    return { error: userMessage(e) };
  }
}

export async function liftOptOutAction(_: FormState, fd: FormData): Promise<FormState> {
  const conversationId = String(fd.get("conversationId") ?? "");
  try {
    const ctx = await actionContext("settings.manage", "inbox");
    await liftOptOut(ctx, String(fd.get("suppressionId") ?? ""), String(fd.get("reason") ?? ""), await requestId());
    revalidatePath(`/app/conversations/${conversationId}`);
    return { ok: "Opt-out removed and recorded in the activity log." };
  } catch (e) {
    return { error: userMessage(e) };
  }
}

export async function simulateReplyAction(_: FormState, fd: FormData): Promise<FormState> {
  const conversationId = String(fd.get("conversationId") ?? "");
  try {
    const ctx = await actionContext("conversation.view", "inbox");
    await simulateIncomingReply(ctx, conversationId, channelOf(fd), String(fd.get("body") ?? ""));
    after(() => runDueJobs({ limit: 10, timeBudgetMs: 5000 }).catch(() => {}));
    revalidatePath(`/app/conversations/${conversationId}`);
    return { ok: "Simulated reply added." };
  } catch (e) {
    return { error: userMessage(e) };
  }
}

export async function openConversationForLeadAction(fd: FormData): Promise<void> {
  const ctx = await actionContext("conversation.view", "inbox");
  const id = await conversationForInquiry(ctx, String(fd.get("inquiryId") ?? ""));
  redirect(id ? `/app/conversations/${id}` : "/app/conversations");
}
