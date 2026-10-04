import { NextResponse, type NextRequest } from "next/server";
import { twilioStatus } from "@/server/messaging/webhooks";

export const dynamic = "force-dynamic";

/** Delivery reports from Twilio (signature-verified, duplicate/out-of-order safe). */
export async function POST(req: NextRequest) {
  const params = Object.fromEntries(new URLSearchParams(await req.text()));
  return new NextResponse(null, { status: await twilioStatus(params, req.headers.get("x-twilio-signature") ?? "") });
}
