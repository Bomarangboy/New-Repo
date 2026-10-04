import { NextResponse } from "next/server";
import { actionContext, requestId } from "@/lib/authz/guard";
import { AuthzError } from "@/lib/authz/resolve";
import { exportLeadsCsv } from "@/server/crm/leads";

/** Owner-only CSV download. Treated like a credential: no caching, logged in the activity log. */
export async function GET() {
  try {
    const ctx = await actionContext("lead.export", "leads");
    const { csv } = await exportLeadsCsv(ctx, await requestId());
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leads-${date}.csv"`,
        "Cache-Control": "no-store, private",
      },
    });
  } catch (e) {
    const status = e instanceof AuthzError ? (e.code === "unauthenticated" ? 401 : 403) : 500;
    return NextResponse.json({ error: status === 500 ? "Export failed. Please try again." : "You don't have permission to export." }, { status });
  }
}
