import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { withSystemCompanyDb, withSystemDb } from "@/lib/db/context";
import { companies, intakeEvents, intakeSources } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { accountPolicy } from "@/lib/authz/account-policy";
import { UserError } from "@/lib/errors";
import { cleanText, pickTracking } from "@/lib/contact-normalize";
import { recordInquiry, type InquiryInput } from "@/server/crm/record-inquiry";
import { enqueueNewLeadWork } from "@/server/messaging/acknowledgment";

/**
 * Website form intake (documented in docs/INTAKE.md).
 *
 * Order of operations — never tell the sender "received" before the submission is stored:
 *   1. identify the source by its public key           → 404 if unknown/disabled
 *   2. verify signature (server-to-server) or origin   → 401/403
 *   3. rate limit per source                            → 429 (sender retries; nothing stored)
 *   4. account status: closed accounts refuse          → 410 (explicit, never silently dropped)
 *   5. duplicate check (Idempotency-Key / identical content within 10 minutes) → 200 duplicate
 *   6. STORE the raw event (own transaction, committed)
 *   7. process it into a contact + inquiry              → 201; validation problems → 422;
 *      unexpected failure → 202 (stored; retried by processIntakeEvent)
 */

export const MAX_BODY_BYTES = 32 * 1024;
export const RATE_LIMIT_PER_MINUTE = 30;
const DUPLICATE_WINDOW_MINUTES = 10;
const SIGNATURE_TOLERANCE_SECONDS = 300;
export const HONEYPOT_FIELD = "_bw_hp";
const RESERVED = new Set([HONEYPOT_FIELD, "_redirect", "submission_id"]);

export interface IntakeRequest {
  publicKey: string;
  rawBody: string;
  contentType: string;
  origin: string | null;
  signature: string | null;
  timestamp: string | null;
  idempotencyKey: string | null;
  ip: string | null;
  userAgent: string | null;
  now?: Date;
}

export interface IntakeResponse {
  status: number;
  body: Record<string, unknown>;
  redirectTo?: string;
  allowOrigin?: string;
}

export function parseBody(raw: string, contentType: string): Record<string, string> | null {
  try {
    if (contentType.includes("application/json")) {
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) if (v != null && typeof v !== "object") out[k.slice(0, 64)] = String(v).slice(0, 5000);
      return out;
    }
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const out: Record<string, string> = {};
      for (const [k, v] of new URLSearchParams(raw)) out[k.slice(0, 64)] = v.slice(0, 5000);
      return out;
    }
  } catch {
    return null;
  }
  return null;
}

export function signBody(secret: string, timestamp: string, rawBody: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function contentHash(fields: Record<string, string>): string {
  const keys = Object.keys(fields).filter((k) => !RESERVED.has(k)).sort();
  return createHash("sha256").update(JSON.stringify(keys.map((k) => [k.toLowerCase(), fields[k]!.trim().toLowerCase()]))).digest("hex");
}

const truthy = (v: string | undefined) => !!v && /^(1|true|yes|on|checked)$/i.test(v.trim());

/** Maps common website-form field names to a lead. Unknown fields are kept in the stored event only. */
export function mapFields(f: Record<string, string>, meta: { ip: string | null; userAgent: string | null }): InquiryInput {
  const first = f.first_name ?? f.firstname, last = f.last_name ?? f.lastname;
  const name = f.name ?? f.full_name ?? f.fullname ?? ([first, last].filter(Boolean).join(" ") || undefined);
  const pageUrl = cleanText(f.page_url ?? f.landing_page, 500);
  const statement = cleanText(f.consent_text, 1000);
  const consent: NonNullable<InquiryInput["consent"]> = [];
  if ("consent_sms" in f) consent.push({ channel: "sms", purpose: "inquiry_response", granted: truthy(f.consent_sms), statement, method: "web_form_checkbox", pageUrl, ipAddress: meta.ip, userAgent: meta.userAgent });
  if ("consent_email" in f) consent.push({ channel: "email", purpose: "inquiry_response", granted: truthy(f.consent_email), statement, method: "web_form_checkbox", pageUrl, ipAddress: meta.ip, userAgent: meta.userAgent });
  return {
    fullName: name,
    email: f.email,
    phone: f.phone ?? f.phone_number ?? f.tel,
    serviceRequested: f.service ?? f.service_requested,
    message: f.message ?? f.comments ?? f.details,
    tracking: pickTracking({ ...f, landing_page: f.landing_page ?? f.page_url }),
    consent,
  };
}

function redirectFor(fields: Record<string, string>, allowed: string[]): string | undefined {
  const r = fields._redirect;
  if (!r) return undefined;
  try {
    const u = new URL(r);
    return (u.protocol === "https:" || u.protocol === "http:") && allowed.includes(u.origin) ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export async function receiveWebsiteSubmission(req: IntakeRequest): Promise<IntakeResponse> {
  const now = req.now ?? new Date();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(req.publicKey)) return { status: 404, body: { error: "Unknown form." } };

  const found = await withSystemDb("intake: identify source", async (tx) => {
    const [row] = await tx.select({ s: intakeSources, c: companies }).from(intakeSources)
      .innerJoin(companies, eq(companies.id, intakeSources.companyId))
      .where(eq(intakeSources.publicKey, req.publicKey));
    return row ?? null;
  });
  if (!found || !found.s.active) return { status: 404, body: { error: "Unknown form." } };
  const { s: source, c: company } = found;

  const allowedOrigins = source.allowedOrigins ?? [];
  const allowOrigin = allowedOrigins.length === 0 ? "*" : req.origin && allowedOrigins.includes(req.origin) ? req.origin : undefined;

  if (Buffer.byteLength(req.rawBody) > MAX_BODY_BYTES) return { status: 413, body: { error: "Submission too large." }, allowOrigin };

  // Authenticity.
  if (source.signingSecretEnc) {
    const ts = Number(req.timestamp);
    if (!req.signature || !Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > SIGNATURE_TOLERANCE_SECONDS) {
      return { status: 401, body: { error: "Missing or expired signature." } };
    }
    const expected = signBody(decrypt(source.signingSecretEnc), String(req.timestamp), req.rawBody);
    if (!safeEqual(expected, req.signature)) return { status: 401, body: { error: "Invalid signature." } };
  } else if (allowedOrigins.length && req.origin && !allowedOrigins.includes(req.origin)) {
    return { status: 403, body: { error: "This website isn't allowed to submit to this form." } };
  }

  const fields = parseBody(req.rawBody, req.contentType);
  if (!fields) return { status: 400, body: { error: "Send the form as JSON or as a standard HTML form." }, allowOrigin };

  const ipHash = req.ip ? createHash("sha256").update(req.ip).digest("hex").slice(0, 32) : null;
  const hash = contentHash(fields);
  const explicitKey = cleanText(req.idempotencyKey ?? fields.submission_id, 200);
  const idempotencyKey = explicitKey ? `k:${explicitKey}` : `h:${hash}:${now.getTime()}`;
  const redirectTo = redirectFor(fields, allowedOrigins);

  return withSystemCompanyDb(company.id, "intake: store submission", async (tx) => {
    // Rate limit (nothing is stored; the sender can retry).
    const [{ recent }] = (await tx.select({ recent: count() }).from(intakeEvents)
      .where(and(eq(intakeEvents.intakeSourceId, source.id), gt(intakeEvents.receivedAt, new Date(now.getTime() - 60_000))))) as [{ recent: number }];
    if (recent >= RATE_LIMIT_PER_MINUTE) return { status: 429, body: { error: "Too many submissions. Please try again in a minute." }, allowOrigin };

    // Serialize identical submissions so a double-click can't slip past the duplicate check.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${source.id + ":" + (explicitKey ?? hash)}, 0))`);
    const dupWhere = explicitKey
      ? and(eq(intakeEvents.intakeSourceId, source.id), eq(intakeEvents.idempotencyKey, idempotencyKey))
      : and(eq(intakeEvents.intakeSourceId, source.id), eq(intakeEvents.contentHash, hash), gt(intakeEvents.receivedAt, new Date(now.getTime() - DUPLICATE_WINDOW_MINUTES * 60_000)));
    const [dup] = await tx.select({ id: intakeEvents.id, status: intakeEvents.status }).from(intakeEvents).where(dupWhere).limit(1);
    if (dup) return { status: 200, body: { status: "duplicate", id: dup.id }, redirectTo, allowOrigin };

    if (fields[HONEYPOT_FIELD]) {
      await tx.insert(intakeEvents).values({ companyId: company.id, intakeSourceId: source.id, idempotencyKey, contentHash: hash, payload: null, status: "rejected", error: "spam_trap", ipHash });
      return { status: 200, body: { status: "received" }, redirectTo, allowOrigin }; // don't tip off bots
    }

    const policy = accountPolicy(company, now);
    if (policy.intake === "reject") {
      await tx.insert(intakeEvents).values({ companyId: company.id, intakeSourceId: source.id, idempotencyKey, contentHash: hash, payload: null, status: "rejected", error: "account_closed", ipHash });
      return { status: 410, body: { error: "This form is no longer accepting submissions." }, allowOrigin };
    }

    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) if (k !== HONEYPOT_FIELD) payload[k] = v;
    const [event] = await tx.insert(intakeEvents).values({
      companyId: company.id, intakeSourceId: source.id, idempotencyKey, contentHash: hash,
      payload: { fields: payload, userAgent: req.userAgent?.slice(0, 300) ?? null, ip: req.ip ?? null }, status: "received", ipHash,
    }).returning({ id: intakeEvents.id });
    return { status: 0, body: { id: event!.id }, redirectTo, allowOrigin };
  }).then(async (stored) => {
    if (stored.status !== 0) return stored;
    // Step 7 runs AFTER the event is committed.
    const result = await processIntakeEvent(String(stored.body.id));
    if (result.status === "processed") return { status: 201, body: { status: "received", id: stored.body.id }, redirectTo: stored.redirectTo, allowOrigin: stored.allowOrigin };
    if (result.status === "rejected") return { status: 422, body: { error: "Please check the form.", problems: result.problems }, allowOrigin: stored.allowOrigin };
    return { status: 202, body: { status: "received", id: stored.body.id }, redirectTo: stored.redirectTo, allowOrigin: stored.allowOrigin };
  });
}

/**
 * Turns a stored submission into a contact + inquiry. Safe to call repeatedly:
 * only events still "received" or "failed" are processed, under a row lock.
 */
export async function processIntakeEvent(eventId: string): Promise<{ status: "processed" | "rejected" | "failed" | "skipped"; problems?: string[] }> {
  const meta = await withSystemDb("intake: load event", async (tx) => {
    const [e] = await tx.select({ companyId: intakeEvents.companyId }).from(intakeEvents).where(eq(intakeEvents.id, eventId));
    return e ?? null;
  });
  if (!meta) return { status: "skipped" };
  try {
    return await withSystemCompanyDb(meta.companyId, "intake: process submission", async (tx) => {
      const [e] = await tx.select().from(intakeEvents).where(eq(intakeEvents.id, eventId)).for("update");
      if (!e || (e.status !== "received" && e.status !== "failed")) return { status: "skipped" as const };
      const [company] = await tx.select().from(companies).where(eq(companies.id, e.companyId));
      const [source] = await tx.select().from(intakeSources).where(eq(intakeSources.id, e.intakeSourceId));
      const policy = accountPolicy(company!);
      const p = (e.payload ?? {}) as { fields?: Record<string, string>; ip?: string | null; userAgent?: string | null };
      const input = mapFields(p.fields ?? {}, { ip: p.ip ?? null, userAgent: p.userAgent ?? null });
      try {
        const res = await recordInquiry(tx, input, {
          companyId: e.companyId, source: "website_form", sourceLabel: source?.name ?? "Website form", intakeSourceId: e.intakeSourceId,
          automationOrigin: policy.intake === "process" ? "eligible" : "held", actorType: "system",
        });
        // Acknowledgment + team alert are queued in the SAME transaction as the lead (no lead without its jobs).
        await enqueueNewLeadWork(tx, e.companyId, res.inquiry.id, res.inquiry.automationOrigin);
        await tx.update(intakeEvents).set({ status: "processed", inquiryId: res.inquiry.id, processedAt: new Date(), error: null }).where(eq(intakeEvents.id, eventId));
        await tx.update(intakeSources).set({ lastReceivedAt: new Date() }).where(eq(intakeSources.id, e.intakeSourceId));
        return { status: "processed" as const };
      } catch (err) {
        if (err instanceof UserError) {
          await tx.update(intakeEvents).set({ status: "rejected", error: err.message.slice(0, 500), processedAt: new Date() }).where(eq(intakeEvents.id, eventId));
          return { status: "rejected" as const, problems: [err.message] };
        }
        throw err;
      }
    });
  } catch (err) {
    await withSystemCompanyDb(meta.companyId, "intake: mark failed", (tx) =>
      tx.update(intakeEvents).set({ status: "failed", error: (err instanceof Error ? err.message : "unknown").slice(0, 500) }).where(eq(intakeEvents.id, eventId)),
    );
    return { status: "failed" };
  }
}
