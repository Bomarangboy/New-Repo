import { sql } from "drizzle-orm";
import { withSystemDb } from "@/lib/db/context";
import { claimDueJobs, finishJob, recoverStaleJobs, type JobHandler, type JobOutcome } from "./queue";

/**
 * Processes due jobs within a time budget (serverless functions have time limits).
 * Called by: the scheduled trigger every minute, right after requests that create jobs,
 * and `npm run jobs:work` during local development.
 */
let registry: Record<string, JobHandler> | null = null;

async function handlers(): Promise<Record<string, JobHandler>> {
  registry ??= (await import("./handlers")).HANDLERS;
  return registry!;
}

export interface RunSummary { claimed: number; succeeded: number; rescheduled: number; cancelled: number; retried: number; dead: number }

export async function runDueJobs(opts: { limit?: number; timeBudgetMs?: number; now?: () => Date } = {}): Promise<RunSummary> {
  const now = opts.now ?? (() => new Date());
  const deadline = Date.now() + (opts.timeBudgetMs ?? 20_000);
  const summary: RunSummary = { claimed: 0, succeeded: 0, rescheduled: 0, cancelled: 0, retried: 0, dead: 0 };
  const h = await handlers();
  while (Date.now() < deadline) {
    const batch = await claimDueJobs(Math.min(opts.limit ?? 25, 25), now());
    if (!batch.length) break;
    summary.claimed += batch.length;
    for (const job of batch) {
      let outcome: JobOutcome;
      const handler = h[job.kind];
      try {
        outcome = handler ? await handler(job) : { status: "cancelled", result: `No handler for job kind "${job.kind}"` };
      } catch (e) {
        outcome = { status: "retry", error: e instanceof Error ? e.message : String(e) };
      }
      await finishJob(job, outcome, now());
      if (outcome.status === "succeeded") summary.succeeded++;
      else if (outcome.status === "reschedule") summary.rescheduled++;
      else if (outcome.status === "cancelled") summary.cancelled++;
      else if (job.attempts >= job.maxAttempts) summary.dead++;
      else summary.retried++;
    }
    if (opts.limit && summary.claimed >= opts.limit) break;
  }
  return summary;
}

/**
 * Housekeeping, at most once a minute across all workers (advisory lock):
 * requeue jobs whose worker vanished, mark interrupted sends "unknown", apply scheduled cancellations.
 */
export async function runMaintenance(now = new Date()): Promise<{ ran: boolean; staleJobs?: number; unknownSends?: number; cancellations?: number; adJobs?: number }> {
  const got = await withSystemDb("jobs: maintenance lock", async (tx) => {
    const r = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(hashtextextended('bluewater:maintenance', 0)) as ok`);
    if (!r[0]?.ok) return false;
    const last = await tx.execute<{ v: string | null }>(sql`select result as v from app.jobs where idempotency_key = 'system:maintenance:last'`);
    const lastAt = last[0]?.v ? new Date(last[0].v) : null;
    if (lastAt && now.getTime() - lastAt.getTime() < 55_000) return false;
    await tx.execute(sql`insert into app.jobs (kind, idempotency_key, status, result, finished_at)
      values ('system_marker', 'system:maintenance:last', 'succeeded', ${now.toISOString()}, now())
      on conflict (idempotency_key) do update set result = excluded.result, updated_at = now()`);
    return true;
  });
  if (!got) return { ran: false };
  const staleJobs = await recoverStaleJobs(now);
  const { markInterruptedSendsUnknown } = await import("@/server/messaging/send");
  const unknownSends = await markInterruptedSendsUnknown(now);
  const { applyDueCancellations } = await import("@/server/companies");
  const cancellations = await applyDueCancellations(now);
  const { scheduleAdWork } = await import("@/server/ads/sync");
  const adJobs = await scheduleAdWork(now);
  return { ran: true, staleJobs, unknownSends, cancellations, adJobs };
}
