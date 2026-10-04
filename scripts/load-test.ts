/**
 * Load test (docs/CAPACITY.md). Exercises the two paths that matter at peak: lead intake and the background
 * queue (automatic replies + team alerts). Uses throwaway "Load test" companies (internal test kind, simulated
 * sending only) and deletes them at the end with the same restricted deletion used for real companies.
 *
 *   npx tsx scripts/load-test.ts [--url http://localhost:3100] [--seconds 60] [--rate 5] [--record] [--keep]
 *
 * Without --url the intake code is called in-process (same code as the web route, minus HTTP).
 * Targets are D-15: peak 5 lead events/second; 500 leads/day; 5,000 messages/day.
 * NEVER point this at production: it refuses when APP_ENV=production.
 */
import "./load-env";
import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { closeDb } from "../src/lib/db/client";
import { withSystemDb } from "../src/lib/db/context";
import { companies, intakeSources, messages, messagingSettings, inquiries, jobs } from "../src/lib/db/schema";
import { receiveWebsiteSubmission } from "../src/server/intake/website";
import { runDueJobs } from "../src/server/jobs/runner";

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1]! : d; };
const url = argv.includes("--url") ? opt("--url", "") : null;
const seconds = Number(opt("--seconds", "60"));
const rate = Number(opt("--rate", "5"));
if ((process.env.APP_ENV ?? "") === "production") { console.error("Refusing to load-test production."); process.exit(1); }

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!) : null; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

async function submit(key: string): Promise<{ status: number; ms: number }> {
  const n = seq++;
  const fields = { name: `Load Person ${n}`, email: `load.${n}.${randomBytes(3).toString("hex")}@example.com`, phone: `415-555-01${String(n % 100).padStart(2, "0")}`, service: "Roof repair", message: "Load test", consent_sms: "on", consent_text: "Text me" };
  const t = performance.now();
  if (url) {
    const r = await fetch(`${url}/api/intake/${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fields) });
    await r.arrayBuffer();
    return { status: r.status, ms: performance.now() - t };
  }
  const r = await receiveWebsiteSubmission({ publicKey: key, rawBody: JSON.stringify(fields), contentType: "application/json", origin: null, signature: null, timestamp: null, idempotencyKey: null, ip: "198.51.100.77", userAgent: "load-test" });
  return { status: r.status, ms: performance.now() - t };
}

async function main() {
  const tag = `Load test ${new Date().toISOString().slice(0, 16)}`;
  // Enough sources that the sustained phase stays under the per-form limit (30/minute) — the limit is tested separately.
  const perSourcePerMin = 24;
  const sustainedSources = Math.max(1, Math.ceil((rate * 60) / perSourcePerMin));
  const totalSources = sustainedSources + 5 + 1;
  const setup = await withSystemDb("load test: setup", async (tx) => {
    const out: { companyId: string; key: string }[] = [];
    for (let i = 0; i < totalSources; i++) {
      const [c] = await tx.insert(companies).values({ name: `${tag} #${i + 1}`, slug: `load-${Date.now()}-${i}`, kind: "internal_test", lifecycleStatus: "active", package: "follow_up_booking", timezone: "America/New_York" }).returning();
      await tx.insert(messagingSettings).values({ companyId: c!.id, ackEnabled: true, windowStartMinute: 0, windowEndMinute: 1440 }).onConflictDoUpdate({ target: messagingSettings.companyId, set: { ackEnabled: true, windowStartMinute: 0, windowEndMinute: 1440 } });
      const key = randomBytes(18).toString("base64url");
      await tx.insert(intakeSources).values({ companyId: c!.id, name: "Load form", publicKey: key, allowedOrigins: [] });
      out.push({ companyId: c!.id, key });
    }
    return out;
  });
  const ids = setup.map((s) => s.companyId);
  const sustained = setup.slice(0, sustainedSources), burstSrc = setup.slice(sustainedSources, sustainedSources + 5), limitSrc = setup[setup.length - 1]!;

  // Phase 1: sustained peak.
  console.log(`Phase 1: ${rate}/s for ${seconds}s across ${sustainedSources} forms ${url ? `via ${url}` : "(in-process)"}…`);
  const p1: Promise<{ status: number; ms: number }>[] = [];
  const start = performance.now();
  for (let i = 0; i < rate * seconds; i++) {
    const due = start + (i * 1000) / rate;
    const wait = due - performance.now();
    if (wait > 0) await sleep(wait);
    p1.push(submit(sustained[i % sustained.length]!.key));
  }
  const r1 = await Promise.all(p1);
  const p1Seconds = (performance.now() - start) / 1000;

  // Phase 2: burst — 50 submissions at the same instant.
  console.log("Phase 2: burst of 50 simultaneous submissions…");
  const r2 = await Promise.all(Array.from({ length: 50 }, (_, i) => submit(burstSrc[i % burstSrc.length]!.key)));

  // Phase 3: one form hammered past its limit.
  console.log("Phase 3: 40 rapid submissions to one form (limit 30/minute)…");
  const r3: { status: number; ms: number }[] = [];
  for (let i = 0; i < 40; i++) r3.push(await submit(limitSrc.key));

  const stored = await withSystemDb("load test: count", async (tx) => Number((await tx.select({ n: sql<number>`count(*)` }).from(inquiries).where(inArray(inquiries.companyId, ids)))[0]!.n));
  const queued = await withSystemDb("load test: queue", async (tx) => Number((await tx.select({ n: sql<number>`count(*)` }).from(jobs).where(and(inArray(jobs.companyId, ids), eq(jobs.status, "queued"))))[0]!.n));

  // Phase 4: drain the queue with two workers at once (like two overlapping scheduler runs).
  console.log(`Phase 4: draining ${queued} queued jobs with 2 parallel workers…`);
  const t4 = performance.now();
  for (;;) {
    const left = await withSystemDb("load test: left", async (tx) => Number((await tx.select({ n: sql<number>`count(*)` }).from(jobs).where(and(inArray(jobs.companyId, ids), inArray(jobs.status, ["queued", "running"]), sql`${jobs.runAt} <= now()`)))[0]!.n));
    if (!left || performance.now() - t4 > 10 * 60_000) break;
    await Promise.all([runDueJobs({ timeBudgetMs: 20_000 }), runDueJobs({ timeBudgetMs: 20_000 })]);
  }
  const drainSeconds = (performance.now() - t4) / 1000;
  const check = await withSystemDb("load test: verify", async (tx) => {
    const [x] = await tx.execute<{ leads: number; acks: number; dup: number; noack: number }>(sql`
      select count(distinct i.id)::int as leads, count(m.id)::int as acks,
        (select count(*) from (select inquiry_id from app.messages where company_id in ${sql.raw(`(${ids.map((i) => `'${i}'`).join(",")})`)} and kind = 'acknowledgment' group by 1 having count(*) > 1) d)::int as dup,
        count(*) filter (where m.id is null)::int as noack
      from app.inquiries i left join app.messages m on m.inquiry_id = i.id and m.kind = 'acknowledgment'
      where i.company_id in ${sql.raw(`(${ids.map((i) => `'${i}'`).join(",")})`)}`);
    const [dead] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from app.jobs where company_id in ${sql.raw(`(${ids.map((i) => `'${i}'`).join(",")})`)} and status = 'dead'`);
    return { ...x!, dead: dead!.n };
  });

  const ok = (r: { status: number }[]) => r.filter((x) => x.status === 201 || x.status === 200).length;
  const summary = {
    target: { peakPerSecond: 5, leadsPerDay: 500, messagesPerDay: 5000 },
    mode: url ? `HTTP ${url}` : "in-process",
    sustained: { requested: r1.length, perSecond: +(r1.length / p1Seconds).toFixed(2), accepted: ok(r1), other: r1.filter((x) => x.status !== 201 && x.status !== 200).map((x) => x.status), p50ms: pct(r1.map((x) => x.ms), 50), p95ms: pct(r1.map((x) => x.ms), 95), maxMs: pct(r1.map((x) => x.ms), 100) },
    burst: { requested: 50, accepted: ok(r2), p95ms: pct(r2.map((x) => x.ms), 95), maxMs: pct(r2.map((x) => x.ms), 100) },
    rateLimit: { requested: 40, accepted: ok(r3), refused429: r3.filter((x) => x.status === 429).length },
    stored, queue: { jobs: queued, drainSeconds: +drainSeconds.toFixed(1), jobsPerSecond: +(queued / Math.max(drainSeconds, 0.001)).toFixed(1) },
    integrity: { leads: check.leads, acknowledgments: check.acks, duplicateAcks: check.dup, leadsWithoutAck: check.noack, deadJobs: check.dead },
  };
  const problems: string[] = [];
  if (summary.sustained.accepted !== r1.length) problems.push("some sustained submissions were refused");
  if (summary.burst.accepted !== 50) problems.push("some burst submissions were refused");
  if (summary.rateLimit.refused429 < 1) problems.push("the per-form limit did not trigger");
  if (stored !== summary.sustained.accepted + summary.burst.accepted + summary.rateLimit.accepted) problems.push("stored leads don't match accepted submissions");
  if (check.dup) problems.push("duplicate acknowledgments");
  if (check.noack) problems.push(`${check.noack} lead(s) without an acknowledgment`);
  if (check.dead) problems.push("jobs gave up");
  const result = { result: problems.length ? "failed" : "passed", problems, ...summary };
  console.log(JSON.stringify(result, null, 2));

  if (argv.includes("--record")) {
    await withSystemDb("load test: record", (tx) => tx.execute(sql`insert into app.ops_records (kind, result, environment, summary, details) values ('load_test', ${result.result}, ${process.env.APP_ENV ?? "development"},
      ${`Load test (${summary.mode}): ${summary.sustained.perSecond} leads/s sustained, p95 ${summary.sustained.p95ms} ms; burst of 50 accepted ${summary.burst.accepted}; ${queued} jobs drained in ${summary.queue.drainSeconds}s; ${problems.length ? problems.join("; ") : "no duplicates, nothing lost"}.`},
      ${JSON.stringify(result)}::jsonb)`));
  }
  if (!argv.includes("--keep")) {
    await withSystemDb("load test: cleanup", async (tx) => {
      for (const id of ids) {
        await tx.update(companies).set({ lifecycleStatus: "archived" }).where(eq(companies.id, id));
        await tx.execute(sql`select app.purge_company_data(${id}::uuid)`);
      }
    });
    console.log(`Cleaned up ${ids.length} load-test companies (data deleted; company rows remain archived, named “${tag}”).`);
  }
  process.exitCode = problems.length ? 1 : 0;
}

main().catch((e) => { console.error("Load test failed:", e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(closeDb);
