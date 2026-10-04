import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { withSystemDb } from "@/lib/db/context";
import type { Tx } from "@/lib/db/client";
import { localCredentials, localSessions, passwordResetTokens, users } from "@/lib/db/schema";
import {
  decrypt, encrypt, hashPassword, hashToken, newToken, newTotpSecret, totpUri, verifyPassword, verifyTotp,
} from "@/lib/crypto";
import { sendSystemEmail } from "@/lib/system-email";
import type { Identity, MfaEnrollment, SignInResult } from "./types";

/**
 * Local identity provider — DEVELOPMENT AND AUTOMATED TESTS ONLY.
 * src/lib/env.ts refuses to start a hosted or non-development environment with it.
 * It mirrors Supabase Auth: identities live in their own table and are linked to
 * Bluewater users by `auth_user_id`. Cookie handling lives in ./local.ts; this file
 * is framework-free so it can be tested directly.
 */

const SESSION_HOURS = 12;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const RESET_MINUTES = 60;

const norm = (email: string) => email.trim().toLowerCase();

async function credByEmail(tx: Tx, email: string) {
  const [c] = await tx.select().from(localCredentials).where(sql`lower(${localCredentials.email}) = ${norm(email)}`);
  return c ?? null;
}

export async function localCreateUser(email: string, password: string): Promise<string> {
  const authUserId = `local-${crypto.randomUUID()}`;
  const passwordHash = await hashPassword(password);
  await withSystemDb("local auth: create identity", async (tx) => {
    if (await credByEmail(tx, email)) throw new Error("An account with this email already exists");
    await tx.insert(localCredentials).values({ authUserId, email: norm(email), passwordHash });
  });
  return authUserId;
}

export async function localSignIn(email: string, password: string): Promise<{ result: SignInResult; token?: string }> {
  return withSystemDb("local auth: sign in", async (tx) => {
    const cred = await credByEmail(tx, email);
    if (!cred) {
      await hashPassword(password); // similar timing whether or not the account exists
      return { result: { ok: false, reason: "invalid" } };
    }
    if (cred.lockedUntil && cred.lockedUntil > new Date()) return { result: { ok: false, reason: "locked" } };
    if (!(await verifyPassword(password, cred.passwordHash))) {
      const failures = cred.failedAttempts + 1;
      await tx.update(localCredentials).set({
        failedAttempts: failures,
        lockedUntil: failures >= MAX_FAILURES ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      }).where(eq(localCredentials.authUserId, cred.authUserId));
      return { result: { ok: false, reason: failures >= MAX_FAILURES ? "locked" : "invalid" } };
    }
    const [u] = await tx.select({ status: users.status }).from(users).where(eq(users.authUserId, cred.authUserId));
    if (u && u.status !== "active") return { result: { ok: false, reason: "disabled" } };
    await tx.update(localCredentials).set({ failedAttempts: 0, lockedUntil: null }).where(eq(localCredentials.authUserId, cred.authUserId));
    const token = newToken();
    await tx.insert(localSessions).values({
      authUserId: cred.authUserId,
      tokenHash: hashToken(token),
      aal: 1,
      expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000),
    });
    return { result: { ok: true, needsMfa: cred.totpEnabled }, token };
  });
}

export async function localLookupSession(token: string): Promise<Identity | null> {
  if (!token) return null;
  return withSystemDb("local auth: session lookup", async (tx) => {
    const [row] = await tx
      .select({ s: localSessions, c: localCredentials })
      .from(localSessions)
      .innerJoin(localCredentials, eq(localCredentials.authUserId, localSessions.authUserId))
      .where(and(eq(localSessions.tokenHash, hashToken(token)), isNull(localSessions.revokedAt), gt(localSessions.expiresAt, new Date())))
      .limit(1);
    if (!row) return null;
    return { authUserId: row.c.authUserId, email: row.c.email, aal: row.s.aal === 2 ? 2 : 1, sessionId: row.s.id, authenticatedAt: row.s.createdAt, mfaEnrolled: row.c.totpEnabled };
  });
}

export async function localRevokeSession(token: string): Promise<void> {
  await withSystemDb("local auth: sign out", (tx) =>
    tx.update(localSessions).set({ revokedAt: new Date() }).where(eq(localSessions.tokenHash, hashToken(token))),
  );
}

export async function localRevokeAll(authUserId: string): Promise<void> {
  await withSystemDb("local auth: revoke all sessions", (tx) =>
    tx.update(localSessions).set({ revokedAt: new Date() }).where(and(eq(localSessions.authUserId, authUserId), isNull(localSessions.revokedAt))),
  );
}

export async function localMfaEnrolled(authUserId: string): Promise<boolean> {
  return withSystemDb("local auth: mfa status", async (tx) => {
    const [c] = await tx.select({ on: localCredentials.totpEnabled }).from(localCredentials).where(eq(localCredentials.authUserId, authUserId));
    return Boolean(c?.on);
  });
}

/** Stores a pending secret; an existing factor stays active until the new one is confirmed. */
export async function localStartMfa(identity: Identity): Promise<MfaEnrollment> {
  const secret = newTotpSecret();
  await withSystemDb("local auth: start mfa", (tx) =>
    tx.update(localCredentials).set({ pendingTotpSecretEnc: encrypt(secret) }).where(eq(localCredentials.authUserId, identity.authUserId)),
  );
  return { factorId: "totp", secret, uri: totpUri(secret, identity.email) };
}

export async function localConfirmMfa(identity: Identity, code: string): Promise<boolean> {
  return withSystemDb("local auth: confirm mfa", async (tx) => {
    const [c] = await tx.select().from(localCredentials).where(eq(localCredentials.authUserId, identity.authUserId));
    if (!c?.pendingTotpSecretEnc) return false;
    const secret = decrypt(c.pendingTotpSecretEnc);
    const step = verifyTotp(secret, code);
    if (step == null) return false;
    await tx.update(localCredentials)
      .set({ totpSecretEnc: encrypt(secret), pendingTotpSecretEnc: null, totpEnabled: true, totpLastStep: step })
      .where(eq(localCredentials.authUserId, identity.authUserId));
    await tx.update(localSessions).set({ aal: 2 }).where(eq(localSessions.id, identity.sessionId));
    return true;
  });
}

export async function localVerifyMfa(sessionId: string, code: string): Promise<boolean> {
  return withSystemDb("local auth: verify mfa", async (tx) => {
    const [s] = await tx.select().from(localSessions)
      .where(and(eq(localSessions.id, sessionId), isNull(localSessions.revokedAt), gt(localSessions.expiresAt, new Date())));
    if (!s) return false;
    const [c] = await tx.select().from(localCredentials).where(eq(localCredentials.authUserId, s.authUserId));
    if (!c?.totpEnabled || !c.totpSecretEnc) return false;
    const step = verifyTotp(decrypt(c.totpSecretEnc), code, Date.now(), c.totpLastStep);
    if (step == null) return false;
    await tx.update(localCredentials).set({ totpLastStep: step }).where(eq(localCredentials.authUserId, s.authUserId));
    await tx.update(localSessions).set({ aal: 2 }).where(eq(localSessions.id, sessionId));
    return true;
  });
}

export async function localRequestReset(email: string, baseUrl: string): Promise<void> {
  const token = newToken();
  const target = await withSystemDb("local auth: request reset", async (tx) => {
    const c = await credByEmail(tx, email);
    if (!c) return null;
    const [u] = await tx.select({ status: users.status }).from(users).where(eq(users.authUserId, c.authUserId));
    if (u && u.status !== "active") return null;
    await tx.insert(passwordResetTokens).values({
      authUserId: c.authUserId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000),
    });
    return c.email;
  });
  if (!target) return;
  await sendSystemEmail({
    to: target,
    subject: "Reset your Bluewater Collective password",
    text: `Someone asked to reset the password for this account.\n\nChoose a new password: ${baseUrl}/reset-password?token=${token}\n\nThis link expires in ${RESET_MINUTES} minutes. If you didn't ask for this, you can ignore this email.`,
  });
}

export async function localCompleteReset(token: string, newPassword: string): Promise<boolean> {
  const passwordHash = await hashPassword(newPassword);
  return withSystemDb("local auth: complete reset", async (tx) => {
    // Atomic single use: only one request can mark the token used.
    const [t] = await tx.update(passwordResetTokens).set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.tokenHash, hashToken(token)), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date())))
      .returning();
    if (!t) return false;
    await tx.update(localCredentials).set({ passwordHash, failedAttempts: 0, lockedUntil: null }).where(eq(localCredentials.authUserId, t.authUserId));
    // A password reset ends every existing session.
    await tx.update(localSessions).set({ revokedAt: new Date() }).where(and(eq(localSessions.authUserId, t.authUserId), isNull(localSessions.revokedAt)));
    return true;
  });
}

export async function localChangePassword(identity: Identity, current: string, next: string): Promise<boolean> {
  const passwordHash = await hashPassword(next);
  return withSystemDb("local auth: change password", async (tx) => {
    const [c] = await tx.select().from(localCredentials).where(eq(localCredentials.authUserId, identity.authUserId));
    if (!c || !(await verifyPassword(current, c.passwordHash))) return false;
    await tx.update(localCredentials).set({ passwordHash }).where(eq(localCredentials.authUserId, identity.authUserId));
    // Keep this session; end all others.
    await tx.update(localSessions).set({ revokedAt: new Date() }).where(and(
      eq(localSessions.authUserId, identity.authUserId), isNull(localSessions.revokedAt), ne(localSessions.id, identity.sessionId)));
    return true;
  });
}
