"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actionContext, requestId } from "@/lib/authz/guard";
import { userMessage } from "@/lib/user-message";
import type { FormState } from "@/components/forms";
import { activateCopy, applyUpdate, archiveCopy, confirmSetup, copyTemplate, saveAckDraft } from "@/server/library/customer";

async function run(fn: () => Promise<string>): Promise<FormState> {
  try {
    return { ok: await fn() };
  } catch (e) {
    return { error: userMessage(e) };
  }
}

/** Copy = a private draft in this workspace. Nothing is sent and nobody is enrolled. */
export async function copyTemplateAction(_: FormState, fd: FormData): Promise<FormState> {
  let id = "";
  const res = await run(async () => {
    const ctx = await actionContext("library.adopt");
    id = (await copyTemplate(ctx, String(fd.get("templateId") ?? ""), await requestId())).copyId;
    return "Copied";
  });
  if (res?.error) return res;
  redirect(`/app/library/copies/${id}?copied=1`);
}

export async function confirmSetupAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("library.adopt");
    const id = String(fd.get("copyId") ?? "");
    await confirmSetup(ctx, id, fd.getAll("confirm").map(String), await requestId());
    revalidatePath(`/app/library/copies/${id}`);
    return "Checklist saved.";
  });
}

export async function saveAckDraftAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("library.adopt");
    const id = String(fd.get("copyId") ?? "");
    await saveAckDraft(ctx, id, { smsBody: String(fd.get("smsBody") ?? ""), emailSubject: String(fd.get("emailSubject") ?? ""), emailBody: String(fd.get("emailBody") ?? "") }, await requestId());
    revalidatePath(`/app/library/copies/${id}`);
    return "Draft wording saved. It isn't in use until you activate it.";
  });
}

export async function activateAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("copyId") ?? "");
  const auto = fd.get("autoEnroll") === "on";
  const res = await run(async () => {
    const ctx = await actionContext("library.adopt");
    await activateCopy(ctx, id, { autoEnroll: auto }, await requestId());
    return "ok";
  });
  if (res?.error) return res;
  revalidatePath(`/app/library/copies/${id}`);
  redirect(`/app/library/copies/${id}?activated=${fd.get("kind") === "sequence" ? (auto ? "auto" : "manual") : "ack"}`);
}

export async function updateAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("library.adopt");
    const id = String(fd.get("copyId") ?? "");
    const mode = String(fd.get("mode")) as "merge" | "replace" | "dismiss";
    await applyUpdate(ctx, id, ["merge", "replace", "dismiss"].includes(mode) ? mode : "dismiss", await requestId());
    revalidatePath(`/app/library/copies/${id}`);
    return mode === "dismiss" ? "Kept your version." : "Update applied to your copy. People already in the follow-up finish the version they started.";
  });
}

export async function archiveCopyAction(_: FormState, fd: FormData): Promise<FormState> {
  let ok = false;
  const res = await run(async () => {
    const ctx = await actionContext("library.adopt");
    await archiveCopy(ctx, String(fd.get("copyId") ?? ""), await requestId());
    ok = true;
    return "Removed";
  });
  if (!ok) return res;
  redirect("/app/library");
}
