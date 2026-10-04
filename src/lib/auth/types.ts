/** Who the identity provider says is signed in. Authorization happens separately. */
export interface Identity {
  authUserId: string;
  email: string;
  /** Authenticator assurance level: 1 = password, 2 = password + second factor. */
  aal: 1 | 2;
  sessionId: string;
  /** When the person actually entered their password (survives token refreshes). */
  authenticatedAt: Date;
  /** The account has a verified second factor, so aal 2 is required before any access. */
  mfaEnrolled: boolean;
}

export type SignInResult =
  | { ok: true; needsMfa: boolean }
  | { ok: false; reason: "invalid" | "locked" | "disabled" };

export interface MfaEnrollment {
  factorId: string;
  secret: string;
  uri: string;
}

/**
 * Identity provider contract. Production/staging/demo use Supabase Auth;
 * development and automated tests use the local provider.
 * Both must behave identically from the application's point of view.
 */
export interface AuthProvider {
  readonly name: "local" | "supabase";
  getIdentity(): Promise<Identity | null>;
  signInWithPassword(email: string, password: string): Promise<SignInResult>;
  /** Raises the current session to aal2 when the code is valid. */
  verifyMfa(code: string): Promise<boolean>;
  mfaEnrolled(authUserId: string): Promise<boolean>;
  startMfaEnrollment(identity: Identity): Promise<MfaEnrollment>;
  confirmMfaEnrollment(identity: Identity, factorId: string, code: string): Promise<boolean>;
  signOut(): Promise<void>;
  /** Ends every session for a user (offboarding, "sign out everywhere", suspected compromise). */
  revokeAllSessions(authUserId: string): Promise<void>;
  /** Creates the identity for an invited person; email ownership was proven by the invitation link. */
  createUser(email: string, password: string): Promise<string>;
  /** Sends a reset link if the account exists. Never reveals whether it does. */
  requestPasswordReset(email: string): Promise<void>;
  completePasswordReset(token: string, newPassword: string): Promise<boolean>;
  changePassword(identity: Identity, currentPassword: string, newPassword: string): Promise<boolean>;
}
