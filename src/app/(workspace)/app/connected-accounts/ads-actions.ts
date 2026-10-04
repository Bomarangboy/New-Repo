"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { actionContext, requestId } from "@/lib/authz/guard";
import { env } from "@/lib/env";
import { userMessage } from "@/lib/user-message";
import type { FormState } from "@/components/forms";
import { OAUTH_NONCE_COOKIE } from "@/server/ads/config";
import { beginConnect, disconnectPlatform, selectAdAccounts, setPageReceiving, setUpGoogleLeadWebhook, turnOffGoogleLeadWebhook } from "@/server/ads/connections";
import { sendSimulatedAdLead } from "@/server/ads/leads";
import { runDueJobs } from "@/server/jobs/runner";

const PAGE = "/app/connected-accounts";
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

async function run(fn: () => Promise<string>): Promise<FormState> {
  try {
    const ok = await fn();
    revalidatePath(PAGE);
    return { ok };
  } catch (e) {
    return { error: userMessage(e) };
  }
}

/** Starts the platform's own sign-in (live) or connects a sample account (simulated). */
export async function connectAdsAction(fd: FormData): Promise<void> {
  const platform = str(fd, "platform");
  let target = `${PAGE}?connected=${encodeURIComponent(platform)}`;
  try {
    const ctx = await actionContext("integration.manage", "ad_lead_forms");
    const r = await beginConnect(ctx, platform);
    if (r.kind === "redirect") {
      (await cookies()).set(OAUTH_NONCE_COOKIE, r.nonce, { httpOnly: true, sameSite: "lax", secure: env().APP_BASE_URL.startsWith("https://"), path: "/api/oauth", maxAge: 600 });
      target = r.url;
    }
  } catch (e) {
    target = `${PAGE}?problem=${encodeURIComponent(userMessage(e))}`;
  }
  revalidatePath(PAGE);
  redirect(target);
}

export async function disconnectAdsAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("integration.manage", "ad_lead_forms");
    await disconnectPlatform(ctx, str(fd, "platform"), await requestId());
    return "Disconnected. Leads and numbers already in Bluewater are kept.";
  });
}

export async function pageReceivingAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("integration.manage", "ad_lead_forms");
    const on = fd.get("on") === "1";
    await setPageReceiving(ctx, str(fd, "sourceId"), on, await requestId());
    return on ? "This Page's lead-form leads now come into Bluewater." : "Stopped receiving this Page's leads.";
  });
}

export async function selectAccountsAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("integration.manage", "ad_reporting");
    await selectAdAccounts(ctx, str(fd, "platform"), fd.getAll("accountId").map(String), await requestId());
    after(() => runDueJobs({ limit: 5, timeBudgetMs: 20_000 }).catch(() => {}));
    return "Saved. Reports will include these accounts; numbers are being imported now.";
  });
}

export type GoogleHookState = { error?: string; url?: string; key?: string } | null;

export async function googleWebhookAction(_: GoogleHookState, _fd: FormData): Promise<GoogleHookState> {
  try {
    const ctx = await actionContext("integration.manage", "ad_lead_forms");
    const r = await setUpGoogleLeadWebhook(ctx, await requestId());
    revalidatePath(PAGE);
    return r;
  } catch (e) {
    return { error: userMessage(e) };
  }
}

export async function googleWebhookOffAction(_: FormState, _fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("integration.manage", "ad_lead_forms");
    await turnOffGoogleLeadWebhook(ctx, await requestId());
    return "Turned off. Remove the webhook from your Google Ads lead form too.";
  });
}

export async function simulatedAdLeadAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("integration.manage", "ad_lead_forms");
    await sendSimulatedAdLead(ctx, str(fd, "sourceId"));
    after(() => runDueJobs({ limit: 10, timeBudgetMs: 8000 }).catch(() => {}));
    return "Simulated lead sent. It appears under Leads within a few seconds, labeled simulated.";
  });
}
