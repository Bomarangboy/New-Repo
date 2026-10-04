import { NextResponse, type NextRequest } from "next/server";
import { calcomWebhook } from "@/server/booking/webhook";

export const dynamic = "force-dynamic";

/** Cal.com booking created / rescheduled / cancelled (and "Ping test") for one company (secret path + signature). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const raw = await req.text();
  if (raw.length > 256_000) return new NextResponse(null, { status: 413 });
  return new NextResponse(null, { status: await calcomWebhook(key, raw, req.headers.get("x-cal-signature-256")) });
}
