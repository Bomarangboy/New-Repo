import { getDb, setContext, type Tx } from "./client";
import type { CompanyContext, PlatformContext } from "@/lib/authz/context-types";

/**
 * The only three doors into the database.
 *
 * withCompanyDb  – client workspace requests. RLS limits every query to ctx.companyId.
 *                  The context must come from requireCompanyContext(), which has
 *                  already verified membership (or a live support grant), role,
 *                  package and account status on the server.
 * withPlatformDb – platform administrator screens. Requires a verified administrator
 *                  with multi-factor authentication.
 * withSystemDb   – trusted server processes that act before a user/company is known:
 *                  sign-in, invitation acceptance, webhooks, background jobs.
 *                  Must never be called from client workspace pages (a test enforces this).
 */
export async function withCompanyDb<T>(ctx: CompanyContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!ctx.companyId || !ctx.userId) throw new Error("withCompanyDb requires a verified company context");
  return getDb().transaction(async (tx) => {
    await setContext(tx, { companyId: ctx.companyId, userId: ctx.userId });
    return fn(tx);
  });
}

export async function withPlatformDb<T>(ctx: PlatformContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!ctx.isPlatformAdmin || !ctx.mfaVerified) throw new Error("withPlatformDb requires a verified administrator");
  return getDb().transaction(async (tx) => {
    await setContext(tx, { userId: ctx.userId, scope: "platform" });
    return fn(tx);
  });
}

/** `purpose` documents why unrestricted access is needed; keep each caller narrow. */
export async function withSystemDb<T>(purpose: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!purpose) throw new Error("withSystemDb requires a purpose");
  return getDb().transaction(async (tx) => {
    await setContext(tx, { scope: "system" });
    return fn(tx);
  });
}

/** Signed-in user acting on their own record before a company is chosen. */
export async function withUserDb<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await setContext(tx, { userId });
    return fn(tx);
  });
}
