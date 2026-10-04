import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { actionContext } from "@/lib/authz/guard";
import { env } from "@/lib/env";
import { userMessage } from "@/lib/user-message";
import { OAUTH_NONCE_COOKIE } from "@/server/ads/config";
import { finishOAuth } from "@/server/ads/connections";

/**
 * The ad platform sends the person back here after they approve access. The signed state, the browser cookie,
 * the signed-in user and the selected company must all match the request that started it.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const back = new URL("/app/connected-accounts", env().APP_BASE_URL);
  const jar = await cookies();
  const nonce = jar.get(OAUTH_NONCE_COOKIE)?.value ?? null;
  jar.delete(OAUTH_NONCE_COOKIE);
  try {
    const ctx = await actionContext("integration.manage", "ad_lead_forms");
    await finishOAuth(ctx, platform, req.nextUrl.searchParams.get("code"), req.nextUrl.searchParams.get("state"), nonce);
    back.searchParams.set("connected", platform);
  } catch (e) {
    back.searchParams.set("problem", userMessage(e));
  }
  return NextResponse.redirect(back, { status: 303, headers: { "Cache-Control": "no-store" } });
}
