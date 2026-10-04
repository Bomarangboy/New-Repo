import { NextResponse, type NextRequest } from "next/server";
import { postmarkWebhook } from "@/server/messaging/webhooks";

export const dynamic = "force-dynamic";

/** Postmark inbound email, delivery, bounce and spam-complaint webhooks for one company (secret path). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  return new NextResponse(null, { status: await postmarkWebhook(key, payload) });
}
