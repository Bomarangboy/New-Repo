"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminActionContext, COMPANY_COOKIE, requestId } from "@/lib/authz/guard";
import { env } from "@/lib/env";
import { userMessage } from "@/lib/user-message";
import { PACKAGES, type PackageTier } from "@/lib/authz/entitlements";
import type { LifecycleStatus } from "@/lib/authz/account-policy";
import { changeLifecycle, changePackage, createCompany, endSupportAccess, LIFECYCLE, scheduleCancellation, setSuspended, startSupportAccess, withdrawCancellation } from "@/server/companies";
import { inviteOwner } from "@/server/invitations";
import type { FormState } from "@/components/forms";
import { saveEmailSender, saveSmsSender, SENDER_STATUSES } from "@/server/senders";
import { cancelJob, retryJobNow } from "@/server/jobs/queue";
import { resolveUnknownMessage } from "@/server/health";

async function run(fn: () => Promise<string>): Promise<FormState> {
  try {
    return { ok: await fn() };
  } catch (e) {
    return { error: userMessage(e) };
  }
}

export async function createCompanyAction(_: FormState, fd: FormData): Promise<FormState> {
  let id = "";
  const res = await run(async () => {
    const ctx = await adminActionContext();
    const c = await createCompany(ctx, {
      name: String(fd.get("name") ?? ""), timezone: String(fd.get("timezone") ?? ""),
      package: String(fd.get("package") ?? "") as PackageTier, kind: fd.get("kind") === "internal_test" ? "internal_test" : "customer",
    }, await requestId());
    id = c.id;
    return "Created";
  });
  if (res?.error) return res;
  redirect(`/admin/companies/${id}?created=1`);
}

export async function changePackageAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const to = String(fd.get("package")) as PackageTier;
    if (!PACKAGES.includes(to)) throw new Error("Unknown package");
    const id = String(fd.get("companyId"));
    await changePackage(ctx, id, to, String(fd.get("note") ?? ""), await requestId());
    revalidatePath(`/admin/companies/${id}`);
    return "Package updated. The change applies immediately and is recorded in the history.";
  });
}

export async function changeLifecycleAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const to = String(fd.get("status")) as LifecycleStatus;
    if (!LIFECYCLE.includes(to)) throw new Error("Unknown status");
    const id = String(fd.get("companyId"));
    const endsRaw = String(fd.get("serviceEndsAt") ?? "");
    await changeLifecycle(ctx, id, to, { reason: String(fd.get("reason") ?? "").trim() || undefined, serviceEndsAt: endsRaw ? new Date(endsRaw) : null }, await requestId());
    revalidatePath(`/admin/companies/${id}`);
    return `Status changed to ${to}.`;
  });
}

export async function suspendAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const id = String(fd.get("companyId"));
    const suspend = fd.get("suspend") === "1";
    await setSuspended(ctx, id, suspend, String(fd.get("reason") ?? ""), await requestId());
    revalidatePath(`/admin/companies/${id}`);
    return suspend ? "Account suspended: read-only, no sending, no sync. Incoming leads are still stored." : "Suspension lifted.";
  });
}

export async function inviteOwnerAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const id = String(fd.get("companyId"));
    await inviteOwner(ctx, id, String(fd.get("email") ?? ""), env().APP_BASE_URL, await requestId());
    revalidatePath(`/admin/companies/${id}`);
    return "Owner invitation sent. The link works once and expires in 7 days.";
  });
}

export async function startSupportAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("companyId"));
  const res = await run(async () => {
    const ctx = await adminActionContext();
    await startSupportAccess(ctx, id, { reason: String(fd.get("reason") ?? ""), readOnly: fd.get("mode") !== "edit", minutes: Number(fd.get("minutes") ?? 30) }, await requestId());
    return "ok";
  });
  if (res?.error) return res;
  (await cookies()).set(COMPANY_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 });
  redirect("/app");
}

export async function endSupportAction(fd: FormData): Promise<void> {
  const ctx = await adminActionContext();
  const id = String(fd.get("companyId"));
  await endSupportAccess(ctx, id, await requestId());
  (await cookies()).delete(COMPANY_COOKIE);
  redirect(`/admin/companies/${id}`);
}

export async function scheduleCancellationAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const id = String(fd.get("companyId"));
    const raw = String(fd.get("effectiveDate") ?? "");
    await scheduleCancellation(ctx, id, { effectiveDate: new Date(`${raw}T23:59:59Z`), reason: String(fd.get("reason") ?? "") }, await requestId());
    revalidatePath(`/admin/companies/${id}`);
    return "Cancellation scheduled. Service continues until the end date, then the account becomes Churned (records are kept).";
  });
}

export async function withdrawCancellationAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const id = String(fd.get("companyId"));
    await withdrawCancellation(ctx, id, await requestId());
    revalidatePath(`/admin/companies/${id}`);
    return "Cancellation withdrawn.";
  });
}

export async function saveSmsSenderAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const id = String(fd.get("companyId"));
    await saveSmsSender(ctx, id, {
      status: String(fd.get("status")) as (typeof SENDER_STATUSES)[number], twilioAccountSid: String(fd.get("twilioAccountSid") ?? ""),
      twilioAuthToken: String(fd.get("twilioAuthToken") ?? "") || undefined, messagingServiceSid: String(fd.get("messagingServiceSid") ?? ""),
      fromNumber: String(fd.get("fromNumber") ?? ""), notes: String(fd.get("notes") ?? ""),
    }, await requestId());
    revalidatePath(`/admin/companies/${id}`);
    return "Text sender saved.";
  });
}

export type WebhookState = { error?: string; ok?: string; webhookUrl?: string } | null;

export async function saveEmailSenderAction(_: WebhookState, fd: FormData): Promise<WebhookState> {
  try {
    const ctx = await adminActionContext();
    const id = String(fd.get("companyId"));
    const url = await saveEmailSender(ctx, id, {
      status: String(fd.get("status")) as (typeof SENDER_STATUSES)[number], postmarkServerToken: String(fd.get("postmarkServerToken") ?? "") || undefined,
      fromEmail: String(fd.get("fromEmail") ?? ""), fromName: String(fd.get("fromName") ?? ""), replyTo: String(fd.get("replyTo") ?? ""),
      notes: String(fd.get("notes") ?? ""), rotateWebhook: fd.get("rotateWebhook") === "on",
    }, await requestId());
    revalidatePath(`/admin/companies/${id}`);
    return { ok: "Email sender saved.", webhookUrl: url ?? undefined };
  } catch (e) {
    return { error: userMessage(e) };
  }
}

export async function retryJobAction(fd: FormData): Promise<void> {
  const ctx = await adminActionContext();
  const ok = await retryJobNow(String(fd.get("jobId")));
  if (ok) await logAdmin(ctx, "jobs.retried", String(fd.get("jobId")));
  revalidatePath("/admin/health");
}

export async function cancelJobAction(fd: FormData): Promise<void> {
  const ctx = await adminActionContext();
  const ok = await cancelJob(String(fd.get("jobId")), "Cancelled by Bluewater administrator");
  if (ok) await logAdmin(ctx, "jobs.cancelled", String(fd.get("jobId")));
  revalidatePath("/admin/health");
}

export async function resolveUnknownAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    await resolveUnknownMessage(ctx, String(fd.get("messageId")), fd.get("outcome") === "submitted" ? "submitted" : "failed", String(fd.get("note") ?? ""), await requestId());
    revalidatePath("/admin/health");
    return "Recorded.";
  });
}

async function logAdmin(ctx: { userId: string }, action: string, targetId: string) {
  const { withUserDb } = await import("@/lib/db/context");
  const { audit } = await import("@/lib/audit");
  await withUserDb(ctx.userId, (tx) => audit(tx, { companyId: null, actorUserId: ctx.userId, actorType: "platform_admin", action, targetType: "job", targetId }));
}
