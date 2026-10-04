import { after, NextResponse, type NextRequest } from "next/server";
import { googleLeadWebhook } from "@/server/ads/leads";
import { runDueJobs } from "@/server/jobs/runner";

/** Google Ads lead-form webhook for one company (secret address + google_key check). */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const raw = await req.text();
  if (raw.length > 128_000) return new NextResponse(null, { status: 413 });
  const r = await googleLeadWebhook(key, raw);
  if (r.queued) after(() => runDueJobs({ limit: 10, timeBudgetMs: 8000 }).catch(() => {}));
  return NextResponse.json({}, { status: r.status });
}
