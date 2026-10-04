import { NextResponse } from "next/server";
import { adminActionContext } from "@/lib/authz/guard";
import { userMessage } from "@/lib/user-message";
import { diagnostics } from "@/server/ops/controls";

/** Redacted diagnostics download for one company (administrators with two-step verification only). */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await adminActionContext();
    const { id } = await params;
    const d = await diagnostics(ctx, id);
    return new NextResponse(JSON.stringify(d, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="bluewater-diagnostics-${id.slice(0, 8)}.json"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json({ error: userMessage(e) }, { status: 403 });
  }
}
