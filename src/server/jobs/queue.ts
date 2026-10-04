import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { withSystemDb } from "@/lib/db/context";

/**
 * Durable job queue in PostgreSQL (D-07). Jobs survive restarts and are processed every minute by
 * the scheduled trigger (POST /api/jobs/run) and immediately after requests that create them.
 *
 * Rules:
 *  - enqueue inside the same transaction as the change that causes the work;
 *  - every job has an idempotency key, so enqueueing twice is harmless;
 *  - handlers must be safe to run more than once (a crashed worker's job is retried).
 */
export interface EnqueueInput {
  companyId: string | null;
  kind: string;
  key: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
  maxAttempts?: number;
}

/**
 * Under load the most important work goes first (docs/CAPACITY.md): recording ad leads and acknowledging new
 * leads, then team alerts, booking messages, follow-ups, and last the reporting imports.
 */
export const JOB_PRIORITY: Record<string, number> = {
  ad_lead_record: 1, send_acknowledgment: 1, notify_new_lead: 2, notify_reply: 2, notify_ack_problem: 2,
  booking_message: 3, notify_booking: 4, sequence_step: 4, ad_lead_reconcile: 6, ad_metrics_sync: 8, weekly_summary: 8,
};

export async function enqueue(tx: Tx, j: EnqueueInput): Promise<void> {
  await tx.insert(jobs).values({
    companyId: j.companyId, kind: j.kind, idempotencyKey: j.key, payload: j.payload ?? {},
    runAt: j.runAt ?? new Date(), maxAttempts: j.maxAttempts ?? 5, priority: JOB_PRIORITY[j.kind] ?? 5,
  }).onConflictDoNothing({ target: jobs.idempotencyKey });
}

export type JobRow = typeof jobs.$inferSelect;

export type JobOutcome =
  | { status: "succeeded"; result?: string }
  /** Not done yet by design (e.g. outside the sending window). Doesn't count as a failed attempt. */
  | { status: "reschedule"; runAt: Date; result?: string }
  /** Nothing to do any more (e.g. the lead replied first). */
  | { status: "cancelled"; result: string }
  | { status: "retry"; error: string };

export type JobHandler = (job: JobRow) => Promise<JobOutcome>;

const LEASE_SECONDS = 120;
/** At most this many jobs per company per batch, so one busy client can't starve others. */
const PER_COMPANY_PER_BATCH = 5;

export function backoffMs(attempt: number): number {
  return Math.min(30_000 * 4 ** Math.max(0, attempt - 1), 3600_000);
}

/** Claims due jobs (FOR UPDATE SKIP LOCKED: two workers never take the same job). */
export async function claimDueJobs(limit: number, now = new Date()): Promise<JobRow[]> {
  return withSystemDb("jobs: claim", async (tx) => {
    const rows = await tx.execute<Record<string, unknown>>(sql`
      with ranked as (
        select id, row_number() over (partition by coalesce(company_id::text, '') order by priority, run_at) as rn
        from app.jobs where status = 'queued' and run_at <= ${now.toISOString()}
        order by priority, run_at limit 1000
      ), picked as (
        select j.id from app.jobs j join ranked r on r.id = j.id
        where r.rn <= ${PER_COMPANY_PER_BATCH} and j.status = 'queued'
        order by j.priority, j.run_at limit ${limit}
        for update of j skip locked
      )
      update app.jobs set status = 'running', attempts = attempts + 1,
        locked_until = ${new Date(now.getTime() + LEASE_SECONDS * 1000).toISOString()}, updated_at = now()
      where id in (select id from picked)
      returning id`);
    if (!rows.length) return [];
    const ids = rows.map((r) => String(r.id));
    return tx.select().from(jobs).where(sql`${jobs.id} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  });
}

export async function finishJob(job: JobRow, outcome: JobOutcome, now = new Date()): Promise<void> {
  await withSystemDb("jobs: finish", async (tx) => {
    const base = { lockedUntil: null, updatedAt: now };
    switch (outcome.status) {
      case "succeeded":
        await tx.update(jobs).set({ ...base, status: "succeeded", result: outcome.result ?? null, finishedAt: now, lastError: null }).where(sql`${jobs.id} = ${job.id}`);
        break;
      case "cancelled":
        await tx.update(jobs).set({ ...base, status: "cancelled", result: outcome.result, finishedAt: now }).where(sql`${jobs.id} = ${job.id}`);
        break;
      case "reschedule":
        // Give the attempt back: waiting for a window isn't a failure.
        await tx.update(jobs).set({ ...base, status: "queued", runAt: outcome.runAt, attempts: Math.max(0, job.attempts - 1), result: outcome.result ?? null }).where(sql`${jobs.id} = ${job.id}`);
        break;
      case "retry": {
        const dead = job.attempts >= job.maxAttempts;
        await tx.update(jobs).set({
          ...base, status: dead ? "dead" : "queued", lastError: outcome.error.slice(0, 1000),
          runAt: dead ? job.runAt : new Date(now.getTime() + backoffMs(job.attempts)), finishedAt: dead ? now : null,
        }).where(sql`${jobs.id} = ${job.id}`);
        break;
      }
    }
  });
}

/** Jobs whose worker vanished (lease expired) go back to the queue; handlers are idempotent. */
export async function recoverStaleJobs(now = new Date()): Promise<number> {
  return withSystemDb("jobs: recover stale leases", async (tx) => {
    const res = await tx.update(jobs).set({ status: "queued", lockedUntil: null, lastError: "Worker stopped before finishing; retried", updatedAt: now })
      .where(sql`${jobs.status} = 'running' and ${jobs.lockedUntil} < ${now.toISOString()}`).returning({ id: jobs.id });
    return res.length;
  });
}

/** Administrator controls (Health & Recovery): retry a dead/failed job, or cancel pending work. */
export async function retryJobNow(jobId: string): Promise<boolean> {
  return withSystemDb("jobs: manual retry", async (tx) => {
    const res = await tx.update(jobs).set({ status: "queued", runAt: new Date(), attempts: 0, finishedAt: null, updatedAt: new Date() })
      .where(sql`${jobs.id} = ${jobId} and ${jobs.status} in ('dead','failed')`).returning({ id: jobs.id });
    return res.length > 0;
  });
}

export async function cancelJob(jobId: string, reason: string): Promise<boolean> {
  return withSystemDb("jobs: manual cancel", async (tx) => {
    const res = await tx.update(jobs).set({ status: "cancelled", result: reason, finishedAt: new Date(), updatedAt: new Date() })
      .where(sql`${jobs.id} = ${jobId} and ${jobs.status} in ('queued','dead','failed')`).returning({ id: jobs.id });
    return res.length > 0;
  });
}
