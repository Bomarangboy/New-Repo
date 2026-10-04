import { NextResponse, type NextRequest } from "next/server";
import { MAX_BODY_BYTES, receiveWebsiteSubmission } from "@/server/intake/website";

/** Public endpoint for website forms. Documented in docs/INTAKE.md. */
export const dynamic = "force-dynamic";

function corsHeaders(origin: string | undefined): Record<string, string> {
  return origin
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key", "Access-Control-Max-Age": "600", Vary: "Origin" }
    : {};
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin") ?? "*") });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: "Submission too large." }, { status: 413 });
  const rawBody = await req.text();
  const res = await receiveWebsiteSubmission({
    publicKey: key,
    rawBody,
    contentType: req.headers.get("content-type") ?? "",
    origin: req.headers.get("origin"),
    signature: req.headers.get("x-bluewater-signature"),
    timestamp: req.headers.get("x-bluewater-timestamp"),
    idempotencyKey: req.headers.get("idempotency-key"),
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip"),
    userAgent: req.headers.get("user-agent"),
  });
  const headers = { ...corsHeaders(res.allowOrigin), "Cache-Control": "no-store" };
  const isHtmlForm = (req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded");
  if (isHtmlForm && res.status < 300) {
    if (res.redirectTo) return NextResponse.redirect(res.redirectTo, { status: 303, headers });
    return new NextResponse(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thank you</title><body style="font-family:system-ui;padding:3rem;text-align:center"><h1>Thank you!</h1><p>Your request was received. We'll be in touch soon.</p></body>`,
      { status: 200, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } },
    );
  }
  return NextResponse.json(res.body, { status: res.status, headers: { ...headers, ...(res.status === 429 ? { "Retry-After": "60" } : {}) } });
}
