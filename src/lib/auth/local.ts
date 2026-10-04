import { cookies } from "next/headers";
import { env } from "@/lib/env";
import * as core from "./local-core";
import type { AuthProvider } from "./types";

const COOKIE = "bw_session";

async function token(): Promise<string | null> {
  return (await cookies()).get(COOKIE)?.value ?? null;
}

/** Development/test login. Cookie is httpOnly + SameSite=Lax; the value is a random token. */
export const localProvider: AuthProvider = {
  name: "local",

  async getIdentity() {
    const t = await token();
    return t ? core.localLookupSession(t) : null;
  },

  async signInWithPassword(email, password) {
    const { result, token: t } = await core.localSignIn(email, password);
    if (result.ok && t) {
      (await cookies()).set(COOKIE, t, {
        httpOnly: true,
        sameSite: "lax",
        secure: env().APP_BASE_URL.startsWith("https://"),
        path: "/",
        maxAge: 12 * 3600,
      });
    }
    return result;
  },

  async verifyMfa(code) {
    const t = await token();
    const id = t ? await core.localLookupSession(t) : null;
    return id ? core.localVerifyMfa(id.sessionId, code) : false;
  },

  mfaEnrolled: core.localMfaEnrolled,
  startMfaEnrollment: core.localStartMfa,
  confirmMfaEnrollment: (identity, _factorId, code) => core.localConfirmMfa(identity, code),

  async signOut() {
    const jar = await cookies();
    const t = jar.get(COOKIE)?.value;
    if (t) await core.localRevokeSession(t);
    jar.delete(COOKIE);
  },

  revokeAllSessions: core.localRevokeAll,
  createUser: core.localCreateUser,
  requestPasswordReset: (email) => core.localRequestReset(email, env().APP_BASE_URL),
  completePasswordReset: core.localCompleteReset,
  changePassword: core.localChangePassword,
};
