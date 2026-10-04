"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminActionContext, requestId } from "@/lib/authz/guard";
import { userMessage } from "@/lib/user-message";
import type { FormState } from "@/components/forms";
import { cancelNotice, createNotice, replyAsBluewater, sendNotice } from "@/server/support";

async function run(fn: () => Promise<string>): Promise<FormState> {
  try {
    return { ok: await fn() };
  } catch (e) {
    return { error: userMessage(e) };
  }
}

export async function adminReplyAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const id = String(fd.get("ticketId") ?? "");
    const internal = fd.get("internal") === "1";
    await replyAsBluewater(ctx, id, { body: String(fd.get("body") ?? ""), internal, status: String(fd.get("status") ?? "") }, await requestId());
    revalidatePath(`/admin/support/${id}`);
    revalidatePath("/admin/support");
    return internal ? "Saved. Internal notes are never shown to the client." : "Reply saved and emailed to the person who opened the request.";
  });
}

export async function createNoticeAction(_: FormState, fd: FormData): Promise<FormState> {
  let id = "";
  const res = await run(async () => {
    const ctx = await adminActionContext();
    id = await createNotice(ctx, {
      title: String(fd.get("title") ?? ""), body: String(fd.get("body") ?? ""), audience: String(fd.get("audience") ?? ""),
      companyIds: fd.getAll("companyIds").map(String),
    }, await requestId());
    return "Draft saved.";
  });
  if (res?.error) return res;
  redirect(`/admin/notices?review=${id}`);
}

export async function sendNoticeAction(_: FormState, fd: FormData): Promise<FormState> {
  let n = 0;
  const res = await run(async () => {
    const ctx = await adminActionContext();
    n = await sendNotice(ctx, String(fd.get("noticeId") ?? ""), Number(fd.get("confirmedCount") ?? -1), await requestId());
    return "Sent";
  });
  if (res?.error) return res;
  revalidatePath("/admin/notices");
  redirect(`/admin/notices?sent=${n}`);
}

export async function cancelNoticeAction(fd: FormData): Promise<void> {
  const ctx = await adminActionContext();
  await cancelNotice(ctx, String(fd.get("noticeId") ?? ""));
  revalidatePath("/admin/notices");
}

/* ---------------- Data deletion & sales-demo workspaces ---------------- */

export async function deleteCompanyDataAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const { deleteCompanyData } = await import("@/server/retention");
    const id = String(fd.get("companyId") ?? "");
    const rec = await deleteCompanyData(ctx, id, { confirmName: String(fd.get("confirmName") ?? ""), reason: String(fd.get("reason") ?? "") }, await requestId());
    revalidatePath(`/admin/companies/${id}`);
    const total = Object.entries(rec.summary).filter(([k]) => k !== "sign_in_accounts_disabled").reduce((a, [, n]) => a + n, 0);
    return `Deleted ${total} record(s). A deletion record was kept. Backups still hold the data until they expire (see the retention policy).`;
  });
}

export async function createProspectAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const { createProspect } = await import("@/server/demo/prospects");
    const c = await createProspect(ctx, { name: String(fd.get("name") ?? ""), package: String(fd.get("package") ?? ""), days: Number(fd.get("days") ?? 14), timezone: String(fd.get("timezone") ?? "") }, await requestId());
    const email = String(fd.get("email") ?? "").trim();
    if (email) {
      const { inviteOwner } = await import("@/server/invitations");
      const { env } = await import("@/lib/env");
      await inviteOwner(ctx, c.id, email, env().APP_BASE_URL, await requestId());
    }
    revalidatePath("/admin/demo");
    return `${c.name} is ready with sample data${email ? `; an invitation went to ${email}` : ""}.`;
  });
}

export async function prospectAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const m = await import("@/server/demo/prospects");
    const id = String(fd.get("companyId") ?? "");
    const op = String(fd.get("op") ?? "");
    const rid = await requestId();
    let msg: string;
    if (op === "reset") { await m.resetProspect(ctx, id, rid); msg = "Sample data reset. Sign-ins were kept."; }
    else if (op === "extend") { const until = await m.extendProspect(ctx, id, Number(fd.get("days") ?? 7), rid); msg = `Now expires ${until.toISOString().slice(0, 10)}.`; }
    else if (op === "revoke") { await m.revokeProspect(ctx, id, rid); msg = `Access ended now. Sample data is deleted automatically after ${m.DEMO_GRACE_DAYS} days.`; }
    else if (op === "package") { await m.switchProspectPackage(ctx, id, String(fd.get("package") ?? ""), rid); msg = "Package switched. Refresh the workspace to see the change."; }
    else if (op === "lead" || op === "reply" || op === "booking" || op === "advance") msg = await m.presentationControl(ctx, id, op, rid);
    else throw new Error("unknown op");
    revalidatePath("/admin/demo");
    return msg;
  });
}
