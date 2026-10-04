import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { runDueJobs, runMaintenance } from "@/server/jobs/runner";

/**
 * Called every minute by the scheduler (Supabase Cron → pg_net, D-07) with
 * `Authorization: Bearer <JOB_TRIGGER_SECRET>`. Does housekeeping, then processes due jobs
 * within a time budget below the hosting function limit.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = env().JOB_TRIGGER_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !given) return false;
  const a = Buffer.from(secret), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const maintenance = await runMaintenance();
  const jobs = await runDueJobs({ timeBudgetMs: 40_000 });
  return NextResponse.json({ ok: true, maintenance, jobs }, { headers: { "Cache-Control": "no-store" } });
}
