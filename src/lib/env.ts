import { z } from "zod";

/**
 * Server-side configuration. Every value is read from environment variables
 * (never committed). Validation runs once, on first use, and refuses unsafe
 * combinations — e.g. the local development login on a hosted environment.
 *
 * NOTE: never import this module from a client component. Only variables
 * prefixed NEXT_PUBLIC_ are ever sent to browsers, and none of those are secret.
 */

const APP_ENVS = ["development", "test", "staging", "demo", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  APP_ENV: z.enum(APP_ENVS),
  APP_BASE_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  AUTH_PROVIDER: z.enum(["local", "supabase"]),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  /** 32 random bytes, base64. Encrypts MFA secrets and integration tokens at rest. */
  ENCRYPTION_KEY: z.string().min(40),
  SYSTEM_EMAIL_TRANSPORT: z.enum(["dev-outbox", "postmark"]).default("dev-outbox"),
  SYSTEM_EMAIL_FROM: z.string().default("Bluewater Collective <no-reply@example.invalid>"),
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  /** Master switch for any real outbound email/SMS. Off unless the owner approves go-live. */
  LIVE_SENDING_ENABLED: bool,
  /** Secret that scheduled job triggers must present. */
  JOB_TRIGGER_SECRET: z.string().min(24).optional(),

  /* ---- Advertising platforms (Stage 5). Live connections need the owner's approval: off by default. ---- */
  ADS_LIVE_ENABLED: bool,
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  /** Any long random string; Meta presents it once when the webhook is registered. */
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v26.0"),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
  /** Manager (MCC) account id, digits only, if Bluewater accesses clients through a manager account. */
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: z.string().regex(/^\d{10}$/).optional(),
  GOOGLE_ADS_API_VERSION: z.string().regex(/^v\d+$/).default("v25"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid or missing configuration: ${fields}. See .env.example.`);
  }
  assertSafeCombination(parsed.data, process.env);
  cached = parsed.data;
  return cached;
}

/** Exported for tests. Throws when a configuration could be unsafe. */
export function assertSafeCombination(e: Env, raw: Record<string, string | undefined>): void {
  const hosted = Boolean(raw.VERCEL || raw.VERCEL_ENV);
  const localOnlyEnv = e.APP_ENV === "development" || e.APP_ENV === "test";

  if (e.AUTH_PROVIDER === "local" && (!localOnlyEnv || hosted)) {
    throw new Error("The local development login may only run in development or test, never on a hosted environment.");
  }
  if (hosted && localOnlyEnv) {
    throw new Error("Hosted deployments must set APP_ENV to staging, demo or production.");
  }
  if (e.AUTH_PROVIDER === "supabase" && !(e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && e.SUPABASE_SECRET_KEY)) {
    throw new Error("Supabase login requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY.");
  }
  if (e.SYSTEM_EMAIL_TRANSPORT === "dev-outbox" && e.APP_ENV === "production") {
    throw new Error("Production must use a real system email transport.");
  }
  if (e.APP_ENV === "demo" && e.LIVE_SENDING_ENABLED) {
    throw new Error("The sales demo can never enable live sending.");
  }
  if (e.ADS_LIVE_ENABLED && e.APP_ENV !== "production" && e.APP_ENV !== "staging") {
    throw new Error("Live advertising connections can only be enabled in staging or production (development, test and the demo always simulate).");
  }
  if (e.LIVE_SENDING_ENABLED && e.APP_ENV !== "production") {
    throw new Error("Live sending can only be enabled in production (development, test, staging and the demo always simulate).");
  }
}

/** True when this deployment must simulate every external effect (everything except approved production). */
export function isSimulatedEnvironment(): boolean {
  const e = env();
  return !(e.APP_ENV === "production" && e.LIVE_SENDING_ENABLED);
}

export function resetEnvCacheForTests(): void {
  cached = null;
}
