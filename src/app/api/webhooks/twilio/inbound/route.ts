import { NextResponse, type NextRequest } from "next/server";
import { twilioInbound } from "@/server/messaging/webhooks";

export const dynamic = "force-dynamic";

/** Incoming texts from Twilio (signature-verified). Replies are sent by people, not here. */
export async function POST(req: NextRequest) {
  const params = Object.fromEntries(new URLSearchParams(await req.text()));
  const status = await twilioInbound(params, req.headers.get("x-twilio-signature") ?? "");
  if (status !== 200) return new NextResponse(null, { status });
  return new NextResponse("<Response/>", { status: 200, headers: { "Content-Type": "text/xml" } });
}
