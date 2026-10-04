import { after, NextResponse, type NextRequest } from "next/server";
import { metaVerify, metaWebhook } from "@/server/ads/leads";
import { runDueJobs } from "@/server/jobs/runner";

/** Meta lead-ads webhook for Bluewater's Meta app (all client Pages). Signature checked with the app secret. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const r = metaVerify(q.get("hub.mode"), q.get("hub.verify_token"), q.get("hub.challenge"));
  return new NextResponse(r.body, { status: r.status, headers: { "Content-Type": "text/plain" } });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 512_000) return new NextResponse(null, { status: 413 });
  const r = await metaWebhook(raw, req.headers.get("x-hub-signature-256"));
  if (r.queued) after(() => runDueJobs({ limit: 10, timeBudgetMs: 8000 }).catch(() => {}));
  return new NextResponse(null, { status: r.status });
}
