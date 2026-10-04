"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { authProvider } from "@/lib/auth";
import { withSystemDb } from "@/lib/db/context";
import { users } from "@/lib/db/schema";
import { passwordProblems } from "@/lib/crypto";
import { COMPANY_COOKIE, currentSession, requestId } from "@/lib/authz/guard";
import { acceptInvitation } from "@/server/invitations";
import type { FormState } from "@/components/forms";
import { safeNext } from "@/lib/safe-next";
import { userMessage } from "@/lib/user-message";

const signInSchema = z.object({ email: z.email(), password: z.string().min(1).max(200) });

export async function signInAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { error: "Enter your email address and password." };
  const result = await authProvider().signInWithPassword(parsed.data.email, parsed.data.password);
  if (!result.ok) {
    return {
      error: result.reason === "locked"
        ? "Too many attempts. Wait 15 minutes, or reset your password."
        : result.reason === "disabled"
          ? "This account is disabled. Contact your account owner or Bluewater support."
          : "That email and password don't match. Check them and try again.",
    };
  }
  const next = safeNext(fd.get("next"));
  if (result.needsMfa) redirect(`/login/mfa?next=${encodeURIComponent(next)}`);
  await recordSignIn();
  redirect(next);
}

async function recordSignIn() {
  const s = await currentSession();
  if (s) await withSystemDb("auth: record sign-in time", (tx) => tx.update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, s.user.id)));
}

export async function mfaAction(_: FormState, fd: FormData): Promise<FormState> {
  const code = String(fd.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code from your authenticator app." };
  const ok = await authProvider().verifyMfa(code);
  if (!ok) return { error: "That code didn't work. Codes change every 30 seconds — try the newest one." };
  await recordSignIn();
  redirect(safeNext(fd.get("next")));
}

export async function forgotPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const email = z.email().safeParse(fd.get("email"));
  if (!email.success) return { error: "Enter a valid email address." };
  try {
    await authProvider().requestPasswordReset(email.data);
  } catch {
    return { error: "We couldn't send the email right now. Please try again in a few minutes." };
  }
  return { ok: "If an account exists for that address, a reset link is on its way. It expires in 60 minutes." };
}

export async function resetPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const token = String(fd.get("token") ?? "");
  const password = String(fd.get("password") ?? "");
  if (password !== String(fd.get("confirm") ?? "")) return { error: "The two passwords don't match." };
  const problem = passwordProblems(password);
  if (problem) return { error: problem };
  const ok = await authProvider().completePasswordReset(token, password);
  if (!ok) return { error: "This reset link has expired or was already used. Request a new one." };
  redirect("/login?reset=1");
}

export async function signOutAction(): Promise<void> {
  await authProvider().signOut();
  (await cookies()).delete(COMPANY_COOKIE);
  redirect("/login");
}

async function rememberCompany(companyId: string) {
  (await cookies()).set(COMPANY_COOKIE, companyId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 180 });
}

export async function acceptInviteNewAccountAction(_: FormState, fd: FormData): Promise<FormState> {
  const token = String(fd.get("token") ?? "");
  const password = String(fd.get("password") ?? "");
  if (password !== String(fd.get("confirm") ?? "")) return { error: "The two passwords don't match." };
  let res: { companyId: string; email: string };
  try {
    res = await acceptInvitation(token, { newAccount: { fullName: String(fd.get("fullName") ?? ""), password }, provider: authProvider() }, await requestId());
  } catch (e) {
    return { error: userMessage(e) };
  }
  await rememberCompany(res.companyId);
  const signIn = await authProvider().signInWithPassword(res.email, password);
  redirect(signIn.ok ? "/app?welcome=1" : "/login");
}

export async function acceptInviteSignedInAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await currentSession();
  if (!s) return { error: "Sign in first." };
  let res: { companyId: string };
  try {
    res = await acceptInvitation(String(fd.get("token") ?? ""), { identity: s.identity }, await requestId());
  } catch (e) {
    return { error: userMessage(e) };
  }
  await rememberCompany(res.companyId);
  redirect("/app?welcome=1");
}
