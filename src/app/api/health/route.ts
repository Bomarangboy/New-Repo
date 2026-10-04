import { NextResponse } from "next/server";
import { publicHealth } from "@/server/ops/alerts";

/**
 * For the EXTERNAL uptime monitor (docs/MONITORING.md): 200 when the database answers and the every-minute
 * scheduler has run in the last 5 minutes; 503 otherwise. No client information is included.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const h = await publicHealth();
  return NextResponse.json(h, { status: h.status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
