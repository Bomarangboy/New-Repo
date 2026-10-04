import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authProvider } from "@/lib/auth";
import type { Identity } from "@/lib/auth/types";
import type { Feature } from "./entitlements";
import type { Action } from "./permissions";
import type { CompanyContext, PlatformContext } from "./context-types";
import { AuthzError, resolveCompanyContext, resolveUser, type AppUser } from "./resolve";

export const COMPANY_COOKIE = "bw_company";

type Session = { identity: Identity; user: AppUser };

/** Signed in with a password, whether or not the second step is complete. Per-request cached. */
const rawSession = cache(async (): Promise<Session | null> => {
  const identity = await authProvider().getIdentity();
  const user = await resolveUser(identity);
  return identity && user ? { identity, user } : null;
});

/** A fully signed-in session. Accounts with MFA count only after the code is verified. */
export const currentSession = cache(async (): Promise<Session | null> => {
  const s = await rawSession();
  return s && !(s.identity.mfaEnrolled && s.identity.aal !== 2) ? s : null;
});

/** Used only by the verification-code page. */
export async function sessionAwaitingMfa(): Promise<Session | null> {
  const s = await rawSession();
  return s && s.identity.mfaEnrolled && s.identity.aal !== 2 ? s : null;
}

export async function requireSession(): Promise<Session> {
  const s = await currentSession();
  if (s) return s;
  if (await sessionAwaitingMfa()) redirect("/login/mfa");
  redirect("/login");
}

/** For pages: verified context or a redirect to a friendly explanation. */
export async function pageContext(action: Action, feature?: Feature): Promise<CompanyContext> {
  const s = await requireSession();
  try {
    return await companyContextFor(s, action, feature);
  } catch (e) {
    if (e instanceof AuthzError) {
      if (e.code === "no_company" && s.user.isPlatformAdmin) redirect("/admin");
      redirect(`/restricted?reason=${e.code}`);
    }
    throw e;
  }
}

/** For server actions and route handlers: throws AuthzError (caller converts to a message/HTTP status). */
export async function actionContext(action: Action, feature?: Feature): Promise<CompanyContext> {
  const s = await currentSession();
  if (!s) throw new AuthzError("unauthenticated");
  return companyContextFor(s, action, feature);
}

async function companyContextFor(s: { identity: Identity; user: AppUser }, action: Action, feature?: Feature) {
  const requested = (await cookies()).get(COMPANY_COOKIE)?.value ?? null;
  return resolveCompanyContext({
    user: s.user,
    identity: s.identity,
    requestedCompanyId: requested && /^[0-9a-f-]{36}$/i.test(requested) ? requested : null,
    action,
    feature,
  });
}

/** Platform administrator area. Multi-factor authentication is mandatory. */
export async function requirePlatformAdmin(): Promise<PlatformContext> {
  const s = await requireSession();
  if (!s.user.isPlatformAdmin) redirect("/app");
  if (s.identity.aal !== 2) {
    const enrolled = await authProvider().mfaEnrolled(s.identity.authUserId);
    redirect(enrolled ? "/login/mfa?next=/admin" : "/account/security?required=mfa");
  }
  return { userId: s.user.id, isPlatformAdmin: true, mfaVerified: true };
}

export async function adminActionContext(): Promise<PlatformContext> {
  const s = await currentSession();
  if (!s || !s.user.isPlatformAdmin || s.identity.aal !== 2) throw new AuthzError("forbidden");
  return { userId: s.user.id, isPlatformAdmin: true, mfaVerified: true };
}

export async function requestId(): Promise<string> {
  const h = await headers();
  return h.get("x-vercel-id") ?? h.get("x-request-id") ?? crypto.randomUUID();
}
