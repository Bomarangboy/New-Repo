"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionContext, requestId } from "@/lib/authz/guard";
import { userMessage } from "@/lib/user-message";
import type { FormState } from "@/components/forms";
import { createIntakeSource, removeSigningSecret, rotateSigningSecret, updateIntakeSource } from "@/server/intake/sources";

const origins = (fd: FormData) => String(fd.get("allowedOrigins") ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

export async function createSourceAction(_: FormState, fd: FormData): Promise<FormState> {
  let id = "";
  try {
    const ctx = await actionContext("integration.manage", "lead_sources");
    id = (await createIntakeSource(ctx, { name: String(fd.get("name") ?? ""), allowedOrigins: origins(fd) }, await requestId())).id;
  } catch (e) {
    return { error: userMessage(e) };
  }
  redirect(`/app/connected-accounts?created=${id}`);
}

export async function updateSourceAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await actionContext("integration.manage", "lead_sources");
    await updateIntakeSource(ctx, String(fd.get("sourceId")), { name: String(fd.get("name") ?? ""), allowedOrigins: origins(fd), active: fd.get("active") === "on" }, await requestId());
    revalidatePath("/app/connected-accounts");
    return { ok: "Saved." };
  } catch (e) {
    return { error: userMessage(e) };
  }
}

export type SecretState = { error?: string; ok?: string; secret?: string } | null;

export async function rotateSecretAction(_: SecretState, fd: FormData): Promise<SecretState> {
  try {
    const ctx = await actionContext("integration.manage", "lead_sources");
    const secret = await rotateSigningSecret(ctx, String(fd.get("sourceId")), await requestId());
    revalidatePath("/app/connected-accounts");
    return { ok: "New signing secret created. Copy it now — it won't be shown again.", secret };
  } catch (e) {
    return { error: userMessage(e) };
  }
}

export async function removeSecretAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await actionContext("integration.manage", "lead_sources");
    await removeSigningSecret(ctx, String(fd.get("sourceId")), await requestId());
    revalidatePath("/app/connected-accounts");
    return { ok: "Signing turned off. The form accepts unsigned submissions again." };
  } catch (e) {
    return { error: userMessage(e) };
  }
}
