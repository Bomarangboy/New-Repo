"use server";

import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { authProvider } from "@/lib/auth";
import { currentSession, requestId } from "@/lib/authz/guard";
import { withUserDb } from "@/lib/db/context";
import { audit } from "@/lib/audit";
import { passwordProblems } from "@/lib/crypto";
import { markSessionsRevoked } from "@/server/team";
import type { FormState } from "@/components/forms";

async function logAccount(userId: string, action: string) {
  const rid = await requestId();
  await withUserDb(userId, (tx) => audit(tx, { companyId: null, actorUserId: userId, actorType: "user", action, requestId: rid }));
}

export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await currentSession();
  if (!s) redirect("/login");
  const next = String(fd.get("password") ?? "");
  if (next !== String(fd.get("confirm") ?? "")) return { error: "The two new passwords don't match." };
  const problem = passwordProblems(next);
  if (problem) return { error: problem };
  const ok = await authProvider().changePassword(s.identity, String(fd.get("current") ?? ""), next);
  if (!ok) return { error: "Your current password isn't correct." };
  await logAccount(s.user.id, "account.password_changed");
  return { ok: "Password changed. Other devices have been signed out." };
}

export type MfaState = { error?: string; ok?: string; factorId?: string; qrSvg?: string; secret?: string } | null;

/** Two-step flow in one form: first call returns a QR code; second call (with code) confirms it. */
export async function mfaEnrollAction(prev: MfaState, fd: FormData): Promise<MfaState> {
  const s = await currentSession();
  if (!s) redirect("/login");
  const provider = authProvider();
  const code = String(fd.get("code") ?? "").replace(/\s/g, "");
  if (prev?.factorId && code) {
    if (!/^\d{6}$/.test(code)) return { ...prev, error: "Enter the 6-digit code from your app." };
    const ok = await provider.confirmMfaEnrollment(s.identity, prev.factorId, code);
    if (!ok) return { ...prev, error: "That code didn't match. Make sure your phone's clock is correct and use the newest code." };
    await logAccount(s.user.id, "account.mfa_enabled");
    return { ok: "Two-step verification is on. You'll enter a code from your app each time you sign in." };
  }
  const { factorId, uri, secret } = await provider.startMfaEnrollment(s.identity);
  const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, width: 192, color: { dark: "#0f243d", light: "#ffffff" } });
  return { factorId, qrSvg, secret };
}

export async function signOutEverywhereAction(): Promise<void> {
  const s = await currentSession();
  if (!s) redirect("/login");
  await authProvider().revokeAllSessions(s.identity.authUserId);
  await markSessionsRevoked(s.user.id);
  await logAccount(s.user.id, "account.sessions_revoked");
  await authProvider().signOut();
  redirect("/login");
}
