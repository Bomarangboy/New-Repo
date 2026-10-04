"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actionContext, COMPANY_COOKIE, currentSession, requestId } from "@/lib/authz/guard";
import { listUserCompanies } from "@/lib/authz/resolve";
import { env } from "@/lib/env";
import { inviteEmployee, revokeInvitation } from "@/server/invitations";
import { chooseCrmMode, removeMember, transferOwnership, updateCompanySettings } from "@/server/team";
import type { FormState } from "@/components/forms";
import { userMessage } from "@/lib/user-message";

/** Converts failures into plain-language messages; never leaks internal details. */
async function run(fn: () => Promise<string>): Promise<FormState> {
  try {
    return { ok: await fn() };
  } catch (e) {
    return { error: userMessage(e) };
  }
}

/** The cookie only records a preference; access is re-verified against memberships on every request. */
export async function switchCompanyAction(fd: FormData): Promise<void> {
  const s = await currentSession();
  if (!s) redirect("/login");
  const id = String(fd.get("companyId") ?? "");
  const mine = await listUserCompanies(s.user.id);
  if (mine.some((c) => c.id === id)) {
    (await cookies()).set(COMPANY_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 180 });
  }
  redirect("/app");
}

export async function updateSettingsAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("settings.manage");
    await updateCompanySettings(ctx, { name: String(fd.get("name") ?? ""), timezone: String(fd.get("timezone") ?? "") }, await requestId());
    revalidatePath("/app", "layout");
    return "Settings saved.";
  });
}

export async function chooseCrmModeAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("settings.manage");
    const mode = fd.get("mode") === "external" ? "external" : "built_in";
    await chooseCrmMode(ctx, mode, await requestId());
    revalidatePath("/app", "layout");
    return mode === "built_in" ? "You're using Bluewater's built-in CRM." : "External CRM selected.";
  });
}

export async function inviteEmployeeAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("team.invite");
    const email = String(fd.get("email") ?? "");
    await inviteEmployee(ctx, email, env().APP_BASE_URL, await requestId());
    revalidatePath("/app/settings/team");
    return `Invitation sent to ${email.trim().toLowerCase()}. The link works once and expires in 7 days.`;
  });
}

export async function revokeInvitationAction(_: FormState, fd: FormData): Promise<FormState> {
  const res = await run(async () => {
    const ctx = await actionContext("team.invite");
    await revokeInvitation(ctx, String(fd.get("invitationId") ?? ""), await requestId());
    return "ok";
  });
  if (res?.error) return res;
  // The row disappears, so confirm at page level.
  redirect("/app/settings/team?notice=invite_cancelled");
}

export async function removeMemberAction(_: FormState, fd: FormData): Promise<FormState> {
  const res = await run(async () => {
    const ctx = await actionContext("team.remove");
    await removeMember(ctx, String(fd.get("userId") ?? ""), await requestId());
    return "ok";
  });
  if (res?.error) return res;
  redirect("/app/settings/team?notice=member_removed");
}

export async function transferOwnershipAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("ownership.transfer");
    const s = await currentSession();
    await transferOwnership(ctx, String(fd.get("userId") ?? ""), String(fd.get("confirmName") ?? ""), s!.identity.authenticatedAt, await requestId());
    revalidatePath("/app", "layout");
    return "Ownership transferred. You are now a team member of this workspace.";
  });
}

export async function weeklySummaryAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("settings.manage", "scheduled_summaries");
    const { setWeeklySummaryEnabled } = await import("@/server/reports/weekly-summary");
    const on = fd.get("on") === "on";
    await setWeeklySummaryEnabled(ctx, on);
    revalidatePath("/app/settings");
    return on ? "Owners will get a summary every Monday morning." : "Weekly summaries turned off.";
  });
}

/* ---------------- Support tickets ---------------- */

export async function createTicketAction(_: FormState, fd: FormData): Promise<FormState> {
  let id = "";
  const res = await run(async () => {
    const ctx = await actionContext("support.request");
    const { createTicket } = await import("@/server/support");
    const t = await createTicket(ctx, { subject: String(fd.get("subject") ?? ""), category: String(fd.get("category") ?? ""), body: String(fd.get("body") ?? "") });
    id = t.id;
    return t.reference;
  });
  if (res?.error) return res;
  redirect(`/app/help/tickets/${id}?created=1`);
}

export async function replyTicketAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("support.request");
    const { replyToMyTicket } = await import("@/server/support");
    const id = String(fd.get("ticketId") ?? "");
    await replyToMyTicket(ctx, id, String(fd.get("body") ?? ""));
    revalidatePath(`/app/help/tickets/${id}`);
    return "Reply sent to Bluewater.";
  });
}
