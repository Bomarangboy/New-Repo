import { retryFailedIntake } from "@/server/ops/controls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb } from "@/lib/db/client";
import { withSystemDb } from "@/lib/db/context";
import { consentRecords, inquiries, intakeEvents } from "@/lib/db/schema";
import { resolveCompanyContext } from "@/lib/authz/resolve";
import { createIntakeSource, rotateSigningSecret, updateIntakeSource } from "@/server/intake/sources";
import { contentHash, processIntakeEvent, receiveWebsiteSubmission, signBody, RATE_LIMIT_PER_MINUTE, type IntakeRequest } from "@/server/intake/website";
import { addMember, adminCtx, identityFor, makeCompany, makeUser, setCompany } from "../helpers";
import type { CompanyContext } from "@/lib/authz/context-types";

let owner: CompanyContext;
let companyId: string;
let key: string;
let sourceId: string;

const req = (body: Record<string, unknown> | string, extra: Partial<IntakeRequest> = {}): IntakeRequest => ({
  publicKey: key, rawBody: typeof body === "string" ? body : JSON.stringify(body), contentType: "application/json",
  origin: "https://harbor.example", signature: null, timestamp: null, idempotencyKey: null, ip: "203.0.113.9", userAgent: "test", ...extra,
});

async function inquiriesFor(email: string) {
  return withSystemDb("test", (tx) => tx.execute<{ id: string; automation_origin: string }>(
    sql`select i.id, i.automation_origin from app.inquiries i join app.contacts c on c.id = i.contact_id where c.email_normalized = ${email}`,
  ));
}

beforeAll(async () => {
  const c = await makeCompany({ name: "Intake Co", lifecycleStatus: "active" });
  companyId = c.id;
  const u = await makeUser();
  await addMember(c.id, u.id, "owner");
  owner = await resolveCompanyContext({ user: u, identity: identityFor(u), requestedCompanyId: c.id, action: "integration.manage" });
  const s = await createIntakeSource(owner, { name: "Contact page", allowedOrigins: ["https://harbor.example"] });
  key = s.publicKey;
  sourceId = s.id;
});
afterAll(closeDb);

describe("website form intake", () => {
  it("unknown keys get 404 and nothing is stored", async () => {
    expect((await receiveWebsiteSubmission(req({ email: "x@y.z" }, { publicKey: "doesnotexist_doesnotexist" }))).status).toBe(404);
  });

  it("stores a valid submission with tracking and consent evidence, eligible for automation", async () => {
    const r = await receiveWebsiteSubmission(req({
      name: "Riley Park", email: "riley@example.com", phone: "415-555-0150", service: "Roof repair", message: "Leak in kitchen",
      utm_source: "google", utm_campaign: "spring", gclid: "abc123", page_url: "https://harbor.example/contact",
      consent_sms: "on", consent_text: "I agree to receive texts about my request.",
    }));
    expect(r.status).toBe(201);
    const rows = await inquiriesFor("riley@example.com");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.automation_origin).toBe("eligible");
    const [inq] = await withSystemDb("test", (tx) => tx.select().from(inquiries).where(eq(inquiries.id, rows[0]!.id)));
    expect(inq!.tracking).toMatchObject({ utm_source: "google", utm_campaign: "spring", gclid: "abc123", landing_page: "https://harbor.example/contact" });
    const consent = await withSystemDb("test", (tx) => tx.select().from(consentRecords).where(eq(consentRecords.inquiryId, inq!.id)));
    expect(consent[0]).toMatchObject({ channel: "sms", granted: true, method: "web_form_checkbox", statement: "I agree to receive texts about my request." });
  });

  it("retries with the same Idempotency-Key create exactly one lead", async () => {
    const body = { name: "Retry", email: "retry@example.com" };
    const a = await receiveWebsiteSubmission(req(body, { idempotencyKey: "sub-123" }));
    const b = await receiveWebsiteSubmission(req({ ...body, message: "changed" }, { idempotencyKey: "sub-123" }));
    expect(a.status).toBe(201);
    expect(b).toMatchObject({ status: 200, body: { status: "duplicate" } });
    expect(await inquiriesFor("retry@example.com")).toHaveLength(1);
  });

  it("a double-clicked submit (identical content within minutes) creates one lead; parallel requests too", async () => {
    const body = { name: "Double", email: "double@example.com", message: "hi" };
    const results = await Promise.all([1, 2, 3].map(() => receiveWebsiteSubmission(req(body))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await inquiriesFor("double@example.com")).toHaveLength(1);
  });

  it("a duplicate arriving while another copy is mid-save waits, then is recognised (deterministic race)", async () => {
    const fields = { email: "race@example.com", message: "same" };
    const hash = contentHash(fields);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let lockTaken!: () => void;
    const lockReady = new Promise<void>((r) => (lockTaken = r));
    // Transaction A: takes the per-submission lock and writes the first copy, but doesn't commit yet.
    const txA = withSystemDb("test: concurrent writer", async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${sourceId + ":" + hash}, 0))`);
      await tx.insert(intakeEvents).values({ companyId, intakeSourceId: sourceId, idempotencyKey: `h:${hash}:race`, contentHash: hash, status: "processed", payload: { fields } });
      lockTaken();
      await held;
    });
    await lockReady;
    let settled = false;
    const second = receiveWebsiteSubmission(req(fields)).then((r) => { settled = true; return r; });
    await new Promise((r) => setTimeout(r, 400));
    expect(settled).toBe(false); // blocked behind A instead of racing past the duplicate check
    release();
    await txA;
    expect((await second).body.status).toBe("duplicate");
  });

  it("the same person submitting again later is a new (repeat) inquiry, not a duplicate", async () => {
    const t0 = new Date();
    await receiveWebsiteSubmission(req({ email: "later@example.com", message: "first" }, { now: t0 }));
    await receiveWebsiteSubmission(req({ email: "later@example.com", message: "first" }, { now: new Date(t0.getTime() + 11 * 60_000) }));
    expect(await inquiriesFor("later@example.com")).toHaveLength(2);
  });

  it("invalid submissions are stored as rejected and return the problems", async () => {
    const r = await receiveWebsiteSubmission(req({ name: "No contact" }));
    expect(r.status).toBe(422);
    expect(String((r.body.problems as string[])[0])).toMatch(/email address or a phone/);
  });

  it("spam trap: looks successful to bots, creates no lead", async () => {
    const r = await receiveWebsiteSubmission(req({ email: "bot@example.com", _bw_hp: "http://spam" }));
    expect(r.status).toBe(200);
    expect(await inquiriesFor("bot@example.com")).toHaveLength(0);
  });

  it("other websites are refused when an allowed list is set", async () => {
    expect((await receiveWebsiteSubmission(req({ email: "o@example.com" }, { origin: "https://evil.example" }))).status).toBe(403);
  });

  it("accepts standard HTML form posts and only redirects to allowed websites", async () => {
    const ok = await receiveWebsiteSubmission(req("name=Form+Post&email=form%40example.com&_redirect=https%3A%2F%2Fharbor.example%2Fthanks", { contentType: "application/x-www-form-urlencoded" }));
    expect(ok.status).toBe(201);
    expect(ok.redirectTo).toBe("https://harbor.example/thanks");
    const evil = await receiveWebsiteSubmission(req("email=form2%40example.com&_redirect=https%3A%2F%2Fevil.example%2F", { contentType: "application/x-www-form-urlencoded" }));
    expect(evil.redirectTo).toBeUndefined();
  });

  it("signed sources require a valid, recent signature", async () => {
    const secret = await rotateSigningSecret(owner, sourceId);
    const body = JSON.stringify({ email: "signed@example.com" });
    const ts = String(Math.floor(Date.now() / 1000));
    expect((await receiveWebsiteSubmission(req(body))).status).toBe(401);
    expect((await receiveWebsiteSubmission(req(body, { timestamp: ts, signature: signBody("wrong", ts, body) }))).status).toBe(401);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect((await receiveWebsiteSubmission(req(body, { timestamp: old, signature: signBody(secret, old, body) }))).status).toBe(401);
    expect((await receiveWebsiteSubmission(req(body, { timestamp: ts, signature: signBody(secret, ts, body) }))).status).toBe(201);
    // Tampered body with a valid old signature fails.
    const tampered = JSON.stringify({ email: "attacker@example.com" });
    expect((await receiveWebsiteSubmission(req(tampered, { timestamp: ts, signature: signBody(secret, ts, body) }))).status).toBe(401);
    const { removeSigningSecret } = await import("@/server/intake/sources");
    await removeSigningSecret(owner, sourceId);
  });

  it("processing is idempotent: a stored event is never turned into two leads", async () => {
    const r = await receiveWebsiteSubmission(req({ email: "idem@example.com" }));
    const id = String(r.body.id);
    expect(await processIntakeEvent(id)).toEqual({ status: "skipped" });
    expect(await inquiriesFor("idem@example.com")).toHaveLength(1);
  });

  it("a failed event can be reprocessed later", async () => {
    const [e] = await withSystemDb("test", (tx) => tx.insert(intakeEvents).values({
      companyId, intakeSourceId: sourceId, idempotencyKey: "k:manual-failed", contentHash: "x", status: "failed",
      payload: { fields: { email: "recovered@example.com" } },
    }).returning());
    expect(await processIntakeEvent(e!.id)).toEqual({ status: "processed" });
    expect(await processIntakeEvent(e!.id)).toEqual({ status: "skipped" });
    expect(await inquiriesFor("recovered@example.com")).toHaveLength(1);
  });

  it("Health → Retry turns stored-but-failed submissions into leads, once (lead capture recovery)", async () => {
    // In this file (not operations.test.ts) because the retry is platform-wide and this is the file that makes failed events.
    await withSystemDb("test", (tx) => tx.insert(intakeEvents).values({
      companyId, intakeSourceId: sourceId, idempotencyKey: "k:retry-button", contentHash: "y", status: "failed",
      payload: { fields: { email: "retried@example.com", name: "Retried" } },
    }));
    const admin = await makeUser({ admin: true });
    const r = await retryFailedIntake(adminCtx(admin));
    expect(r.processed).toBeGreaterThanOrEqual(1);
    await retryFailedIntake(adminCtx(admin));
    expect(await inquiriesFor("retried@example.com")).toHaveLength(1);
  });

  it("disabled sources stop accepting submissions", async () => {
    await updateIntakeSource(owner, sourceId, { name: "Contact page", allowedOrigins: ["https://harbor.example"], active: false });
    expect((await receiveWebsiteSubmission(req({ email: "off@example.com" }))).status).toBe(404);
    await updateIntakeSource(owner, sourceId, { name: "Contact page", allowedOrigins: ["https://harbor.example"], active: true });
  });
});

describe("account status at intake", () => {
  async function companyWithSource(lifecycleStatus: "onboarding" | "churned" | "active", suspended = false) {
    const c = await makeCompany({ lifecycleStatus, suspended });
    const u = await makeUser();
    await addMember(c.id, u.id, "owner");
    await setCompany(c.id, { lifecycleStatus: "active", suspended: false });
    const o = await resolveCompanyContext({ user: u, identity: identityFor(u), requestedCompanyId: c.id, action: "integration.manage" });
    const s = await createIntakeSource(o, { name: "Form", allowedOrigins: [] });
    await setCompany(c.id, { lifecycleStatus, suspended });
    return s.publicKey;
  }

  it("onboarding and suspended accounts store leads but hold them from automation", async () => {
    for (const [status, susp] of [["onboarding", false], ["active", true]] as const) {
      const k = await companyWithSource(status, susp);
      const email = `held-${status}-${susp}@example.com`;
      expect((await receiveWebsiteSubmission(req({ email }, { publicKey: k, origin: null }))).status).toBe(201);
      const rows = await inquiriesFor(email);
      expect(rows[0]!.automation_origin).toBe("held");
    }
  });

  it("churned accounts refuse with an explicit error (never silently dropped)", async () => {
    const k = await companyWithSource("churned");
    const r = await receiveWebsiteSubmission(req({ email: "late@example.com" }, { publicKey: k, origin: null }));
    expect(r.status).toBe(410);
    expect(await inquiriesFor("late@example.com")).toHaveLength(0);
  });

  it("rate limits each form and tells the sender to retry", async () => {
    const k = await companyWithSource("active");
    let last = 0;
    for (let i = 0; i <= RATE_LIMIT_PER_MINUTE; i++) {
      last = (await receiveWebsiteSubmission(req({ email: `burst${i}@example.com` }, { publicKey: k, origin: null }))).status;
    }
    expect(last).toBe(429);
  });
});
