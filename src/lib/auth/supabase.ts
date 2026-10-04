import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { AuthProvider, Identity } from "./types";

/**
 * Supabase Auth provider (staging, demo, production).
 *
 * STATUS: implemented against the installed @supabase/supabase-js and @supabase/ssr
 * type definitions, but AWAITING LIVE VERIFICATION — it has not yet run against a
 * real Supabase project. See docs/IMPLEMENTATION_PLAN.md (Stage 1 live checks).
 *
 * Required Supabase dashboard settings (docs/SETUP_SUPABASE.md):
 *  - Email/password sign-in on; public sign-ups OFF (accounts are created by invitation only)
 *  - TOTP MFA enabled
 *  - Password-recovery email template links to {{ .SiteURL }}/reset-password?token={{ .TokenHash }}
 *  - Custom SMTP (Postmark) so auth emails come from Bluewater's domain
 */

async function serverClient() {
  const e = env();
  const jar = await cookies();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) jar.set(name, value, options);
        } catch {
          // Server Components cannot set cookies; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

function adminClient() {
  const e = env();
  return createClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A throwaway client used only to check a password without touching the browser session. */
function verifierClient() {
  const e = env();
  return createClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Amr = { method: string; timestamp: number }[];

export const supabaseProvider: AuthProvider = {
  name: "supabase",

  async getIdentity(): Promise<Identity | null> {
    const sb = await serverClient();
    // getClaims() verifies the JWT signature; never trust getSession() alone on the server.
    const { data, error } = await sb.auth.getClaims();
    if (error || !data?.claims?.sub) return null;
    const c = data.claims as Record<string, unknown>;
    const amr = (c.amr as Amr | undefined) ?? [];
    const pwdAt = amr.find((a) => a.method === "password")?.timestamp ?? Number(c.iat ?? 0);
    // nextLevel is "aal2" whenever the user has a verified factor (computed from the session, no network call).
    const { data: level } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    return {
      authUserId: String(c.sub),
      email: String(c.email ?? ""),
      aal: c.aal === "aal2" ? 2 : 1,
      sessionId: String(c.session_id ?? ""),
      authenticatedAt: new Date(pwdAt * 1000),
      mfaEnrolled: level?.nextLevel === "aal2",
    };
  },

  async signInWithPassword(email, password) {
    const sb = await serverClient();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      if (error?.code === "user_banned") return { ok: false, reason: "disabled" };
      return { ok: false, reason: "invalid" };
    }
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    return { ok: true, needsMfa: aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2" };
  },

  async verifyMfa(code) {
    const sb = await serverClient();
    const { data } = await sb.auth.mfa.listFactors();
    const factor = data?.totp?.find((f) => f.status === "verified");
    if (!factor) return false;
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    return !error;
  },

  async mfaEnrolled(authUserId) {
    const { data } = await adminClient().auth.admin.mfa.listFactors({ userId: authUserId });
    return Boolean(data?.factors?.some((f) => f.factor_type === "totp" && f.status === "verified"));
  },

  async startMfaEnrollment() {
    const sb = await serverClient();
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${Date.now()}` });
    if (error || !data) throw new Error("Could not start MFA enrollment");
    return { factorId: data.id, secret: data.totp.secret, uri: data.totp.uri };
  },

  async confirmMfaEnrollment(_identity, factorId, code) {
    const sb = await serverClient();
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
    return !error;
  },

  async signOut() {
    const sb = await serverClient();
    await sb.auth.signOut({ scope: "local" });
  },

  /**
   * Supabase can only end another user's refresh tokens with that user's own JWT.
   * Bluewater therefore also records users.sessions_revoked_at, which rejects any
   * sign-in older than the revocation on the very next request (src/lib/auth/session.ts).
   * When the caller is the user themself, we additionally end every Supabase session.
   */
  async revokeAllSessions(authUserId) {
    const sb = await serverClient();
    const { data } = await sb.auth.getClaims();
    if (data?.claims?.sub === authUserId) await sb.auth.signOut({ scope: "global" });
  },

  async createUser(email, password) {
    const { data, error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error("Could not create the account");
    return data.user.id;
  },

  async requestPasswordReset(email) {
    // Supabase sends the email (via the custom SMTP configured in its dashboard).
    await verifierClient().auth.resetPasswordForEmail(email, { redirectTo: `${env().APP_BASE_URL}/reset-password` });
  },

  async completePasswordReset(token, newPassword) {
    const sb = await serverClient();
    const { error } = await sb.auth.verifyOtp({ type: "recovery", token_hash: token });
    if (error) return false;
    const { error: e2 } = await sb.auth.updateUser({ password: newPassword });
    if (e2) return false;
    await sb.auth.signOut({ scope: "others" });
    return true;
  },

  async changePassword(identity, current, next) {
    const verifier = verifierClient();
    const check = await verifier.auth.signInWithPassword({ email: identity.email, password: current });
    if (check.error) return false;
    await verifier.auth.signOut({ scope: "local" }); // discard the check-only session
    const sb = await serverClient();
    const { error } = await sb.auth.updateUser({ password: next });
    if (error) return false;
    await sb.auth.signOut({ scope: "others" });
    return true;
  },
};
