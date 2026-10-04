/** Problems talking to an ad platform, in categories the jobs act on differently. */
export class AdsAuthError extends Error {
  /** The connection must be renewed by the client (token expired, revoked or permission removed). */
  readonly kind = "auth";
}
export class AdsRateLimitError extends Error {
  readonly kind = "rate_limit";
  constructor(message: string, readonly retryAfterMs = 10 * 60_000) { super(message); }
}
export class AdsApiError extends Error {
  readonly kind = "api";
}

/** Plain-language summary for owners (never includes tokens or raw responses). */
export function describeAdsError(e: unknown): string {
  if (e instanceof AdsAuthError) return "The connection needs to be renewed: sign in again under Connected Accounts.";
  if (e instanceof AdsRateLimitError) return "The platform asked us to slow down; Bluewater will try again shortly.";
  if (e instanceof AdsApiError) return `The platform reported a problem: ${e.message.slice(0, 200)}`;
  return "An unexpected problem occurred while talking to the platform. Bluewater will retry.";
}
